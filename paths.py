"""
Central place for resolving Warden's on-disk data directory.

IMPORTANT: Never hard-code a specific Windows username (e.g. "naxos").
Every user who runs Warden has their own %LOCALAPPDATA%, and this must
resolve correctly for all of them.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP_DIR_NAME = "Warden"


def get_data_dir() -> Path:
    """
    Return the per-user Warden data directory, creating it (and the
    subfolders Warden relies on) if it doesn't exist yet.

    Windows:  %LOCALAPPDATA%\\Warden   -> C:\\Users\\<user>\\AppData\\Local\\Warden
    macOS:    ~/Library/Application Support/Warden   (dev convenience)
    Linux:    ~/.local/share/Warden                  (dev convenience)
    """
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        if not base:
            # Extremely unlikely on real Windows, but fall back safely
            # instead of crashing or guessing a username.
            base = str(Path.home() / "AppData" / "Local")
        data_dir = Path(base) / APP_DIR_NAME
    elif sys.platform == "darwin":
        data_dir = Path.home() / "Library" / "Application Support" / APP_DIR_NAME
    else:
        base = os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))
        data_dir = Path(base) / APP_DIR_NAME

    ensure_data_dirs(data_dir)
    return data_dir


def ensure_data_dirs(data_dir: Path) -> None:
    """Create the data dir and the subfolders Warden expects."""
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "logs").mkdir(exist_ok=True)
    (data_dir / "cache").mkdir(exist_ok=True)
    (data_dir / "cache" / "item_sprites").mkdir(exist_ok=True)


def item_sprites_cache_dir(data_dir: Path | None = None) -> Path:
    """Where downloaded item sprites live once a client has fetched
    them from the central server -- one PNG per item name, reused
    forever after (see main.py Api.get_item_image)."""
    return (data_dir or get_data_dir()) / "cache" / "item_sprites"


def config_path(data_dir: Path | None = None) -> Path:
    return (data_dir or get_data_dir()) / "config.json"


def db_path(data_dir: Path | None = None) -> Path:
    return (data_dir or get_data_dir()) / "warden.db"


def log_path(data_dir: Path | None = None) -> Path:
    return (data_dir or get_data_dir()) / "logs" / "warden.log"
