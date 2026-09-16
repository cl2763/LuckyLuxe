from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ASSET_ROOT = Path("/Users/changliu/Desktop/Lucky Nail/LUVIA_半径品牌视觉资产包")
GENERATED_ROOT = Path(
    "/Users/changliu/.codex/generated_images/01a0a5fb-3356-7340-b9dd-e50543857ea3"
)
OUTPUT_DIR = ASSET_ROOT / "03_社交媒体_线上物料" / "头像_写实摄影版"


CONFIGS = [
    {
        "name": "LUVIA_小红书_店铺头像_写实棉纸洞石",
        "background": GENERATED_ROOT / "exec-28c3c892-82ae-4f48-90c4-0f559023e655.png",
        "logo": ASSET_ROOT
        / "01_LOGO_标志系统"
        / "01_标准色_双色"
        / "A2_主LOGO-无标语版.png",
        "width_ratio": 0.66,
        "y_offset": 8,
        "finish": "ink",
    },
    {
        "name": "LUVIA_微信_店铺头像_写实棕纸胡桃木",
        "background": GENERATED_ROOT / "exec-7ea57fd1-3ae3-4df4-b29c-4a93fe878205.png",
        "logo": ASSET_ROOT
        / "01_LOGO_标志系统"
        / "03_单色_金"
        / "A2_主LOGO-无标语版.png",
        "width_ratio": 0.66,
        "y_offset": 0,
        "finish": "foil",
    },
    {
        "name": "LUVIA_抖音_店铺头像_写实黑卡石材",
        "background": GENERATED_ROOT / "exec-7dc8d147-be95-449f-aa61-5af2fee566f0.png",
        "logo": ASSET_ROOT
        / "01_LOGO_标志系统"
        / "03_单色_金"
        / "A2_主LOGO-无标语版.png",
        "width_ratio": 0.66,
        "y_offset": 0,
        "finish": "foil",
    },
]


def prepare_logo(path: Path, width: int) -> Image.Image:
    logo = Image.open(path).convert("RGBA")
    bbox = logo.getbbox()
    if bbox is None:
        raise ValueError(f"Logo has no visible pixels: {path}")
    logo = logo.crop(bbox)
    height = round(logo.height * width / logo.width)
    return logo.resize((width, height), Image.Resampling.LANCZOS)


def printed_logo(logo: Image.Image, background_crop: Image.Image, finish: str) -> Image.Image:
    """Keep the source alpha silhouette exact while making the fill react like print."""
    alpha = logo.getchannel("A")
    if finish == "ink":
        # Slight translucency lets the real paper tooth remain visible through the ink.
        layer = logo.copy()
        layer.putalpha(alpha.point(lambda value: round(value * 0.90)))
        return layer

    # Restrained champagne foil: a real directional reflection, not a glow effect.
    width, height = logo.size
    foil = Image.new("RGBA", logo.size)
    pixels = foil.load()
    for y in range(height):
        for x in range(width):
            light = 0.82 + 0.16 * (1 - abs((x / max(1, width - 1)) * 2 - 1))
            texture = background_crop.getpixel((x, y))[0] / 255
            modulation = light * (0.94 + texture * 0.06)
            pixels[x, y] = (
                round(220 * modulation),
                round(201 * modulation),
                round(176 * modulation),
                alpha.getpixel((x, y)),
            )
    return foil


def compose(config: dict, size: int = 1080) -> Image.Image:
    background = Image.open(config["background"]).convert("RGB")
    side = min(background.size)
    left = (background.width - side) // 2
    top = (background.height - side) // 2
    background = background.crop((left, top, left + side, top + side))
    background = background.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")

    logo = prepare_logo(config["logo"], round(size * config["width_ratio"]))
    x = (size - logo.width) // 2
    y = (size - logo.height) // 2 + config["y_offset"]

    crop = background.crop((x, y, x + logo.width, y + logo.height)).convert("RGB")
    background.alpha_composite(printed_logo(logo, crop, config["finish"]), (x, y))
    return background.convert("RGB")


def make_contact_sheet(images: list[tuple[str, Image.Image]]) -> Image.Image:
    tile = 520
    gutter = 28
    sheet = Image.new("RGB", (tile * 3 + gutter * 4, tile + gutter * 2), "#EEE9E1")
    for index, (_, img) in enumerate(images):
        thumb = img.resize((tile, tile), Image.Resampling.LANCZOS)
        x = gutter + index * (tile + gutter)
        sheet.paste(thumb, (x, gutter))
    return sheet


def make_circle_crop_proof(images: list[tuple[str, Image.Image]]) -> Image.Image:
    diameter = 96
    gap = 18
    proof = Image.new("RGB", (diameter * 3 + gap * 4, diameter + gap * 2), "#EEE9E1")
    mask = Image.new("L", (diameter, diameter), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, diameter - 1, diameter - 1), fill=255)
    for index, (_, img) in enumerate(images):
        small = img.resize((diameter, diameter), Image.Resampling.LANCZOS)
        x = gap + index * (diameter + gap)
        proof.paste(small, (x, gap), mask)
    return proof


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    rendered = []
    for config in CONFIGS:
        avatar = compose(config)
        avatar.save(OUTPUT_DIR / f'{config["name"]}_1080.png', optimize=True)
        avatar.resize((400, 400), Image.Resampling.LANCZOS).save(
            OUTPUT_DIR / f'{config["name"]}_400.png', optimize=True
        )
        rendered.append((config["name"], avatar))
    make_contact_sheet(rendered).save(OUTPUT_DIR / "LUVIA_三平台写实头像_预览.png", optimize=True)
    make_circle_crop_proof(rendered).save(OUTPUT_DIR / "LUVIA_验收_96px圆形裁切.png", optimize=True)


if __name__ == "__main__":
    main()
