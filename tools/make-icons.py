"""绘制 SP 缩写图标：圆角方形渐变底 + 白色 SP 字标，按尺寸原生绘制（4 倍超采样后缩放）。
用法：
  python tools/make-icons.py                 # 生成 edge/icons/ 下的 16/32/48/128 与 1024 母图
  python tools/make-icons.py --sheet         # 输出候选字体对比图，便于挑选
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "edge" / "icons"
SIZES = (16, 32, 48, 128)
MASTER = 1024
SUPERSAMPLE = 4

TOP_LEFT = (43, 74, 203)      # #2B4ACB
BOTTOM_RIGHT = (123, 63, 228)  # #7B3FE4
INK = (255, 255, 255)

FONTS = {
    "segoe": "C:/Windows/Fonts/segoeuib.ttf",
    "arial": "C:/Windows/Fonts/arialbd.ttf",
    "verdana": "C:/Windows/Fonts/verdanab.ttf",
}


def gradient(size: int) -> Image.Image:
    """左上到右下的对角渐变，逐行插值后再按列混合，比两色线性快且够用。"""
    img = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(size - 1, 1)
        row = tuple(round(TOP_LEFT[i] + (BOTTOM_RIGHT[i] - TOP_LEFT[i]) * t) for i in range(3))
        draw.line([(0, y), (size, y)], fill=row)
    right = Image.new("RGB", (size, size))
    rdraw = ImageDraw.Draw(right)
    for x in range(size):
        t = x / max(size - 1, 1)
        col = tuple(round(TOP_LEFT[i] + (BOTTOM_RIGHT[i] - TOP_LEFT[i]) * t) for i in range(3))
        rdraw.line([(x, 0), (x, size)], fill=col)
    return Image.blend(img, right, 0.5)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def word_mark(size: int, font_path: str, scale: float, tracking: float) -> Image.Image:
    """白色 SP 字标，单独渲染成透明图层，方便按尺寸定位。"""
    big = size * SUPERSAMPLE
    font = ImageFont.truetype(font_path, int(big * scale))
    tmp = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tmp)
    gap = int(big * tracking)
    bbox_s = draw.textbbox((0, 0), "S", font=font)
    bbox_p = draw.textbbox((0, 0), "P", font=font)
    width = (bbox_s[2] - bbox_s[0]) + gap + (bbox_p[2] - bbox_p[0])
    height = max(bbox_s[3] - bbox_s[1], bbox_p[3] - bbox_p[1])
    x = (big - width) / 2
    y = (big - height) / 2
    draw.text((x - bbox_s[0], y - bbox_s[1]), "S", font=font, fill=INK)
    x2 = x + (bbox_s[2] - bbox_s[0]) + gap
    draw.text((x2 - bbox_p[0], y - bbox_p[1]), "P", font=font, fill=INK)
    return tmp


def build(size: int, font_path: str, scale: float = None, tracking: float = -0.02, radius_ratio: float = 0.22) -> Image.Image:
    # 小尺寸把字标放大一点，否则 16px 下 SP 只剩几个像素高
    if scale is None:
        scale = 0.5 if size <= 32 else 0.44
    big = size * SUPERSAMPLE
    base = gradient(big)
    tile = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    tile.paste(base, (0, 0), rounded_mask(big, int(big * radius_ratio)))
    mark = word_mark(size, font_path, scale, tracking)
    tile = Image.alpha_composite(tile, mark)
    return tile.resize((size, size), Image.LANCZOS)


def main() -> int:
    if "--sheet" in sys.argv:
        row_h, previews = 120, (96, 48, 32, 16)
        sheet = Image.new("RGB", (760, row_h * len(FONTS)), (244, 245, 248))
        draw = ImageDraw.Draw(sheet)
        for index, (name, path) in enumerate(FONTS.items()):
            top = index * row_h
            draw.line([(0, top + row_h - 1), (760, top + row_h - 1)], fill=(220, 223, 230))
            x = 24
            for size in previews:
                icon = build(size, path)
                sheet.paste(icon, (x, top + (row_h - size) // 2), icon)
                x += size + 22
            draw.text((x + 10, top + row_h // 2 - 6), f"{name}  ·  96/48/32/16", fill=(60, 66, 78))
        target = ROOT / "vibe_images" / "sp-icon-candidates.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(target)
        print("对比图", target)
        return 0

    font = FONTS["segoe"]
    for size in SIZES:
        build(size, font).save(OUT_DIR / f"icon{size}.png")
    # 1024 母图不进扩展包，留给商店素材
    build(MASTER, font).save(ROOT / "vibe_images" / "sp-logo-1024.png")
    print("已写出", sorted(p.name for p in OUT_DIR.glob("*.png")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
