from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont


ASSET_ROOT = Path("/Users/changliu/Desktop/Lucky Nail/LUVIA_半径品牌视觉资产包")
GENERATED_ROOT = Path(
    "/Users/changliu/.codex/generated_images/01a0a5fb-3356-7340-b9dd-e50543857ea3"
)
OUTPUT_DIR = ASSET_ROOT / "03_社交媒体_线上物料" / "头像_编辑笔刷设计版"

WORDMARK = ASSET_ROOT / "01_LOGO_标志系统" / "04_单色_黑" / "A4_英文字标LUVIA.png"
JOST_LIGHT = ASSET_ROOT / "04_字体文件" / "Jost-Light.ttf"
JOST_REGULAR = ASSET_ROOT / "04_字体文件" / "Jost-Regular.ttf"

CONFIGS = [
    {
        "platform": "小红书",
        "name": "暖白斜向干刷",
        "background": GENERATED_ROOT / "exec-7d937a36-570c-478b-9a52-f317f8a469a7.png",
        "tone": (29, 29, 29),
        "wordmark_ratio": 0.73,
        "wordmark_y": 0.42,
    },
    {
        "platform": "微信",
        "name": "灰棕横向刷痕",
        "background": GENERATED_ROOT / "exec-c58173a6-29d8-45f0-b4a0-77653a4665fc.png",
        "tone": (42, 34, 30),
        "wordmark_ratio": 0.72,
        "wordmark_y": 0.43,
    },
    {
        "platform": "抖音",
        "name": "可可玫瑰弧刷",
        "background": GENERATED_ROOT / "exec-da5c0f96-b829-42b8-a827-cb898cc0fa4f.png",
        "tone": (35, 27, 25),
        "wordmark_ratio": 0.70,
        "wordmark_y": 0.44,
    },
]


def square_crop(image: Image.Image, size: int) -> Image.Image:
    image = image.convert("RGB")
    side = min(image.size)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    return image.crop((left, top, left + side, top + side)).resize(
        (size, size), Image.Resampling.LANCZOS
    )


def cropped_rgba(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    bbox = image.getbbox()
    if bbox is None:
        raise ValueError(f"No visible pixels: {path}")
    return image.crop(bbox)


def resize_width(image: Image.Image, width: int) -> Image.Image:
    return image.resize(
        (width, round(image.height * width / image.width)), Image.Resampling.LANCZOS
    )


def recolor_alpha(image: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    layer = Image.new("RGBA", image.size, color + (255,))
    layer.putalpha(image.getchannel("A"))
    return layer


def centered_text(draw: ImageDraw.ImageDraw, y: int, text: str, font: ImageFont.FreeTypeFont, fill, width: int) -> None:
    box = draw.textbbox((0, 0), text, font=font)
    x = (width - (box[2] - box[0])) // 2
    draw.text((x, y), text, font=font, fill=fill)


def draw_micro_typography(draw: ImageDraw.ImageDraw, color, size: int, circular: bool) -> None:
    micro = ImageFont.truetype(str(JOST_REGULAR), round(size * 0.012))
    labels = ("NAIL ART", "LASH DESIGN", "BEAUTY ATELIER")
    xs = (round(size * 0.20), round(size * 0.50), round(size * 0.80)) if circular else (
        round(size * 0.10), round(size * 0.50), round(size * 0.90)
    )
    top = round(size * (0.17 if circular else 0.075))
    bottom = round(size * (0.81 if circular else 0.91))
    for x, label in zip(xs, labels):
        box = draw.textbbox((0, 0), label, font=micro)
        tx = x - (box[2] - box[0]) // 2
        draw.text((tx, top), label, font=micro, fill=color)
        draw.text((tx, bottom), label, font=micro, fill=color)


def draw_centered_label(draw: ImageDraw.ImageDraw, size: int, color) -> None:
    # A very small editorial device, using existing brand language rather than invented copy.
    label_font = ImageFont.truetype(str(JOST_REGULAR), round(size * 0.0105))
    text = "CENTERED ON YOURSELF"
    box = draw.textbbox((0, 0), text, font=label_font)
    text_width = box[2] - box[0]
    pill_width = text_width + round(size * 0.045)
    pill_height = round(size * 0.038)
    x0 = (size - pill_width) // 2
    y0 = round(size * 0.685)
    draw.ellipse((x0, y0, x0 + pill_width, y0 + pill_height), outline=color, width=max(1, size // 1080))
    centered_text(draw, y0 + round(size * 0.011), text, label_font, color, size)


def compose(config: dict, size: int, circular: bool) -> Image.Image:
    background = square_crop(Image.open(config["background"]), size)
    background = ImageEnhance.Contrast(background).enhance(0.96).convert("RGBA")
    color = config["tone"] + (245,)

    wordmark = recolor_alpha(cropped_rgba(WORDMARK), config["tone"])
    ratio = config["wordmark_ratio"] - (0.06 if circular else 0)
    wordmark = resize_width(wordmark, round(size * ratio))
    y_center = round(size * config["wordmark_y"])
    background.alpha_composite(wordmark, ((size - wordmark.width) // 2, y_center - wordmark.height // 2))

    draw = ImageDraw.Draw(background)
    tagline_font = ImageFont.truetype(str(JOST_LIGHT), round(size * (0.024 if circular else 0.026)))
    centered_text(
        draw,
        round(size * 0.565),
        "NAIL  ·  LASH  ·  BEAUTY ATELIER",
        tagline_font,
        color,
        size,
    )
    draw.line(
        (round(size * 0.47), round(size * 0.635), round(size * 0.53), round(size * 0.600)),
        fill=color,
        width=max(1, size // 1080),
    )
    draw_centered_label(draw, size, color)
    draw_micro_typography(draw, color, size, circular)
    return background


def circular_version(image: Image.Image) -> Image.Image:
    size = image.width
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    result = image.copy()
    result.putalpha(mask)
    return result


def make_preview(squares: list[Image.Image], circles: list[Image.Image]) -> Image.Image:
    tile = 440
    gap = 26
    sheet = Image.new("RGB", (tile * 3 + gap * 4, tile * 2 + gap * 3), "#E9E5DE")
    for row, images in enumerate((squares, circles)):
        for index, image in enumerate(images):
            thumb = image.resize((tile, tile), Image.Resampling.LANCZOS)
            x = gap + index * (tile + gap)
            y = gap + row * (tile + gap)
            sheet.paste(thumb, (x, y), thumb if thumb.mode == "RGBA" else None)
    return sheet


def make_small_proof(circles: list[Image.Image]) -> Image.Image:
    diameter = 120
    gap = 18
    proof = Image.new("RGB", (diameter * 3 + gap * 4, diameter + gap * 2), "#E9E5DE")
    for index, image in enumerate(circles):
        small = image.resize((diameter, diameter), Image.Resampling.LANCZOS)
        proof.paste(small, (gap + index * (diameter + gap), gap), small)
    return proof


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    squares = []
    circles = []
    for config in CONFIGS:
        square = compose(config, 1080, False)
        circle = circular_version(compose(config, 1080, True))
        stem = f'LUVIA_{config["platform"]}_店铺头像_{config["name"]}_英文字标小字版'
        square.convert("RGB").save(OUTPUT_DIR / f"{stem}_方形_1080.png", optimize=True)
        circle.save(OUTPUT_DIR / f"{stem}_圆形_1080.png", optimize=True)
        square.convert("RGB").resize((400, 400), Image.Resampling.LANCZOS).save(
            OUTPUT_DIR / f"{stem}_方形_400.png", optimize=True
        )
        circle.resize((400, 400), Image.Resampling.LANCZOS).save(
            OUTPUT_DIR / f"{stem}_圆形_400.png", optimize=True
        )
        squares.append(square.convert("RGB"))
        circles.append(circle)

    make_preview(squares, circles).save(
        OUTPUT_DIR / "LUVIA_参考图方向_编辑笔刷头像_方圆预览.png", optimize=True
    )
    make_small_proof(circles).save(
        OUTPUT_DIR / "LUVIA_验收_120px圆形头像.png", optimize=True
    )


if __name__ == "__main__":
    main()
