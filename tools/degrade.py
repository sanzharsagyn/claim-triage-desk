"""Turns a clean render into a believable scan or phone photo.
    python3 tools/degrade.py scan|photo input.png output.jpg
Deterministic (fixed random seed), so the images do not change between runs."""
import random
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

mode, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
random.seed(7)
img = Image.open(src).convert("RGB")


def noise(im, amount):
    n = Image.effect_noise(im.size, amount).convert("RGB")
    return ImageChops.add(ImageChops.multiply(im, Image.new("RGB", im.size, (246, 244, 236))), ImageChops.subtract(n, Image.new("RGB", im.size, (128, 128, 128))), 1.0, 0)


if mode == "scan":
    im = img.rotate(-0.8, resample=Image.BICUBIC, expand=True, fillcolor=(250, 250, 248))
    im = noise(im, 18).filter(ImageFilter.GaussianBlur(0.7))
    im = ImageOps.autocontrast(ImageOps.grayscale(im), cutoff=1).convert("RGB")
    # a faint grey band at the top edge, like a lid that did not close fully
    band = Image.new("L", im.size, 0)
    ImageDraw.Draw(band).rectangle([0, 0, im.size[0], 18], fill=70)
    im = Image.composite(Image.new("RGB", im.size, (120, 120, 120)), im, band.filter(ImageFilter.GaussianBlur(8)))
    im.thumbnail((1240, 1754))
    im.save(dst, "JPEG", quality=68, optimize=True)
else:
    w, h = img.size
    pad = 140
    canvas = Image.new("RGB", (w + 2 * pad, h + 2 * pad), (88, 74, 60))  # wooden desk
    canvas = noise(canvas, 30).filter(ImageFilter.GaussianBlur(1.2))
    paper = noise(img, 10)
    canvas.paste(paper, (pad, pad))
    W, H = canvas.size
    # perspective: the phone was held slightly tilted
    coeffs_src = [(0, 0), (W, 0), (W, H), (0, H)]
    coeffs_dst = [(60, 30), (W - 20, 0), (W - 70, H - 10), (10, H - 40)]

    def find_coeffs(pa, pb):
        import numpy as np  # noqa: PLC0415
        m = []
        for p1, p2 in zip(pa, pb):
            m.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
            m.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
        a = np.array(m, dtype=float)
        bb = np.array(pb).reshape(8)
        return np.linalg.solve(a, bb).tolist()

    im = canvas.transform((W, H), Image.PERSPECTIVE, find_coeffs(coeffs_dst, coeffs_src), Image.BICUBIC, fillcolor=(70, 60, 50))
    # soft shadow from the phone across the lower right
    shade = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shade).ellipse([W * 0.45, H * 0.55, W * 1.4, H * 1.4], fill=95)
    im = Image.composite(Image.new("RGB", (W, H), (30, 26, 22)), im, shade.filter(ImageFilter.GaussianBlur(120)))
    im = im.filter(ImageFilter.GaussianBlur(0.8)).rotate(1.6, resample=Image.BICUBIC, fillcolor=(70, 60, 50))
    im.thumbnail((1200, 1600))
    im.save(dst, "JPEG", quality=74, optimize=True)
