"""
Warden desktop app entrypoint.

Renders ui/app.html in a frameless pywebview window (custom titlebar
in the HTML handles minimize/maximize/close -- see `.winctl` in
app.html and initWindowChrome() in app.js) and exposes a small Python
API (window.pywebview.api.*) for anything that needs to touch disk or
the OS window: settings, the local event cache, watchlist, window
controls.

Data lives under a per-user directory (see paths.py) -- resolved from
%LOCALAPPDATA% at runtime, never hard-coded to a specific machine/user.

This build intentionally does NOT include a `prepare_injection` API
method; the splash screen falls back to a "preview mode" status when
it's absent. See WARDEN_ARCHITECTURE.md re: the injection layer.
"""
from __future__ import annotations

import json
import logging
import sys
import threading
import time
import base64
import re
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Any

import webview

from config import Config
from local_store import LocalStore
from paths import get_data_dir, item_sprites_cache_dir, log_path
from sync.client import (
    ServerSyncClient,
    derive_http_base,
    fetch_recent_events,
    http_delete_json,
    http_get_bytes,
    http_get_json,
    http_post_json,
    send_discord_webhook,
    tcp_ping,
)
from tray import TrayIcon

UI_HTML = Path(__file__).parent / "ui" / "app.html"
ICON_ICO = Path(__file__).parent / "assets" / "icon.ico"

# SpawnPK game server status (Settings > Central API > SpawnPK Status).
# Both run on the same game port; the "dev" box is a separate physical
# host used for testing, not a path off the live one.
SPAWNPK_PORT = 43594
SPAWNPK_SERVERS = [
    {"id": "live", "label": "Live Server", "host": "www.spawnpk.org"},
    {"id": "dev", "label": "Dev Server", "host": "149.56.28.70"},
]


def _png_to_data_uri(png_bytes: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


# The SpawnPK game client's own loadout folder -- NOT a Warden data dir.
# Windows: C:\Users\<user>\.spawnpk-data\loadouts
LOCAL_LOADOUTS_DIR = Path.home() / ".spawnpk-data" / "loadouts"


logger = logging.getLogger("warden")


def setup_logging(data_dir: Path) -> logging.Logger:
    logger = logging.getLogger("warden")
    logger.setLevel(logging.INFO)
    handler = logging.FileHandler(log_path(data_dir), encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(handler)
    if not getattr(sys, "frozen", False):
        stream = logging.StreamHandler()
        stream.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
        logger.addHandler(stream)
    return logger


class Api:
    """Everything exposed to JS as window.pywebview.api.<method>."""

    def __init__(self, config: Config, store: LocalStore, logger: logging.Logger):
        self.config = config
        self.store = store
        self.log = logger
        self._window: webview.Window | None = None
        self._quit_requested = False
        self._connected = False
        self._server_stats_cache: dict[str, Any] | None = None
        self._spawnpk_status_cache: dict[str, Any] | None = None

    def attach_window(self, window: webview.Window) -> None:
        self._window = window

    def set_connected(self, connected: bool) -> None:
        """Called by the sync client's on_status callback whenever the
        WS connection to the central server goes up/down. Drives both
        get_sync_status() (polled by the UI) and a direct push into the
        page so the offline overlay can react immediately instead of
        waiting for the next poll."""
        self._connected = connected
        if self._window:
            try:
                self._window.evaluate_js(
                    f"window.wardenSetApiStatus && window.wardenSetApiStatus({json.dumps(connected)})"
                )
            except Exception:
                pass

    # -- settings -----------------------------------------------------
    def get_config(self) -> dict[str, Any]:
        return self.config.get_all()

    def save_config(self, patch: dict[str, Any]) -> dict[str, Any]:
        self.config.update(**patch)
        self.log.info("Config updated: %s", list(patch.keys()))
        if "username" in patch:
            self._push_tracked_accounts(self.store.list_watch())
        return self.config.get_all()

    def complete_onboarding(
        self, username: str, accent: str, glow: str, discord_webhook: str = ""
    ) -> dict[str, Any]:
        self.config.update(
            username=username,
            theme_accent=accent,
            theme_glow=glow,
            onboarding_complete=True,
            discord_webhook=discord_webhook or "",
        )
        self._push_tracked_accounts(self.store.list_watch())
        return self.config.get_all()

    # -- watchlist ------------------------------------------------------
    def get_watchlist(self) -> list[str]:
        return self.store.list_watch()

    def add_watch(self, username: str) -> list[str]:
        self.store.add_watch(username)
        names = self.store.list_watch()
        self._push_tracked_accounts(names)
        return names

    def remove_watch(self, username: str) -> list[str]:
        self.store.remove_watch(username)
        names = self.store.list_watch()
        self._push_tracked_accounts(names)
        return names

    def _push_tracked_accounts(self, names: list[str]) -> None:
        """Tells the central server which accounts are 'ours' so it can
        flag their trading-post sales as market_listing_new instead of
        an ordinary market_sale_new (see server/app.py POST
        /market/track, server/market_poller.py)."""
        http_base = self._http_base()
        if not http_base:
            return
        primary = self.config.get("username")
        all_names = list(names) + ([primary] if primary else [])
        try:
            http_post_json(http_base, "/market/track", all_names)
        except Exception:
            self.log.warning("Failed to push tracked accounts to %s", http_base, exc_info=True)

    # -- events (local cache) --------------------------------------
    def get_recent_events(self, event_type: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        return self.store.recent_events(event_type=event_type, limit=limit)

    def flush_local_cache(self) -> dict[str, Any]:
        """Debug page 'Flush Cache' -- wipes the local event cache only
        (the central server's copy, if configured, is untouched and
        will repopulate this on the next backfill/WS stream)."""
        removed = self.store.clear_events()
        self.log.info("Local event cache flushed (%d rows removed)", removed)
        return {"ok": True, "removed": removed}

    # -- misc -----------------------------------------------------------
    def get_data_dir_path(self) -> str:
        return str(get_data_dir())

    def get_log_path(self) -> str:
        return str(log_path(get_data_dir()))

    def ping(self) -> str:
        return "pong"

    def get_sync_status(self) -> dict[str, Any]:
        return {
            "configured": bool(self.config.get("api_endpoint")),
            "endpoint": self.config.get("api_endpoint"),
            "connected": self._connected,
        }

    def test_api_connection(self) -> dict[str, Any]:
        """Debug/Settings 'Test Connection' -- one-shot HTTP hit against
        /health on the central server, independent of the persistent WS
        connection's current state."""
        http_base = self._http_base()
        if not http_base:
            return {"ok": False, "error": "No API endpoint configured"}
        try:
            data = http_get_json(http_base, "/health")
            return {"ok": True, "detail": data}
        except Exception as err:
            return {"ok": False, "error": str(err)}

    # -- server stats (Settings > Central API card) ----------------------
    # The Settings page polls this on a timer to show live server health
    # instead of a raw endpoint URL. We throttle here too, on top of the
    # server's own /health cache, so a stray fast poll from the UI (e.g.
    # the page re-mounting) can't turn into a burst of real HTTP calls.
    _SERVER_STATS_MIN_INTERVAL_S = 4.0

    def get_server_stats(self) -> dict[str, Any]:
        http_base = self._http_base()
        if not http_base:
            return {"ok": False, "configured": False, "error": "No API endpoint configured"}

        now = time.monotonic()
        cached = getattr(self, "_server_stats_cache", None)
        if cached and (now - cached["at"]) < self._SERVER_STATS_MIN_INTERVAL_S:
            return cached["result"]

        started = time.monotonic()
        try:
            data = http_get_json(http_base, "/health", timeout=5.0)
            ping_ms = round((time.monotonic() - started) * 1000)
            result: dict[str, Any] = {
                "ok": True,
                "configured": True,
                "ping_ms": ping_ms,
                **(data if isinstance(data, dict) else {}),
            }
        except Exception as err:
            result = {"ok": False, "configured": True, "error": str(err)}

        self._server_stats_cache = {"at": now, "result": result}
        return result

    # -- SpawnPK game server status (Settings > Central API sub-panel) --
    # Plain TCP reachability + latency against the game port itself --
    # nothing HTTP here, so this can't go through the JS side at all.
    _SPAWNPK_STATUS_MIN_INTERVAL_S = 10.0

    def get_spawnpk_status(self) -> dict[str, Any]:
        now = time.monotonic()
        cached = self._spawnpk_status_cache
        if cached and (now - cached["at"]) < self._SPAWNPK_STATUS_MIN_INTERVAL_S:
            return cached["result"]

        results: dict[str, dict[str, Any]] = {}

        def _check(server: dict[str, str]) -> None:
            results[server["id"]] = {
                "id": server["id"],
                "label": server["label"],
                "host": server["host"],
                "port": SPAWNPK_PORT,
                **tcp_ping(server["host"], SPAWNPK_PORT),
            }

        threads = [threading.Thread(target=_check, args=(s,), daemon=True) for s in SPAWNPK_SERVERS]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=6.0)

        servers = [results.get(s["id"], {**s, "port": SPAWNPK_PORT, "online": False, "ping_ms": None}) for s in SPAWNPK_SERVERS]
        result = {"ok": True, "servers": servers}
        self._spawnpk_status_cache = {"at": now, "result": result}
        return result

    # -- item sprite cache (Warden\server\data\item_sprites\ -> local) --
    # Items are keyed by exact in-game name, e.g. "Armadyl godsword
    # (or)". First request for a given name downloads the PNG from the
    # central server and writes it to the local cache dir; every call
    # after that (this session and every future one) is a pure disk
    # read, no network at all. UI calls this via Api.get_item_image and
    # sets the result straight as an <img> src (data URI), so there's
    # no separate "serve this over localhost" step needed.
    _ITEM_NAME_SAFE_RE = re.compile(r"^[A-Za-z0-9 '()\-+_.,]{1,120}$")

    def get_item_image(self, item_name: str) -> dict[str, Any]:
        name = (item_name or "").strip()
        if not name or not self._ITEM_NAME_SAFE_RE.match(name):
            return {"ok": False, "error": "Invalid item name"}

        cache_dir = item_sprites_cache_dir(get_data_dir())
        cache_path = cache_dir / f"{name}.png"

        if cache_path.is_file():
            try:
                png_bytes = cache_path.read_bytes()
                return {"ok": True, "cached": True, "data_uri": _png_to_data_uri(png_bytes)}
            except OSError as err:
                logger.warning("Failed reading cached sprite for %s: %s", name, err)

        http_base = self._http_base()
        if not http_base:
            return {"ok": False, "error": "No API endpoint configured"}

        try:
            png_bytes = http_get_bytes(http_base, f"/items/image/{urllib.parse.quote(name)}", timeout=8.0)
        except Exception as err:
            return {"ok": False, "error": str(err)}

        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(png_bytes)
        except OSError as err:
            # Not fatal -- we can still hand back this fetch, we just
            # won't have it cached for next time.
            logger.warning("Failed caching sprite for %s: %s", name, err)

        return {"ok": True, "cached": False, "data_uri": _png_to_data_uri(png_bytes)}

    # -- local (in-game) loadouts: "My Loadouts" tab -----------------------
    # Reads whatever the SpawnPK game client itself has saved under
    # ~/.spawnpk-data/loadouts, so the Loadouts page can show what's
    # already sitting on this PC instead of asking Warden to be the
    # source of truth for it.
    #
    # TODO: this is a design-time placeholder -- the game client's on-disk
    # loadout format hasn't been finalized yet. Currently assumes one JSON
    # file per loadout shaped like {"name": ..., "equipment": {...},
    # "inventory": [...]}, mirroring the builder's own state shape.
    # Update the parsing below once that format is confirmed; until then
    # this just returns an empty list if the folder is missing or a file
    # doesn't parse, rather than erroring the whole page out.
    def get_local_loadouts(self) -> dict[str, Any]:
        loadouts: list[dict[str, Any]] = []
        try:
            if LOCAL_LOADOUTS_DIR.is_dir():
                for f in sorted(LOCAL_LOADOUTS_DIR.glob("*.json")):
                    try:
                        data = json.loads(f.read_text(encoding="utf-8"))
                    except (OSError, ValueError) as err:
                        logger.warning("Skipping unreadable loadout file %s: %s", f, err)
                        continue
                    loadouts.append({
                        "name": data.get("name") or f.stem,
                        "equipment": data.get("equipment") or {},
                        "inventory": data.get("inventory") or [],
                        "file": f.name,
                    })
        except OSError as err:
            logger.warning("Failed reading local loadouts dir: %s", err)

        return {"ok": True, "path": str(LOCAL_LOADOUTS_DIR), "loadouts": loadouts}

    def test_discord_webhook(self, webhook_url: str | None = None) -> dict[str, Any]:
        """Settings page 'Test Webhook' button. Uses the passed URL if
        given (so the user can test before saving), else the saved
        config value."""
        url = webhook_url or self.config.get("discord_webhook")
        if not url:
            return {"ok": False, "error": "No webhook URL set"}
        ok = send_discord_webhook(url, "Warden: this is a test alert. If you can see this, forwarding is working.")
        return {"ok": ok, "error": None if ok else "Discord did not accept the webhook"}

    # -- market (live passthrough to the central server; no local cache) -
    def _http_base(self) -> str:
        return self.config.get("api_http_base") or derive_http_base(self.config.get("api_endpoint") or "")

    def get_market_items(self) -> list[dict[str, Any]]:
        http_base = self._http_base()
        if not http_base:
            return []
        try:
            data = http_get_json(http_base, "/market/items")
            return data if isinstance(data, list) else []
        except Exception:
            self.log.warning("get_market_items failed against %s", http_base, exc_info=True)
            return []

    def get_market_sales(
        self, item_id: int | None = None, item_name: str | None = None, limit: int = 200
    ) -> list[dict[str, Any]]:
        http_base = self._http_base()
        if not http_base:
            return []
        try:
            data = http_get_json(
                http_base, "/market/sales",
                {"item_id": item_id, "item_name": item_name, "limit": limit},
            )
            return data if isinstance(data, list) else []
        except Exception:
            self.log.warning("get_market_sales failed against %s", http_base, exc_info=True)
            return []

    # -- market price alerts (Market page) -------------------------------
    def _alert_owner(self) -> str:
        # Same identity used for /market/track's watchlist -- whatever the
        # primary username configured for this install is, lowercased to
        # match how the server stores/matches owners.
        return (self.config.get("username") or "warden").strip().lower()

    def create_market_alert(self, item_id: int, item_name: str, direction: str, price_gp: float, repeat: bool = False) -> dict[str, Any]:
        http_base = self._http_base()
        if not http_base:
            return {"ok": False, "error": "No API endpoint configured"}
        try:
            return http_post_json(http_base, "/market/alerts", {
                "owner": self._alert_owner(),
                "item_id": item_id,
                "item_name": item_name,
                "direction": direction,
                "price_gp": price_gp,
                "repeat": repeat,
            })
        except Exception as err:
            self.log.warning("create_market_alert failed", exc_info=True)
            return {"ok": False, "error": str(err)}

    def get_market_alerts(self) -> list[dict[str, Any]]:
        http_base = self._http_base()
        if not http_base:
            return []
        try:
            data = http_get_json(http_base, "/market/alerts", {"owner": self._alert_owner()})
            return (data or {}).get("alerts", []) if isinstance(data, dict) else []
        except Exception:
            self.log.warning("get_market_alerts failed against %s", http_base, exc_info=True)
            return []

    def delete_market_alert(self, alert_id: int) -> dict[str, Any]:
        http_base = self._http_base()
        if not http_base:
            return {"ok": False, "error": "No API endpoint configured"}
        try:
            return http_delete_json(http_base, f"/market/alerts/{alert_id}?owner={self._alert_owner()}")
        except Exception as err:
            self.log.warning("delete_market_alert failed", exc_info=True)
            return {"ok": False, "error": str(err)}

    # -- donate page -------------------------------------------------------
    def get_donate_info(self) -> dict[str, Any]:
        """Donation methods -- always fetched fresh from the server
        (server/donate.py) rather than cached/bundled client-side, so
        it can't be tampered with by editing a local build (see that
        module's docstring)."""
        http_base = self._http_base()
        if not http_base:
            return {"ok": False, "error": "No API endpoint configured"}
        try:
            data = http_get_json(http_base, "/donate/info")
            return {"ok": True, **(data if isinstance(data, dict) else {})}
        except Exception as err:
            self.log.warning("get_donate_info failed against %s", http_base, exc_info=True)
            return {"ok": False, "error": str(err)}

    def open_external_url(self, url: str) -> dict[str, Any]:
        """Opens a link in the user's actual default browser -- used for
        things like the Stripe donation link, since a pywebview window
        has no business hosting a real payment checkout page itself.
        Restricted to http(s) only so this can't be turned into a
        generic "run whatever URI scheme you like" primitive."""
        try:
            parsed = urllib.parse.urlparse(url)
        except ValueError:
            return {"ok": False, "error": "Invalid URL"}
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return {"ok": False, "error": "Only http(s) links can be opened"}
        webbrowser.open(url, new=2)
        return {"ok": True}

    # -- window chrome (frameless window; see ui/app.html .winctl) ------
    def minimize_window(self) -> None:
        if self._window:
            self._window.minimize()

    def toggle_maximize_window(self) -> None:
        if self._window:
            self._window.toggle_fullscreen()

    def request_close(self) -> None:
        """The custom × button. Behavior depends on close_behavior:
        "background" hides the window (tray keeps the process alive so
        WS events/notifications keep flowing); "exit" fully quits."""
        if not self._window:
            return
        if self.config.get("close_behavior") == "exit":
            self._quit_requested = True
            self._window.destroy()
        else:
            self._window.hide()

    def request_quit(self) -> None:
        """Full quit regardless of close_behavior -- used by the tray's
        Quit item."""
        if self._window:
            self._quit_requested = True
            self._window.destroy()


def main() -> None:
    data_dir = get_data_dir()  # created here if missing, on every startup
    logger = setup_logging(data_dir)
    logger.info("Warden starting. Data dir: %s", data_dir)

    config = Config()
    store = LocalStore()
    api = Api(config, store, logger)

    # -- startup backfill ---------------------------------------------
    # Pull recent events (drops, announcements, kills, etc.) from the
    # central server's REST API once at launch, before the dashboard
    # ever renders, so `api.get_recent_events()` has real data on the
    # very first frame instead of an empty cache -- the WS stream only
    # covers events from here forward, not whatever happened while this
    # client was closed/offline. Best-effort: any failure here must not
    # block startup, the app has to stay fully usable offline.
    ws_url = config.get("api_endpoint")
    http_base = config.get("api_http_base") or derive_http_base(ws_url)
    if ws_url and http_base:
        logger.info("api_endpoint configured; attempting startup backfill")
        try:
            backfilled = fetch_recent_events(http_base, limit=150)
            added = 0
            for ev in backfilled:
                if store.add_event(
                    event_type=ev.get("event_type", "unknown"),
                    fields=ev.get("fields") or {},
                    observed_at=ev.get("first_seen_at") or ev.get("observed_at") or "",
                    raw_text=ev.get("raw_text"),
                    content_hash=ev.get("content_hash"),
                ) is not None:
                    added += 1
            logger.info(
                "Startup backfill: fetched %d recent events from %s (%d new)",
                len(backfilled), http_base, added,
            )
        except Exception:
            logger.warning("Startup backfill from %s failed; continuing offline", http_base, exc_info=True)
    elif ws_url:
        logger.info("api_endpoint set but no http_base could be derived; skipping startup backfill")

    window = webview.create_window(
        "Warden",
        url=str(UI_HTML),
        js_api=api,
        width=1360,
        height=860,
        min_size=(1100, 700),
        background_color="#08090b",
        frameless=True,
        easy_drag=False,  # dragging is via .pywebview-drag-region (the topbar) instead of anywhere
    )
    api.attach_window(window)

    tray: TrayIcon | None = None

    def on_closed():
        logger.info("Warden closing.")
        if tray:
            tray.stop()
        store.close()

    window.events.closed += on_closed

    def on_closing():
        # Fires on any close attempt (OS-level, Alt+F4, etc.) -- not just
        # the in-app × button. Same background/exit decision either way.
        if api._quit_requested or config.get("close_behavior") == "exit":
            return True
        window.hide()
        return False

    window.events.closing += on_closing

    def show_window():
        window.show()
        window.restore()

    def quit_app():
        api.request_quit()

    tray = TrayIcon(on_show=show_window, on_quit=quit_app)
    try:
        tray.start()
    except Exception:
        logger.exception("Failed to start tray icon; continuing without one")

    sync_client: ServerSyncClient | None = None
    if ws_url:
        # Event types worth pinging Discord about -- drops/kills/world
        # events, not routine chatter. Mirrors the frontend's "notable"
        # feed styling (t-rare/t-boss/t-event in ui/app.js) closely
        # enough without needing to duplicate its full classification.
        DISCORD_NOTIFY_TYPES = {"drop", "raids_drop", "corb_kill", "event_boss_spawn"}

        def _format_discord_message(event: dict[str, Any]) -> str:
            etype = event.get("event_type", "event")
            f = event.get("fields") or {}
            if etype in ("drop", "raids_drop"):
                qty = f.get("quantity")
                qty_txt = f"x{qty} " if qty and qty > 1 else ""
                return f"**{f.get('player','Unknown')}** received {qty_txt}{f.get('item','item')} from {f.get('source','unknown source')}"
            if etype == "corb_kill":
                return f"**{f.get('killer','Unknown')}** defeated {f.get('victim','someone')} for {f.get('item','loot')}"
            if etype == "event_boss_spawn":
                return f"World boss located at **{f.get('location','an unknown location')}**"
            return f"{etype}: {f}"

        def _maybe_forward_discord(event: dict[str, Any]) -> None:
            if event.get("event_type") not in DISCORD_NOTIFY_TYPES:
                return
            if not config.get("discord_forwarding_enabled", True):
                return
            webhook = config.get("discord_webhook")
            if not webhook:
                return
            message = _format_discord_message(event)

            def _send():
                try:
                    send_discord_webhook(webhook, message)
                except Exception:
                    logger.exception("Discord webhook forward failed")
            threading.Thread(target=_send, daemon=True, name="warden-discord").start()

        def handle_server_event(event: dict[str, Any]) -> None:
            # The WS stream carries two message shapes over the same
            # connection: event_new/event_confirmed (chat-derived
            # events; see server/ws_manager.py broadcasts in app.py)
            # and market_sale_new (server/market_poller.py). Only the
            # former belongs in the local event cache / dashboard feed.
            if event.get("type") == "market_sale_new":
                try:
                    window.evaluate_js(
                        f"window.wardenOnMarketSale && window.wardenOnMarketSale({json.dumps(event)})"
                    )
                except Exception:
                    logger.exception("Failed to push market sale into UI")
                return

            if event.get("type") == "market_listing_new":
                # One of our own tracked accounts has a fresh listing
                # (server/market_poller.py flagged it via /market/track).
                # Prioritise it in the market UI and drop it into the
                # profile page's per-account listings panel.
                try:
                    window.evaluate_js(
                        f"window.wardenOnMarketListing && window.wardenOnMarketListing({json.dumps(event)})"
                    )
                except Exception:
                    logger.exception("Failed to push market listing into UI")
                return

            if event.get("type") == "market_alert_triggered":
                # A price alert this client created (see Api.create_market_alert)
                # was hit by a fresh sale (server/market_alerts.py). Only
                # relevant to the owner it belongs to -- the UI side
                # filters on that before showing anything.
                try:
                    window.evaluate_js(
                        f"window.wardenOnMarketAlert && window.wardenOnMarketAlert({json.dumps(event)})"
                    )
                except Exception:
                    logger.exception("Failed to push market alert into UI")
                return

            fields = event.get("fields") or {}
            store.add_event(
                event_type=event.get("event_type", "unknown"),
                fields=fields,
                observed_at=event.get("observed_at", ""),
                raw_text=event.get("raw_text"),
                content_hash=event.get("content_hash"),
            )
            # Push it into the already-open dashboard. app.js defines
            # `wardenOnServerEvent` as a no-op if the page hasn't wired
            # up a handler yet, so this is safe to call unconditionally.
            try:
                window.evaluate_js(
                    f"window.wardenOnServerEvent && window.wardenOnServerEvent({json.dumps(event)})"
                )
            except Exception:
                logger.exception("Failed to push event into UI")
            _maybe_forward_discord(event)

        sync_client = ServerSyncClient(ws_url, handle_server_event, on_status=api.set_connected)
        sync_client.start()
        logger.info("Sync client started against %s", ws_url)
        api._push_tracked_accounts(store.list_watch())
    if not ws_url or not ws_url.strip():
        logger.info("No api_endpoint configured; running fully offline")

    webview.start(debug=not getattr(sys, "frozen", False), icon=str(ICON_ICO) if ICON_ICO.exists() else None)

    if sync_client:
        sync_client.stop()


if __name__ == "__main__":
    main()
