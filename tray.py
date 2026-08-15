"""
System tray icon shown while Warden is running in the background
(close_behavior == "background" -- see config.py). Lets the user get
the window back, or quit for real, without needing the frameless
window's own controls.

Best-effort: tray icons are a "nice to have"; if pystray/Pillow aren't
available or the platform's tray implementation misbehaves, Warden
still runs fine without one (see main.py's try/except around start_tray).
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Callable

logger = logging.getLogger("warden")

ICON_PATH = Path(__file__).parent / "assets" / "icon.png"


class TrayIcon:
    def __init__(self, on_show: Callable[[], None], on_quit: Callable[[], None]):
        self._on_show = on_show
        self._on_quit = on_quit
        self._icon = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        try:
            import pystray
            from PIL import Image
        except ImportError:
            logger.warning("pystray/Pillow not installed; running without a tray icon")
            return

        image = Image.open(ICON_PATH) if ICON_PATH.exists() else Image.new("RGBA", (64, 64), (209, 41, 61, 255))
        menu = pystray.Menu(
            pystray.MenuItem("Show Warden", lambda: self._on_show()),
            pystray.MenuItem("Quit", lambda: self._on_quit()),
        )
        self._icon = pystray.Icon("warden", image, "Warden", menu)
        self._thread = threading.Thread(target=self._icon.run, daemon=True, name="warden-tray")
        self._thread.start()

    def stop(self) -> None:
        if self._icon:
            try:
                self._icon.stop()
            except Exception:
                logger.exception("Failed to stop tray icon")
