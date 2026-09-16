from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont


ROOT = Path("/Users/changliu/Desktop/Lucky Nail/LUVIA_半径品牌视觉资产包")
GEN = Path("/Users/changliu/.codex/generated_images/01a0a5fb-3356-7340-b9dd-e50543857ea3")
OUT = ROOT / "03_社交媒体_线上物料" / "头像_编辑笔刷精修版"
LOGO = ROOT / "01_LOGO_标志系统" / "04_单色_黑" / "B2_主LOGO-无标语版-加粗.png"
FONT_LIGHT = ROOT / "04_字体文件" / "Jost-Light.ttf"
FONT_REGULAR = ROOT / "04_字体文件" / "Jost-Regular.ttf"

ITEMS = [
    {
        "platform": "小红书",
        "name": "01_单笔斜刷",
        "bg": GEN / "exec-ccb33371-3346-4c15-a828-4144880cc77d.png",
        "logo_w": 0.66,
        "logo_y": 0.485,
        "tag_y": 0.655,
    },
    {
        "platform": "微信",
        "name": "02_叠版拓印",
        "bg": GEN / "exec-92ea1dc2-0628-4c92-9ae8-dd67d590ff57.png",
        "logo_w": 0.63,
        "logo_y": 0.47,
        "tag_y": 0.635,
    },
    {
        "platform": "抖音",
        "name": "03_弧形滚印",
        "bg": GEN / "exec-3e62f109-58de-4c8d-a97e-21a8e0e93c51.png",
        "logo_w": 0.65,
        "logo_y": 0.47,
        "tag_y": 0.64,
    },
]


def crop_square(image: Image.Image, size: int) -> Image.Image:
    image = image.convert("RGB")
    side = min(image.size)
    x = (image.width - side) // 2
    y = (image.height - side) // 2
    return image.crop((x, y, x + side, y + side)).resize((size, size), Image.Resampling.LANCZOS)


def crop_alpha(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    bbox = image.getbbox()
    if not bbox:
        raise ValueError(path)
    return image.crop(bbox)


def resize_width(image: Image.Image, width: int) -> Image.Image:
    return image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)


def centered_text(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, font, fill) -> None:
    box = draw.textbbox((0, 0), text, font=font)
    draw.text((x - (box[2] - box[0]) // 2, y), text, font=font, fill=fill)


def compose(item: dict, size: int, circular: bool) -> Image.Image:
    canvas = crop_square(Image.open(item["bg"]), size)
    canvas = ImageEnhance.Contrast(canvas).enhance(0.96).convert("RGBA")
    ink = (31, 27, 25, 242)

    logo = crop_alpha(LOGO)
    logo = resize_width(logo, round(size * (item["logo_w"] - (0.06 if circular else 0))))
    logo_layer = Image.new("RGBA", logo.size, (31, 27, 25, 255))
    logo_layer.putalpha(logo.getchannel("A"))
    logo_y = round(size * item["logo_y"])
    canvas.alpha_composite(logo_layer, ((size - logo.width) // 2, logo_y - logo.height // 2))

    draw = ImageDraw.Draw(canvas)
    tagline_font = ImageFont.truetype(str(FONT_LIGHT), round(size * (0.024 if circular else 0.026)))
    centered_text(
        draw,
        size // 2,
        round(size * item["tag_y"]),
        "NAIL  ·  LASH  ·  BEAUTY ATELIER",
        tagline_font,
        ink,
    )

    micro_font = ImageFont.truetype(str(FONT_REGULAR), round(size * 0.0105))
    top = round(size * (0.175 if circular else 0.075))
    bottom = round(size * (0.81 if circular else 0.915))
    xs = (0.22, 0.50, 0.78) if circular else (0.10, 0.50, 0.90)
    labels = ("CUSTOM QUALITY", "NAIL ART", "CUSTOM LASH DESIGN")
    for x, label in zip(xs, labels):
        centered_text(draw, round(size * x), top, label, micro_font, ink)
        centered_text(draw, round(size * x), bottom, label, micro_font, ink)

    # A small editorial slash: simple, repeatable and legible even after circular cropping.
    draw.line(
        (round(size * 0.475), round(size * 0.72), round(size * 0.525), round(size * 0.687)),
        fill=ink,
        width=max(1, size // 1080),
    )
    return canvas


def circle(image: Image.Image) -> Image.Image:
    size = image.width
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    image.putalpha(mask)
    return image


def preview(squares: list[Image.Image], circles: list[Image.Image]) -> Image.Image:
    tile, gap = 480, 28
    sheet = Image.new("RGB", (tile * 3 + gap * 4, tile * 2 + gap * 3), "#E8E4DC")
    for row, images in enumerate((squares, circles)):
        for col, image in enumerate(images):
            thumb = image.resize((tile, tile), Image.Resampling.LANCZOS)
            x, y = gap + col * (tile + gap), gap + row * (tile + gap)
            sheet.paste(thumb, (x, y), thumb if thumb.mode == "RGBA" else None)
    return sheet


def proof(circles: list[Image.Image]) -> Image.Image:
    d, gap = 120, 22
    sheet = Image.new("RGB", (d * 3 + gap * 4, d + gap * 2), "#E8E4DC")
    for i, image in enumerate(circles):
        small = image.resize((d, d), Image.Resampling.LANCZOS)
        sheet.paste(small, (gap + i * (d + gap), gap), small)
    return sheet


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    squares, circles = [], []
    for item in ITEMS:
        square = compose(item, 1080, False)
        round_avatar = circle(compose(item, 1080, True))
        stem = f'LUVIA_{item["platform"]}_头像_{item["name"]}_加粗中文小字版'
        square.convert("RGB").save(OUT / f"{stem}_方形_1080.png", optimize=True)
        round_avatar.save(OUT / f"{stem}_圆形_1080.png", optimize=True)
        square.convert("RGB").resize((400, 400), Image.Resampling.LANCZOS).save(OUT / f"{stem}_方形_400.png", optimize=True)
        round_avatar.resize((400, 400), Image.Resampling.LANCZOS).save(OUT / f"{stem}_圆形_400.png", optimize=True)
        squares.append(square.convert("RGB"))
        circles.append(round_avatar)

    preview(squares, circles).save(OUT / "LUVIA_编辑笔刷精修版_方形圆形总览.png", optimize=True)
    proof(circles).save(OUT / "LUVIA_编辑笔刷精修版_120px头像验收.png", optimize=True)


if __name__ == "__main__":
    main()
