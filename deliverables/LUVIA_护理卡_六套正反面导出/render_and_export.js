const path = require("path");
const { chromium } = require("playwright");
const sharp = require("sharp");

const outputDir = __dirname;
const html = path.join(outputDir, "LUVIA_护理卡背面_导出版.html");
const themes = [
  { id: "01", key: "back-01", name: "芭蕾午后", front: "front_theme01_clean.png" },
  { id: "02", key: "back-02", name: "书页与缎带", front: "front_theme02_clean.png" },
  { id: "03", key: "back-03", name: "青瓷花影", front: "front_theme03_clean.png" },
];

async function renderBackBoards() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1536, height: 1024 },
    deviceScaleFactor: 1,
  });
  await page.goto(`file://${html}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  for (const theme of themes) {
    await page.locator(`#${theme.key}`).screenshot({
      path: path.join(outputDir, `back_theme${theme.id}.png`),
    });
  }
  await browser.close();
}

async function extractFrontHalf(frontPath, side) {
  return sharp(frontPath)
    .extract({ left: side === "nail" ? 0 : 768, top: 0, width: 768, height: 1024 })
    .png()
    .toBuffer();
}

async function extractBackCard(backPath, side) {
  // The rendered board has an 18 px frame and an 18 px center gutter.
  const left = side === "nail" ? 18 : 777;
  return sharp(backPath)
    .extract({ left, top: 18, width: 741, height: 988 })
    .resize(768, 1024, { fit: "fill" })
    .png()
    .toBuffer();
}

async function exportPairs() {
  for (const theme of themes) {
    const frontPath = path.join(outputDir, theme.front);
    const backPath = path.join(outputDir, `back_theme${theme.id}.png`);
    for (const [typeNo, side, typeName] of [
      ["1", "nail", "美甲"],
      ["2", "lash", "美睫"],
    ]) {
      const front = await extractFrontHalf(frontPath, side);
      const back = await extractBackCard(backPath, side);
      const sequence = (Number(theme.id) - 1) * 2 + Number(typeNo);
      const filename = `${String(sequence).padStart(2, "0")}_${theme.name}_${typeName}_正反面.png`;
      await sharp({
        create: { width: 1536, height: 1024, channels: 4, background: "#f1ede7" },
      })
        .composite([
          { input: front, left: 0, top: 0 },
          { input: back, left: 768, top: 0 },
        ])
        .png({ compressionLevel: 9 })
        .toFile(path.join(outputDir, filename));
    }
  }
}

(async () => {
  await renderBackBoards();
  await exportPairs();
  console.log("Rendered 3 back boards and exported 6 front/back pairs.");
})();
