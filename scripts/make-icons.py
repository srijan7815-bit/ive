#!/usr/bin/env python3
"""Generate IVE's icons: tray template + 1024px app icon (+ .icns on macOS)."""
from PIL import Image, ImageDraw, ImageFilter
import math
import io
import os
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
BUILD = os.path.join(ROOT, "build")
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(BUILD, exist_ok=True)

MINT = (158, 242, 207)
MINT_DEEP = (96, 205, 170)
BLUE = (143, 180, 255)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def aurora(size):
    """Mint bloom upper-left, cool blue upper-right, violet low."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    blooms = [
        (size * 0.60, size * 0.24, size * 0.20, (46, 205, 162, 120)),
        (size * 0.55, size * 0.80, size * 0.18, (74, 120, 230, 90)),
        (size * 0.50, size * 0.52, size * 0.92, (150, 90, 200, 55)),
    ]
    for r, cx, cy, col in blooms:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    return img.filter(ImageFilter.GaussianBlur(size * 0.11))


def app_icon(size=1024):
    S = size * 4
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)

    # vertical dark gradient
    for y in range(S):
        t = y / S
        c = (
            int(24 * (1 - t) + 7 * t),
            int(26 * (1 - t) + 8 * t),
            int(32 * (1 - t) + 10 * t),
            255,
        )
        d.line([(0, y), (S, y)], fill=c)

    base = Image.composite(base, Image.new("RGBA", (S, S), (0, 0, 0, 0)), rounded_mask(S, int(S * 0.225)))

    mask = rounded_mask(S, int(S * 0.225))
    bloom = aurora(S)
    base = Image.alpha_composite(base, Image.composite(bloom, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))

    # soft glow behind the mark
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gr = S * 0.24
    gd.ellipse([S * 0.5 - gr, S * 0.5 - gr * 0.9, S * 0.5 + gr, S * 0.5 + gr * 0.9], fill=(158, 242, 207, 42))
    base = Image.alpha_composite(base, glow.filter(ImageFilter.GaussianBlur(S * 0.09)))

    # the IVE mark: three bars
    grad = Image.new("RGBA", (1, S), (0, 0, 0, 0))
    for y in range(S):
        t = y / S
        c = (
            int(214 * (1 - t) + 118 * t),
            int(255 * (1 - t) + 226 * t),
            int(238 * (1 - t) + 184 * t),
            255,
        )
        grad.putpixel((0, y), c)
    grad = grad.resize((S, S))

    bars_mask = Image.new("L", (S, S), 0)
    bd = ImageDraw.Draw(bars_mask)
    w = S * 0.062
    gap = S * 0.045
    heights = [0.235, 0.385, 0.30]
    total = w * 3 + gap * 2
    x0 = (S - total) / 2
    cy = S * 0.50
    for i, h in enumerate(heights):
        hh = S * h
        x = x0 + i * (w + gap)
        bd.rounded_rectangle([x, cy - hh / 2, x + w, cy + hh / 2], radius=w / 2, fill=255)
    bars = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bars.paste(grad, (0, 0), bars_mask)
    base = Image.alpha_composite(base, bars)

    # glass rim
    rim = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    rd.rounded_rectangle(
        [S * 0.012, S * 0.012, S * 0.988, S * 0.988],
        radius=int(size * 0.222 * 4),
        outline=(255, 255, 255, 46),
        width=int(size * 0.006 * 4),
    )
    rd.line(
        [(S * 0.06, S * 0.014), (S * 0.94, S * 0.014)],
        fill=(255, 255, 255, 90),
        width=int(size * 0.005 * 4),
    )
    rim = rim.filter(ImageFilter.GaussianBlur(S * 0.0015))
    rim.putalpha(Image.composite(rim.getchannel("A"), Image.new("L", (S, S), 0), mask))
    base = Image.alpha_composite(base, rim)
    base.putalpha(Image.composite(base.getchannel("A"), Image.new("L", (S, S), 0), mask))

    return base.resize((size, size), Image.LANCZOS)


def tray_template(size=16):
    """Template image: pure black + alpha, macOS tints it for the menu bar."""
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = S * 0.15
    gap = S * 0.11
    heights = [0.42, 0.72, 0.55]
    total = w * 3 + gap * 2
    x0 = (S - total) / 2
    cy = S * 0.52
    for i, h in enumerate(heights):
        hh = S * h
        x = x0 + i * (w + gap)
        d.rounded_rectangle([x, cy - hh / 2, x + w, cy + hh / 2], radius=w / 2, fill=(0, 0, 0, 255))
    return img.resize((size, size), Image.LANCZOS)


ICNS_TYPES = [
    ("ic07", 128),   # 128x128
    ("ic08", 256),   # 256x256
    ("ic09", 512),   # 512x512
    ("ic10", 1024),  # 1024 (512@2x)
    ("ic11", 32),    # 16@2x
    ("ic12", 64),    # 32@2x
    ("ic13", 256),   # 128@2x
    ("ic14", 512),   # 256@2x
]


def write_icns(icon, path):
    """Minimal .icns writer: 8-byte header + typed PNG chunks."""
    chunks = []
    for tag, size in ICNS_TYPES:
        buf = io.BytesIO()
        icon.resize((size, size), Image.LANCZOS).save(buf, format="PNG")
        payload = buf.getvalue()
        chunks.append(tag.encode("ascii") + struct.pack(">I", len(payload) + 8) + payload)
    body = b"".join(chunks)
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main():
    icon = app_icon(1024)
    icon.save(os.path.join(BUILD, "icon.png"))
    print("✓ build/icon.png")

    # Windows/Linux packaging assets (harmless on macOS)
    for s in (512, 256, 128, 64, 32, 16):
        icon.resize((s, s), Image.LANCZOS).save(os.path.join(BUILD, f"icon-{s}.png"))

    tray_template(16).save(os.path.join(ASSETS, "trayTemplate.png"))
    tray_template(32).save(os.path.join(ASSETS, "trayTemplate@2x.png"))
    print("✓ assets/trayTemplate.png")

    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(ASSETS, "icon-512.png"))
    print("✓ assets/icon-512.png")

    # Windows: multi-size .ico (installer, shortcuts, taskbar)
    icon.save(os.path.join(BUILD, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("✓ build/icon.ico")

    # Windows tray must read well at 16px on both light and dark taskbars,
    # so it uses the mint mark on transparent, not a template image.
    tray_rgba = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    mark = tray_template(32)
    tint = Image.new("RGBA", (32, 32), (158, 242, 207, 255))
    tray_rgba.paste(tint, (0, 0), mark)
    tray_rgba.save(os.path.join(ASSETS, "tray-win.png"))
    print("✓ assets/tray-win.png")

    # macOS: write a real .icns on any platform (PNG-payload ICNS, 10.7+).
    write_icns(icon, os.path.join(BUILD, "icon.icns"))
    print("✓ build/icon.icns")

    if sys.platform == "darwin":
        iconset = os.path.join(BUILD, "icon.iconset")
        os.makedirs(iconset, exist_ok=True)
        for s in (16, 32, 64, 128, 256, 512):
            icon.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}.png"))
            icon.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(BUILD, "icon.icns")], check=True)


if __name__ == "__main__":
    main()
