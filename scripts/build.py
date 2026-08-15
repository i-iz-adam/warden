"""
Builds a standalone Warden executable with PyInstaller for whatever OS
this is run on. Used locally (`python scripts/build.py`) and by
.github/workflows/build.yml, which runs it on windows-latest,
macos-latest, and ubuntu-latest to produce one artifact per platform.

Output lands in dist/ as produced by PyInstaller (Warden.exe on
Windows, Warden.app on macOS, Warden on Linux).
"""
from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_SEP = ";" if platform.system() == "Windows" else ":"


def add_data(src: Path, dest: str) -> str:
    return f"{src}{DATA_SEP}{dest}"


def icon_path() -> Path:
    # Windows wants a real .ico; other platforms are fine with the PNG
    # (macOS .icns would be nicer but requires a separate conversion
    # step PyInstaller doesn't do for you -- PNG is an acceptable dev icon).
    if platform.system() == "Windows":
        return ROOT / "assets" / "icon.ico"
    return ROOT / "assets" / "icon.png"


def main() -> None:
    icon = icon_path()
    if not icon.exists():
        subprocess.run([sys.executable, str(ROOT / "assets" / "generate_icon.py")], check=True, cwd=ROOT)

    args = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--name", "Warden",
        "--windowed",
        "--onefile",
        "--icon", str(icon),
        "--add-data", add_data(ROOT / "ui", "ui"),
        "--add-data", add_data(ROOT / "assets", "assets"),
        str(ROOT / "main.py"),
    ]
    subprocess.run(args, check=True, cwd=ROOT)


if __name__ == "__main__":
    main()
