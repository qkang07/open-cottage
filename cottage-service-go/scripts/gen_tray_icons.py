"""Rasterize assets/logo-light.svg into tray PNG/ICO (tight crop + status badges).

Windows systray cannot use SVG; this script is the source-of-truth converter.
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SVG_PATH = ROOT / "assets" / "logo-light.svg"
TRAY_DIR = ROOT / "internal" / "tray"
ASSETS = ROOT / "assets"

# Colors from logo-light.svg
STROKE = (0x60, 0x7B, 0x66, 255)
FILL = (0xC9, 0x7A, 0x3D, 255)


def _bez_cubic(p0, p1, p2, p3, steps=24):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def _bez_quad(p0, p1, p2, steps=16):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**2 * p0[0] + 2 * u * t * p1[0] + t**2 * p2[0]
        y = u**2 * p0[1] + 2 * u * t * p1[1] + t**2 * p2[1]
        pts.append((x, y))
    return pts


def render_logo_from_svg(size: int = 512) -> Image.Image:
    """Draw the known logo-light paths (viewBox 0 0 120 120) at high res."""
    # House outline (open path, stroke only)
    # M 16 108 L 16 56 Q 16 44 26 36 L 52 18 Q 60 13 68 18 L 94 36 Q 104 44 104 56 L 104 108
    house = []
    house.append((16, 108))
    house.append((16, 56))
    house.extend(_bez_quad((16, 56), (16, 44), (26, 36))[1:])
    house.append((52, 18))
    house.extend(_bez_quad((52, 18), (60, 13), (68, 18))[1:])
    house.append((94, 36))
    house.extend(_bez_quad((94, 36), (104, 44), (104, 56))[1:])
    house.append((104, 108))

    # Star (closed cubic path)
    # M 60 46 C 60 62 68 70 84 70 C 68 70 60 78 60 94 C 60 78 52 70 36 70 C 52 70 60 62 60 46 Z
    star = []
    star.extend(_bez_cubic((60, 46), (60, 62), (68, 70), (84, 70)))
    star.extend(_bez_cubic((84, 70), (68, 70), (60, 78), (60, 94))[1:])
    star.extend(_bez_cubic((60, 94), (60, 78), (52, 70), (36, 70))[1:])
    star.extend(_bez_cubic((36, 70), (52, 70), (60, 62), (60, 46))[1:])

    # Render oversized then crop to ink bounds (removes SVG viewBox padding).
    canvas = 640
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    scale = canvas / 120.0
    stroke_w = max(1, int(16 * scale))

    def sx(pts):
        return [(x * scale, y * scale) for x, y in pts]

    d.line(sx(house), fill=STROKE, width=stroke_w, joint="curve")
    r = stroke_w / 2
    for x, y in (house[0], house[-1]):
        cx, cy = x * scale, y * scale
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=STROKE)

    d.polygon(sx(star), fill=FILL)

    alpha = img.split()[-1]
    bbox = alpha.getbbox()
    if not bbox:
        raise SystemExit("empty logo render")
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = max(2, int(max(w, h) * 0.02))
    bbox = (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(img.width, bbox[2] + pad),
        min(img.height, bbox[3] + pad),
    )
    cropped = img.crop(bbox)
    lw, lh = cropped.size
    s = size / max(lw, lh)
    return cropped.resize((max(1, int(lw * s)), max(1, int(lh * s))), Image.Resampling.LANCZOS)


def make_base(logo: Image.Image, size: int) -> Image.Image:
    # Transparent canvas — no plate / background fill.
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    margin = max(1, int(size * 0.04))
    box = size - 2 * margin
    lw, lh = logo.size
    scale = min(box / lw, box / lh)
    nw, nh = max(1, int(lw * scale)), max(1, int(lh * scale))
    logo_r = logo.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (size - nw) // 2
    y = (size - nh) // 2
    out.alpha_composite(logo_r, (x, y))
    return out


def add_badge(img: Image.Image, color: tuple[int, int, int, int]) -> Image.Image:
    out = img.copy()
    s = out.size[0]
    d = ImageDraw.Draw(out)
    r = max(3, int(s * 0.18))
    cx = s - max(2, int(s * 0.18))
    cy = s - max(2, int(s * 0.18))
    # Light + dark ring so the badge reads on both light and dark taskbars.
    d.ellipse((cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2), fill=(255, 255, 255, 230))
    d.ellipse((cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1), fill=(30, 30, 30, 220))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)
    return out


def save_ico(img64: Image.Image, path: Path, sizes: list[int]) -> None:
    # Pillow ICO writer resizes from the primary image when given sizes=.
    img64.save(path, format="ICO", sizes=[(s, s) for s in sizes])



def ensure_svg_synced() -> None:
    text = SVG_PATH.read_text(encoding="utf-8")
    if "viewBox" not in text or "#607b66" not in text:
        raise SystemExit(f"unexpected SVG content in {SVG_PATH}")
    if not re.search(r'viewBox="0 0 120 120"', text):
        raise SystemExit(f"unexpected viewBox in {SVG_PATH}")


def main() -> None:
    ensure_svg_synced()
    logo = render_logo_from_svg(512)
    print(f"cropped logo {logo.size}")

    sizes = [16, 24, 32, 48, 64]
    bases = {sz: make_base(logo, sz) for sz in sizes}
    running = {sz: add_badge(bases[sz], (46, 204, 113, 255)) for sz in sizes}
    stopped = {sz: add_badge(bases[sz], (148, 163, 184, 255)) for sz in sizes}

    ASSETS.mkdir(parents=True, exist_ok=True)
    TRAY_DIR.mkdir(parents=True, exist_ok=True)

    # Primary outputs live under assets/ (what you browse in the repo).
    assets_files = {
        "tray.png": bases[64],
        "tray-running.png": running[64],
        "tray-stopped.png": stopped[64],
    }
    for name, img in assets_files.items():
        img.save(ASSETS / name)
    save_ico(running[64], ASSETS / "tray-running.ico", sizes)
    save_ico(stopped[64], ASSETS / "tray-stopped.ico", sizes)
    # Site favicon (no status badge) — also copied into UI static for the console page.
    save_ico(bases[64], ASSETS / "favicon.ico", sizes)

    # Copy into internal/tray for //go:embed (Go cannot embed ../assets).
    embed_map = {
        "icon.png": ASSETS / "tray-stopped.png",
        "icon.ico": ASSETS / "tray-stopped.ico",
        "icon-running.png": ASSETS / "tray-running.png",
        "icon-running.ico": ASSETS / "tray-running.ico",
        "icon-stopped.png": ASSETS / "tray-stopped.png",
        "icon-stopped.ico": ASSETS / "tray-stopped.ico",
    }
    for dst_name, src in embed_map.items():
        data = src.read_bytes()
        (TRAY_DIR / dst_name).write_bytes(data)

    ui_static = ROOT / "internal" / "ui" / "static"
    ui_static.mkdir(parents=True, exist_ok=True)
    for name in ("logo-light.svg", "logo-dark.svg", "favicon.ico"):
        src = ASSETS / name
        if src.exists():
            (ui_static / name).write_bytes(src.read_bytes())
    (ui_static / "favicon.png").write_bytes((ASSETS / "tray.png").read_bytes())

    print("assets/ (source of truth for humans):")
    for p in sorted(ASSETS.glob("tray*")):
        print(f"  {p.name:22} {p.stat().st_size}")
    print("internal/tray/ (copied for go:embed):")
    for p in sorted(TRAY_DIR.glob("icon*")):
        print(f"  {p.name:22} {p.stat().st_size}")


if __name__ == "__main__":
    main()
