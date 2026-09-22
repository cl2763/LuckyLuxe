/* 12a 第一轮 · 判图用对照条(给 Code 初判用,不进对比包)
 *
 * 🔴 判据律在这里的具体含义:**判据必须能证伪「①a 改了甲面」**。
 *    三格挤进 1568px → 每格 520px → 甲面只剩几十像素,图案换没换根本看不出来,
 *    那条判据在缺陷存在时会照样绿 —— 废判据。
 *    所以一张样片出两条:(原图|A) 与 (原图|B),各占满宽,每格 ~780px。
 */
import { readdirSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const [, , IN_DIR, R1_DIR, OUT_DIR] = process.argv
const PY = '/opt/anaconda3/bin/python3'
mkdirSync(OUT_DIR, { recursive: true })

const files = readdirSync(IN_DIR).filter((f) => f.endsWith('.jpg')).sort()
let n = 0
for (const f of files) {
  for (const code of ['A', 'B']) {
    const out = join(OUT_DIR, `${code}_${f.replace('.jpg', '')}_对照.jpg`)
    const gen = join(R1_DIR, `${code}_${f}`)
    if (!existsSync(gen) || existsSync(out)) continue
    execFileSync(PY, ['-c', `
import sys
from PIL import Image, ImageDraw
a = Image.open(sys.argv[1]).convert('RGB')   # 原图
b = Image.open(sys.argv[2]).convert('RGB')   # 出图
H = 1000
def fit(im):
    w = int(im.width * H / im.height)
    return im.resize((w, H), Image.LANCZOS)
a, b = fit(a), fit(b)
gap, bar = 12, 34
c = Image.new('RGB', (a.width + gap + b.width, H + bar), (250, 248, 243))
c.paste(a, (0, bar)); c.paste(b, (a.width + gap, bar))
d = ImageDraw.Draw(c)
d.text((6, 9), '原图', fill=(40, 36, 32))
d.text((a.width + gap + 6, 9), '出图 ${code}', fill=(40, 36, 32))
c.save(sys.argv[3], 'JPEG', quality=88)
`, join(IN_DIR, f), gen, out])
    n++
  }
}
console.log(`  新出对照条 ${n} 条 → ${OUT_DIR}`)
