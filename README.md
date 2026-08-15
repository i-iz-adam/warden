# Warden

A SpawnPK companion desktop app: live drop/kill/event feed, PK and
macro timers, a watchlist, and grand-exchange market history — backed
by a central server that multiple clients report into and sync from.

pywebview renders `ui/app.html` as a frameless native window with a
custom titlebar; `main.py` is the Python side of the bridge
(`window.pywebview.api`) and owns local storage, the window chrome,
and the connection to the central server.

## Repo layout

This project is split across two repos (see `bootstrap-repos.bat`):

| Repo | Contents | Deploys as |
|---|---|---|
| `warden` (this repo) | `main.py`, `ui/`, `sync/`, `config.py`, `paths.py`, `local_store.py` | a packaged desktop executable, one per user |
| [`warden-server`](server/README.md) | `server/` | one always-on process, typically behind Tailscale |

`server/` still lives in this working tree for local dev convenience,
but it's excluded from this repo's git history (see `.gitignore`) and
has its own `.git` — it's pushed to `warden-server` independently.

## Running from source

```
pip install -r requirements.txt
python main.py
```

First launch walks through the onboarding wizard (username, accent
color); after that it's persisted and subsequent launches go straight
to the dashboard.

## Data & config

Resolved per-user at runtime via `paths.get_data_dir()` — never
hard-coded to a specific account:

| Platform | Location |
|---|---|
| Windows | `%LOCALAPPDATA%\Warden` |
| macOS (dev) | `~/Library/Application Support/Warden` |
| Linux (dev) | `~/.local/share/Warden` |

Inside it: `config.json` (settings), `warden.db` (local SQLite event
cache + watchlist), `logs/warden.log`.

Key settings in `config.json`:

- `api_endpoint` / `api_http_base` — the central server's WS and REST
  base URLs. Leave both unset and the app runs fully offline, using
  its built-in demo data generator for anything not yet fed by real
  events.
- `close_behavior` — `"background"` (default: the × button hides the
  window to the tray, WS sync keeps running so notifications still
  arrive) or `"exit"` (× fully quits). Toggleable from the Settings
  page.

## Startup sequence

1. `paths.get_data_dir()` resolves/creates the per-user data dir.
2. If `api_endpoint`/`api_http_base` are set, `main.py` does a
   one-shot REST backfill against the central server's
   `GET /events/recent` and writes anything new into the local cache
   — this is what makes the dashboard feed non-empty on the very
   first frame, rather than waiting on live WS traffic.
3. The frameless window opens; `sync/client.py` holds a reconnecting
   WebSocket open to `/events/stream` for everything from that point
   forward, writing each event to the local cache and pushing it into
   the open dashboard via `window.wardenOnServerEvent(event)`.
4. A tray icon (`tray.py`, via `pystray`) starts in the background so
   the window can be hidden without killing the process.

None of steps 2–4 block the app from working fully offline.

## Window chrome

The window is frameless (`webview.create_window(..., frameless=True)`)
— `ui/app.html`'s `.topbar` carries the `pywebview-drag-region` class
for dragging, and the `.winctl` buttons call `api.minimize_window()`,
`api.toggle_maximize_window()`, and `api.request_close()`
(`ui/app.js`: `initWindowChrome()`). Closing behavior is governed by
`close_behavior` in config; the tray icon (Show / Quit) is the way
back in when backgrounded.

## Building a standalone executable

```
pip install pyinstaller
python scripts/build.py
```

Produces `dist/Warden.exe` (Windows), `dist/Warden.app` (macOS), or
`dist/Warden` (Linux), icon included. `.github/workflows/build.yml`
runs this on all three OSes on every push to `main`, and attaches the
zipped artifacts to a GitHub release automatically on any `v*` tag
push.

To regenerate the app icon (`assets/icon.png` / `assets/icon.ico`):

```
python assets/generate_icon.py
```

## Bootstrapping the GitHub repos

```
bootstrap-repos.bat
```

Requires `git` and an authenticated `gh` CLI (`gh auth login` first).
Initializes and pushes both `i-iz-adam/warden` and
`i-iz-adam/warden-server`; safe to re-run — it commits/pushes on top
of whatever's already there instead of failing.
