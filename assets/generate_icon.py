"""
Generates assets/icon.png and assets/icon.ico from scratch (no source
image) -- matches the diamond/ring mark already used in ui/app.html's
inline SVG brand logo, on the app's void/blood color scheme. Used for
the tray icon and the PyInstaller app icon.

Run: python assets/generate_icon.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).parent
VOID = (8, 9, 11, 255)
BLOOD = (209, 41, 61, 255)
BLOOD_DIM = (140, 28, 41, 255)
WHITE = (238, 240, 244, 255)
SIZE = 512


def draw_mark(size: int) -> Image.Image:
    scale = size / 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    cx = cy = size / 2
    r_bg = 248 * scale

    # Rounded void background disc
    d.ellipse([cx - r_bg, cy - r_bg, cx + r_bg, cy + r_bg], fill=VOID)

    # Outer ring (dim), with a blood accent arc
    ring_r = 208 * scale
    ring_w = max(2, int(14 * scale))
    d.ellipse(
        [cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
        outline=(36, 40, 50, 255), width=ring_w,
    )
    d.arc(
        [cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
        start=-100, end=-20, fill=BLOOD, width=ring_w,
    )

    # Diamond mark (echoes the app.html brand SVG's <path d="M20 10 L27 22 L20 30 L13 22 Z">)
    dia_r = 132 * scale
    points = [
        (cx, cy - dia_r),
        (cx + dia_r * 0.82, cy),
        (cx, cy + dia_r),
        (cx - dia_r * 0.82, cy),
    ]
    d.polygon(points, outline=WHITE, width=max(2, int(10 * scale)))

    # Center dot
    dot_r = 22 * scale
    d.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=BLOOD)

    return img


def main() -> None:
    icon = draw_mark(SIZE)
    icon.save(OUT_DIR / "icon.png")

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [draw_mark(s) for s in ico_sizes]
    frames[-1].save(
        OUT_DIR / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in ico_sizes],
    )
    print(f"Wrote {OUT_DIR / 'icon.png'} and {OUT_DIR / 'icon.ico'}")


if __name__ == "__main__":
    main()
