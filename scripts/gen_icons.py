"""One-off generator for the PWA app icons (brand route+sun mark on the
#d67229 brand color). Run with: python scripts/gen_icons.py
Not part of the app runtime — regenerate manually if the brand color changes.
"""
from PIL import Image, ImageDraw
import os

BRAND = (214, 114, 41)  # #d67229
WHITE = (255, 255, 255)
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

SIZE = 512


def quad_bezier(p0, p1, p2, steps=64):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
        pts.append((x, y))
    return pts


def stroke_path(draw, pts, radius):
    """Stamp overlapping filled circles along pts — avoids the seam artifacts
    a thick multi-segment ImageDraw.line(joint='curve') leaves at small sizes."""
    for x, y in pts:
        draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=WHITE)


def draw_mark(size):
    img = Image.new("RGB", (size, size), BRAND)
    draw = ImageDraw.Draw(img)
    s = size / 512.0

    # Winding road (lower-left to upper-middle), kept inside the ~80%
    # maskable safe zone and clear of the sun so both read distinctly.
    start = (118 * s, 400 * s)
    ctrl = (190 * s, 230 * s)
    end = (295 * s, 145 * s)
    pts = quad_bezier(start, ctrl, end, steps=160)
    stroke_path(draw, pts, radius=17 * s)
    # Start waypoint marker (slightly larger dot).
    r_wp = 24 * s
    draw.ellipse(
        [start[0] - r_wp, start[1] - r_wp, start[0] + r_wp, start[1] + r_wp],
        fill=WHITE,
    )

    # Sun, top-right, with short rays so it doesn't read as a stray dot.
    sun_c = (368 * s, 152 * s)
    r_sun = 36 * s
    for angle_deg in (20, 65, 110, 155):
        import math

        a = math.radians(angle_deg)
        dx, dy = math.cos(a), math.sin(a)
        inner = r_sun + 10 * s
        outer = r_sun + 24 * s
        p1 = (sun_c[0] + dx * inner, sun_c[1] + dy * inner)
        p2 = (sun_c[0] + dx * outer, sun_c[1] + dy * outer)
        draw.line([p1, p2], fill=WHITE, width=int(11 * s))
        draw.ellipse(
            [p2[0] - 5.5 * s, p2[1] - 5.5 * s, p2[0] + 5.5 * s, p2[1] + 5.5 * s], fill=WHITE
        )
    draw.ellipse(
        [sun_c[0] - r_sun, sun_c[1] - r_sun, sun_c[0] + r_sun, sun_c[1] + r_sun],
        fill=WHITE,
    )
    return img


base = draw_mark(SIZE)
base.save(os.path.join(OUT_DIR, "icon-512.png"))
base.save(os.path.join(OUT_DIR, "maskable-512.png"))

for name, sz in [
    ("icon-192.png", 192),
    ("maskable-192.png", 192),
    ("apple-touch-icon.png", 180),
]:
    base.resize((sz, sz), Image.LANCZOS).save(os.path.join(OUT_DIR, name))

favicon_sizes = [16, 32, 48]
favicon_imgs = [base.resize((s, s), Image.LANCZOS) for s in favicon_sizes]
favicon_imgs[0].save(
    os.path.join(OUT_DIR, "favicon.ico"),
    sizes=[(s, s) for s in favicon_sizes],
)

print("done:", os.listdir(OUT_DIR))
