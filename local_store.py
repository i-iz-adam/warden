"""
Offline-first local store. Every capture writes here first; the sync
client (added later) best-effort pushes rows to the central API and
marks them synced. Lives at <data_dir>/warden.db.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from paths import db_path

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    content_hash    TEXT UNIQUE,
    event_type      TEXT NOT NULL,
    raw_text        TEXT,
    fields          TEXT NOT NULL DEFAULT '{}',
    observed_at     TEXT NOT NULL,
    synced          INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watchlist (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,
    added_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_synced ON events(synced);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
"""


class LocalStore:
    def __init__(self, path: Path | None = None):
        self._path = path or db_path()
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self._path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # -- events -----------------------------------------------------
    def add_event(
        self,
        event_type: str,
        fields: dict[str, Any],
        observed_at: str,
        raw_text: str | None = None,
        content_hash: str | None = None,
    ) -> int | None:
        with self._lock:
            cur = self._conn.execute(
                """INSERT OR IGNORE INTO events
                   (content_hash, event_type, raw_text, fields, observed_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (content_hash, event_type, raw_text, json.dumps(fields), observed_at),
            )
            self._conn.commit()
            return cur.lastrowid if cur.rowcount else None

    def recent_events(self, event_type: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            if event_type:
                rows = self._conn.execute(
                    "SELECT * FROM events WHERE event_type = ? ORDER BY id DESC LIMIT ?",
                    (event_type, limit),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,)
                ).fetchall()
            return [self._row_to_dict(r) for r in rows]

    def unsynced_events(self, limit: int = 200) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM events WHERE synced = 0 ORDER BY id ASC LIMIT ?", (limit,)
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]

    def mark_synced(self, event_ids: list[int]) -> None:
        if not event_ids:
            return
        with self._lock:
            qs = ",".join("?" * len(event_ids))
            self._conn.execute(f"UPDATE events SET synced = 1 WHERE id IN ({qs})", event_ids)
            self._conn.commit()

    def clear_events(self) -> int:
        """Wipes the local event cache (not the central server's copy).
        Used by the Debug page's "Flush Cache" button when the local
        cache is suspected stale/corrupt -- the next backfill/WS
        stream will repopulate it. Returns the number of rows removed."""
        with self._lock:
            cur = self._conn.execute("DELETE FROM events")
            self._conn.commit()
            return cur.rowcount

    # -- watchlist ----------------------------------------------------
    def add_watch(self, username: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO watchlist (username) VALUES (?)", (username,)
            )
            self._conn.commit()

    def remove_watch(self, username: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM watchlist WHERE username = ?", (username,))
            self._conn.commit()

    def list_watch(self) -> list[str]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT username FROM watchlist ORDER BY added_at ASC"
            ).fetchall()
            return [r["username"] for r in rows]

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        if d.get("fields"):
            try:
                d["fields"] = json.loads(d["fields"])
            except json.JSONDecodeError:
                pass
        return d
