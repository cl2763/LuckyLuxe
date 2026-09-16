from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont


ASSET_ROOT = Path("/Users/changliu/Desktop/Lucky Nail/LUVIA_半径品牌视觉资产包")
GENERATED_ROOT = Path(
    "/Users/changliu/.codex/generated_images/01a0a5fb-3356-7340-b9dd-e50543857ea3"
)
OUTPUT_DIR = ASSET_ROOT / "03_社交媒体_线上物料" / "头像_艺术馆藏三方向"
LOGO_ROOT = ASSET_ROOT / "01_LOGO_标志系统"
FONT_REGULAR = ASSET_ROOT / "04_字体文件" / "Jost-Regular.ttf"
FONT_LIGHT = ASSET_ROOT / "04_字体文件" / "Jost-Light.ttf"


CONFIGS = [
    {
        "platform": "小红书",
        "direction": "01_光雾油画",
        "background": GENERATED_ROOT / "exec-06cbd974-4568-4fc1-bf2c-49c27386be71.png",
        "logo": LOGO_ROOT / "04_单色_黑" / "B1_主LOGO-完整版-加粗-绣花立体字用.png",
        "ink": (29, 29, 29),
        "label": "01 / LUMINOUS OIL STUDY",
        "note": "LIGHT · MIST · IMPASTO",
        "contrast": 0.98,
        "logo_y": 0.50,
    },
    {
        "platform": "微信",
        "direction": "02_金地矿物",
        "background": GENERATED_ROOT / "exec-74c9cb12-0992-453c-b88d-b9a88347d339.png",
        "logo": LOGO_ROOT / "04_单色_黑" / "B1_主LOGO-完整版-加粗-绣花立体字用.png",
        "ink": (22, 25, 27),
        "label": "02 / MINERAL GOLD STUDY",
        "note": "PIGMENT · GOLD LEAF · SILENCE",
        "contrast": 1.02,
        "logo_y": 0.405,
    },
    {
        "platform": "抖音",
        "direction": "03_黑金夜曲",
        "background": GENERATED_ROOT / "exec-2f82a3bd-1070-4c1e-a374-5792a159968f.png",
        "logo": LOGO_ROOT / "03_单色_金" / "B1_主LOGO-完整版-加粗-绣花立体字用.png",
        "ink": (211, 183, 142),
        "label": "03 / NOCTURNE STUDY",
        "note": "SHADOW · GLAZE · AFTERGLOW",
        "contrast": 1.06,
        "logo_y": 0.49,
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


def crop_alpha(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    bbox = image.getbbox()
    if bbox is None:
        raise ValueError(f"Empty logo: {path}")
    return image.crop(bbox)


def resize_width(image: Image.Image, width: int) -> Image.Image:
    return image.resize(
        (width, round(image.height * width / image.width)), Image.Resampling.LANCZOS
    )


def recolor_alpha(image: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    layer = Image.new("RGBA", image.size, rgb + (255,))
    layer.putalpha(image.getchannel("A"))
    return layer


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def draw_editorial_marks(
    canvas: Image.Image, config: dict, size: int, circular: bool
) -> None:
    draw = ImageDraw.Draw(canvas)
    ink = config["ink"] + ((198 if circular else 215),)
    micro = ImageFont.truetype(str(FONT_REGULAR), round(size * 0.012))
    tiny = ImageFont.truetype(str(FONT_LIGHT), round(size * 0.0105))

    safe = round(size * (0.19 if circular else 0.075))
    right = size - safe
    top = round(size * (0.155 if circular else 0.07))
    bottom = round(size * (0.825 if circular else 0.925))

    draw.text((safe, top), config["label"], font=micro, fill=ink)
    brand = "LUVIA / 半径"
    draw.text((right - text_width(draw, brand, micro), top), brand, font=micro, fill=ink)

    line_y = top + round(size * 0.030)
    draw.line((safe, line_y, right, line_y), fill=ink, width=max(1, size // 1080))

    draw.text((safe, bottom), config["note"], font=tiny, fill=ink)
    folio = f'{config["platform"]}  /  BEAUTY ATELIER'
    draw.text((right - text_width(draw, folio, tiny), bottom), folio, font=tiny, fill=ink)


def compose(config: dict, size: int, circular: bool) -> Image.Image:
    background = square_crop(Image.open(config["background"]), size)
    background = ImageEnhance.Contrast(background).enhance(config["contrast"]).convert("RGBA")

    logo = recolor_alpha(crop_alpha(config["logo"]), config["ink"])
    width_ratio = 0.63 if circular else 0.69
    logo = resize_width(logo, round(size * width_ratio))
    center_y = round(size * config["logo_y"])
    background.alpha_composite(
        logo,
        ((size - logo.width) // 2, center_y - logo.height // 2),
    )

    draw_editorial_marks(background, config, size, circular)
    return background


def circular_version(image: Image.Image) -> Image.Image:
    size = image.width
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    image.putalpha(mask)
    return image


def make_preview(squares: list[Image.Image], circles: list[Image.Image]) -> Image.Image:
    tile = 480
    gap = 28
    sheet = Image.new("RGB", (tile * 3 + gap * 4, tile * 2 + gap * 3), "#E5E0D7")
    for row, images in enumerate((squares, circles)):
        for index, image in enumerate(images):
            thumb = image.resize((tile, tile), Image.Resampling.LANCZOS)
            x = gap + index * (tile + gap)
            y = gap + row * (tile + gap)
            sheet.paste(thumb, (x, y), thumb if thumb.mode == "RGBA" else None)
    return sheet


def make_small_proof(circles: list[Image.Image]) -> Image.Image:
    diameter = 120
    gap = 22
    proof = Image.new("RGB", (diameter * 3 + gap * 4, diameter + gap * 2), "#E5E0D7")
    for index, image in enumerate(circles):
        small = image.resize((diameter, diameter), Image.Resampling.LANCZOS)
        proof.paste(small, (gap + index * (diameter + gap), gap), small)
    return proof


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    squares: list[Image.Image] = []
    circles: list[Image.Image] = []

    for config in CONFIGS:
        square = compose(config, 1080, circular=False)
        circle = circular_version(compose(config, 1080, circular=True))
        stem = f'LUVIA_{config["platform"]}_头像_{config["direction"]}_加粗完整Logo'

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
        OUTPUT_DIR / "LUVIA_三种艺术方向_方形圆形总览.png", optimize=True
    )
    make_small_proof(circles).save(
        OUTPUT_DIR / "LUVIA_三种艺术方向_120px头像验收.png", optimize=True
    )


if __name__ == "__main__":
    main()
