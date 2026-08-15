#!/usr/bin/env python3
"""
Generates versions.json for Warden auto-updates.
Requires pyupdater (pip install pyupdater).
"""

import json
import os
from datetime import datetime


def generate_versions_json(version: str, artifacts: dict) -> dict:
    """Generate versions.json structure."""
    return {
        "version": version,
        "date": datetime.now().isoformat(),
        "artifacts": artifacts,
        "checksums": {}
    }


def main():
    version = os.getenv("WARDEN_VERSION", "0.0.0+build.0")
    artifacts = {
        "windows": {
            "url": f"https://github.com/i-iz-adam/warden/releases/download/v{version}/Warden-windows-v{version}.zip",
            "platform": "windows"
        },
        "macos": {
            "url": f"https://github.com/i-iz-adam/warden/releases/download/v{version}/Warden-macos-v{version}.tar.gz",
            "platform": "macos"
        },
        "linux": {
            "url": f"https://github.com/i-iz-adam/warden/releases/download/v{version}/Warden-linux-v{version}.tar.gz",
            "platform": "linux"
        }
    }
    
    versions = generate_versions_json(version, artifacts)
    with open("versions.json", "w") as f:
        json.dump(versions, f, indent=2)
    print("versions.json generated.")


if __name__ == "__main__":
    main()