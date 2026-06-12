"""Generate PWA icons: a risk-gauge glyph on the dashboard's dark theme."""
from PIL import Image, ImageDraw
import os

BG = (11, 15, 23, 255)        # --bg
GREEN = (34, 197, 94, 255)
YELLOW = (234, 179, 8, 255)
RED = (239, 68, 68, 255)
WHITE = (240, 244, 250, 255)

def gauge(size, pad_ratio):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = int(size * pad_ratio)
    box = [pad, int(pad * 1.45), size - pad, size + int(size * 0.30)]
    w = int(size * 0.085)
    # PIL angles: 0 deg = 3 o'clock, clockwise. Top semicircle = 180..360
    d.arc(box, 180, 240, fill=RED, width=w)
    d.arc(box, 243, 297, fill=YELLOW, width=w)
    d.arc(box, 300, 360, fill=GREEN, width=w)
    cx = size / 2
    cy = (box[1] + box[3]) / 2
    import math
    ang = math.radians(315)  # needle pointing into the green
    r = (box[2] - box[0]) / 2 - w * 1.7
    d.line([cx, cy, cx + r * math.cos(ang), cy + r * math.sin(ang)],
           fill=WHITE, width=int(size * 0.045))
    d.ellipse([cx - size*0.045, cy - size*0.045, cx + size*0.045, cy + size*0.045], fill=WHITE)
    return img

def rounded(img, radius_ratio=0.18):
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size, size], int(size * radius_ratio), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out

os.makedirs("icons", exist_ok=True)
rounded(gauge(512, 0.16)).save("icons/icon-512.png")
rounded(gauge(512, 0.16)).resize((192, 192), Image.LANCZOS).save("icons/icon-192.png")
# maskable: full-bleed square, glyph inside the 80% safe zone
gauge(512, 0.24).save("icons/maskable-512.png")
print("icons written:", os.listdir("icons"))
