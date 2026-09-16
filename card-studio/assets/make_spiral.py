"""Generate bold, flame-like mane locks (red->orange) that radiate from the
center and continue the lion logo's swirl to the card edges."""
import math
from PIL import Image, ImageDraw

W, H = 1000, 1400
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
cx, cy = W // 2, H // 2

ARMS = 5
RED = (250, 48, 58)
ORANGE = (255, 178, 35)
MAXR = 1150
B = 0.34  # opens fast -> bold sweeping locks, not a tight tunnel

for k in range(ARMS):
    phase = 2 * math.pi * k / ARMS
    pts = []
    theta = 0.0
    while True:
        r = 55 * math.exp(B * theta)
        if r > MAXR:
            break
        x = cx + r * math.cos(theta + phase)
        y = cy + r * math.sin(theta + phase)
        pts.append((x, y, r))
        theta += 0.04
    for j in range(len(pts) - 1):
        (x1, y1, r1) = pts[j]
        (x2, y2, _) = pts[j + 1]
        t = min(1.0, r1 / MAXR)
        col = tuple(int(RED[c] + (ORANGE[c] - RED[c]) * t) for c in range(3))
        alpha = int(255 * (1.0 - 0.08 * t))                 # nearly opaque, vivid
        width = max(4, int(4 + 52 * math.sin(math.pi * min(t * 1.06, 1.0))))  # tapered lock
        d.line([(x1, y1), (x2, y2)], fill=col + (alpha,), width=width)

img.save(r"C:\Users\vaugh\discord\card-studio\assets\spiral_bg.png")
print("saved spiral_bg.png")
