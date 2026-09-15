from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ASSET_ROOT = Path("/Users/changliu/Desktop/Lucky Nail/LUVIA_半径品牌视觉资产包")
GENERATED_ROOT = Path(
    "/Users/changliu/.codex/generated_images/01a0a5fb-3356-7340-b9dd-e50543857ea3"
)
OUTPUT_DIR = ASSET_ROOT / "03_社交媒体_线上物料" / "头像_艺术版"


CONFIGS = [
    {
        "name": "LUVIA_小红书_店铺头像_珍珠砂岩",
        "background": GENERATED_ROOT / "exec-3fb1c262-f675-4502-8486-536c6cc73983.png",
        "logo": ASSET_ROOT
        / "01_LOGO_标志系统"
        / "01_标准色_双色"
        / "A2_主LOGO-无标语版.png",
        "width_ratio": 0.72,
        "y_offset": -8,
        "glow": None,
    },
    {
        "name": "LUVIA_微信_店铺头像_深棕金环",
        "background": GENERATED_ROOT / "exec-6da8e044-cf8f-4edc-b2a1-d5f201f8dc5f.png",
        "logo": ASSET_ROOT
        / "01_LOGO_标志系统"
        / "03_单色_金"
        / "A2_主LOGO-无标语版.png",
        "width_ratio": 0.70,
        "y_offset": 0,
        "glow": (220, 201, 176, 72),
    },
    {
        "name": "LUVIA_抖音_店铺头像_黑金玻璃轨道",
        "background": GENERATED_ROOT / "exec-12e3d107-68ef-4ec3-a9c8-188a88379b5d.png",
        "logo": ASSET_ROOT
        / "01_LOGO_标志系统"
        / "03_单色_金"
        / "A2_主LOGO-无标语版.png",
        "width_ratio": 0.68,
        "y_offset": -4,
        "glow": (220, 201, 176, 88),
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

    if config["glow"]:
        alpha = logo.getchannel("A")
        glow = Image.new("RGBA", logo.size, config["glow"])
        glow.putalpha(alpha.filter(ImageFilter.GaussianBlur(max(3, size // 90))))
        background.alpha_composite(glow, (x, y))

    background.alpha_composite(logo, (x, y))
    return background.convert("RGB")


def make_contact_sheet(images: list[tuple[str, Image.Image]]) -> Image.Image:
    tile = 520
    gutter = 28
    sheet = Image.new("RGB", (tile * 3 + gutter * 4, tile + gutter * 2), "#EEE9E1")
    for index, (_, img) in enumerate(images):
        thumb = img.resize((tile, tile), Image.Resampling.LANCZOS)
        x = gutter + index * (tile + gutter)
        sheet.paste(thumb, (x, gutter))
        # Hairline shows the actual circular-crop boundary without changing deliverables.
        draw = ImageDraw.Draw(sheet)
        draw.ellipse((x + 2, gutter + 2, x + tile - 3, gutter + tile - 3), outline="#DCC9B0", width=2)
    return sheet


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
    make_contact_sheet(rendered).save(OUTPUT_DIR / "LUVIA_三平台头像_预览.png", optimize=True)


if __name__ == "__main__":
    main()
