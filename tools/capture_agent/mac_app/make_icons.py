"""Draws the menu-bar template icon and the app icon (.icns). Run by build.sh; needs Pillow and `iconutil`."""
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

out = Path(__file__).resolve().parent / "icons"
out.mkdir(exist_ok=True)


def record_mark(size: int, fg, bg=None, pad=0.14) -> Image.Image:
    """A ring with a dot: the universal 'recording' mark."""
    s = size * 4  # supersample
    im = Image.new("RGBA", (s, s), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    p = int(s * pad)
    d.ellipse([p, p, s - p, s - p], outline=fg, width=max(2, int(s * 0.085)))
    c, r = s // 2, int(s * 0.17)
    d.ellipse([c - r, c - r, c + r, c + r], fill=fg)
    return im.resize((size, size), Image.LANCZOS)


# menu bar: black on transparent, macOS tints it (template image)
record_mark(18, (0, 0, 0, 255)).save(out / "menubar.png")
record_mark(36, (0, 0, 0, 255)).save(out / "menubar@2x.png")

# app icon: white mark on a near-black rounded square
tmp = Path(tempfile.mkdtemp()) / "app.iconset"
tmp.mkdir()
for base in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = base * scale
        bg = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        d = ImageDraw.Draw(bg)
        d.rounded_rectangle([0, 0, px - 1, px - 1], radius=int(px * 0.225), fill=(23, 23, 23, 255))
        mark = record_mark(px, (250, 250, 250, 255), pad=0.24)
        bg.alpha_composite(mark)
        bg.save(tmp / (f"icon_{base}x{base}.png" if scale == 1 else f"icon_{base}x{base}@2x.png"))
subprocess.run(["iconutil", "-c", "icns", str(tmp), "-o", str(out / "app.icns")], check=True)
shutil.rmtree(tmp.parent)
print("icons written to", out)
