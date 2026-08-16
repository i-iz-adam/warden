"""
Desktop-side sync client. Runs a background thread that holds a
WebSocket connection open to the central server's /events/stream and:

  1. writes each incoming event into the local SQLite cache
     (so the dashboard has it even after a restart / while offline), and
  2. pushes it into the already-open pywebview window via a small JS
     hook (`window.wardenOnServerEvent(event)`), so the dashboard can
     render it live without polling.

Reconnects automatically with backoff if the server is unreachable --
the desktop app must stay fully usable offline regardless.
"""
from __future__ import annotations

import asyncio
import json
import logging
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import websockets

logger = logging.getLogger("warden")


def tcp_ping(host: str, port: int, timeout: float = 4.0) -> dict[str, Any]:
    """Raw TCP connect check -- used for the SpawnPK game server status
    (live + dev), which only exposes a socket on `port`, not an HTTP
    API we could otherwise hit. A successful connect (however brief)
    is treated as "online"; we measure wall time for the handshake as
    a rough ping and always close the socket right after."""
    started = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            ping_ms = round((time.monotonic() - started) * 1000)
        return {"online": True, "ping_ms": ping_ms}
    except Exception as err:
        return {"online": False, "ping_ms": None, "error": str(err)}


def derive_http_base(ws_url: str) -> str:
    """
    Best-effort ``wss://host/path/events/stream`` -> ``https://host/path``.
    Used as a fallback when `api_http_base` isn't set explicitly in
    config.json -- the REST API and the WS stream live on the same
    origin/path prefix, just different schemes and a different tail.
    """
    if not ws_url:
        return ""
    base = ws_url
    if base.startswith("wss://"):
        base = "https://" + base[len("wss://"):]
    elif base.startswith("ws://"):
        base = "http://" + base[len("ws://"):]
    if base.endswith("/events/stream"):
        base = base[: -len("/events/stream")]
    return base.rstrip("/")


def http_get_json(
    http_base: str,
    path: str,
    params: dict[str, Any] | None = None,
    timeout: float = 8.0,
) -> Any:
    """Generic one-shot GET against the central server, JSON-decoded.
    Used for anything request/response shaped that doesn't need to go
    over the WS stream -- the market catalog/sales lookups, in
    particular (see main.py's Api.get_market_items/get_market_sales)."""
    if not http_base:
        return None
    qs = ""
    if params:
        parts = [f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items() if v is not None]
        if parts:
            qs = "?" + "&".join(parts)
    url = f"{http_base}{path}{qs}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_post_json(
    http_base: str,
    path: str,
    body: Any,
    timeout: float = 8.0,
) -> Any:
    """Generic one-shot POST of a JSON body against the central server.
    Used for /market/track (main.py pushes the local watchlist up so
    the server can flag those accounts' listings)."""
    if not http_base:
        return None
    url = f"{http_base}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def send_discord_webhook(webhook_url: str, content: str, timeout: float = 8.0) -> bool:
    """Fire-and-forget POST of a simple message payload to a Discord
    webhook URL. Returns True on a 2xx response. Used by main.py to
    forward notable events, and by Api.test_discord_webhook() for the
    Settings page's "Test" button."""
    if not webhook_url:
        return False
    body = json.dumps({"content": content[:2000]}).encode("utf-8")
    req = urllib.request.Request(
        webhook_url, data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as err:
        # Discord returns 204 No Content on success, which urlopen treats
        # as a normal response above -- HTTPError here means a real
        # failure (bad URL, rate-limited, etc.)
        logger.warning("Discord webhook POST failed: %s", err)
        return False


def fetch_recent_events(
    http_base: str,
    limit: int = 150,
    event_type: str | None = None,
    timeout: float = 5.0,
) -> list[dict[str, Any]]:
    """
    One-shot GET against the central server's `/events/recent` used to
    backfill the local cache on startup (drops/announcements/etc. that
    happened while this client wasn't connected). Safe to call whether
    or not the server is reachable -- raises on failure, caller decides
    whether that's fatal (it shouldn't be; app must stay usable offline).
    """
    data = http_get_json(http_base, "/events/recent", {"limit": limit, "event_type": event_type}, timeout)
    return data if isinstance(data, list) else []


class ServerSyncClient:
    def __init__(
        self,
        ws_url: str,
        on_event: Callable[[dict[str, Any]], None],
        min_backoff: float = 1.0,
        max_backoff: float = 30.0,
        on_status: Callable[[bool], None] | None = None,
    ):
        self.ws_url = ws_url
        self.on_event = on_event
        self.min_backoff = min_backoff
        self.max_backoff = max_backoff
        self.on_status = on_status
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="warden-sync")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._set_status(False)

    def _set_status(self, connected: bool) -> None:
        if self.on_status:
            try:
                self.on_status(connected)
            except Exception:
                logger.exception("on_status handler failed")

    # -- internals ------------------------------------------------------
    def _run(self) -> None:
        asyncio.run(self._run_async())

    async def _run_async(self) -> None:
        backoff = self.min_backoff
        while not self._stop.is_set():
            try:
                logger.info("Connecting to central server: %s", self.ws_url)
                async with websockets.connect(self.ws_url, ping_interval=20, ping_timeout=20) as ws:
                    logger.info("Connected to central server")
                    backoff = self.min_backoff
                    self._set_status(True)
                    while not self._stop.is_set():
                        raw = await asyncio.wait_for(ws.recv(), timeout=25)
                        try:
                            event = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        try:
                            self.on_event(event)
                        except Exception:
                            logger.exception("on_event handler failed")
            except asyncio.TimeoutError:
                # no message in a while -- loop back and let ping/pong keep it alive
                continue
            except (websockets.WebSocketException, OSError) as err:
                self._set_status(False)
                if self._stop.is_set():
                    break
                logger.warning("Sync connection dropped (%s); retrying in %.1fs", err, backoff)
                await asyncio.sleep(backoff)
                backoff = min(self.max_backoff, backoff * 2)
