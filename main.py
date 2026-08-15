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
from pathlib import Path
from typing import Any

import webview

from config import Config
from local_store import LocalStore
from paths import get_data_dir, log_path
from sync.client import ServerSyncClient, derive_http_base, fetch_recent_events, http_get_json, http_post_json
from tray import TrayIcon

UI_HTML = Path(__file__).parent / "ui" / "app.html"
ICON_ICO = Path(__file__).parent / "assets" / "icon.ico"


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

    def attach_window(self, window: webview.Window) -> None:
        self._window = window

    # -- settings -----------------------------------------------------
    def get_config(self) -> dict[str, Any]:
        return self.config.get_all()

    def save_config(self, patch: dict[str, Any]) -> dict[str, Any]:
        self.config.update(**patch)
        self.log.info("Config updated: %s", list(patch.keys()))
        if "username" in patch:
            self._push_tracked_accounts(self.store.list_watch())
        return self.config.get_all()

    def complete_onboarding(self, username: str, accent: str, glow: str) -> dict[str, Any]:
        self.config.update(
            username=username,
            theme_accent=accent,
            theme_glow=glow,
            onboarding_complete=True,
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

    # -- misc -----------------------------------------------------------
    def get_data_dir_path(self) -> str:
        return str(get_data_dir())

    def ping(self) -> str:
        return "pong"

    def get_sync_status(self) -> dict[str, Any]:
        return {
            "configured": bool(self.config.get("api_endpoint")),
            "endpoint": self.config.get("api_endpoint"),
        }

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

        sync_client = ServerSyncClient(ws_url, handle_server_event)
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
