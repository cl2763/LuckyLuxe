const path = require("path");
const { chromium } = require("playwright");

const root = __dirname;
const html = path.join(root, "LUVIA_护理卡背面_三主题.html");
const outputs = [
  ["#back-01", "LUVIA_油画系列01_芭蕾午后_护理卡背面.png"],
  ["#back-02", "LUVIA_油画系列02_书页与缎带_护理卡背面.png"],
  ["#back-03", "LUVIA_油画系列03_青瓷花影_护理卡背面.png"],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 });
  await page.goto(`file://${html}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  for (const [selector, filename] of outputs) {
    const node = page.locator(selector);
    await node.screenshot({ path: path.join(root, filename) });
  }
  await browser.close();
})();
