"""
Simple JSON-backed settings store: username, theme, API endpoint, etc.
Lives at <data_dir>/config.json.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from paths import config_path, get_data_dir

DEFAULTS: dict[str, Any] = {
    "username": "",
    "theme_accent": "#d1293d",
    "theme_glow": "rgba(209,41,61,0.45)",
    "api_endpoint": "wss://wizard.tail714bcf.ts.net/warden/events/stream",
    "api_http_base": "https://wizard.tail714bcf.ts.net/warden",
    "notifications_enabled": True,
    "onboarding_complete": False,
    "close_behavior": "background",  # "background" = hide to tray (keep receiving events) | "exit" = fully quit
    "discord_webhook": "",
    "discord_forwarding_enabled": True,
    "min_alert_value_m": 5,
}


class Config:
    def __init__(self, path: Path | None = None):
        self._path = path or config_path()
        self._lock = threading.Lock()
        self._data: dict[str, Any] = dict(DEFAULTS)
        self.load()

    def load(self) -> None:
        with self._lock:
            if self._path.exists():
                try:
                    on_disk = json.loads(self._path.read_text(encoding="utf-8"))
                    self._data = {**DEFAULTS, **on_disk}
                except (json.JSONDecodeError, OSError):
                    # Corrupt or unreadable config: keep defaults rather than crash.
                    self._data = dict(DEFAULTS)
            else:
                self._data = dict(DEFAULTS)

    def save(self) -> None:
        with self._lock:
            get_data_dir()  # make sure the folder still exists
            tmp = self._path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
            tmp.replace(self._path)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def get_all(self) -> dict[str, Any]:
        return dict(self._data)

    def set(self, key: str, value: Any) -> None:
        self._data[key] = value
        self.save()

    def update(self, **kwargs: Any) -> None:
        self._data.update(kwargs)
        self.save()
