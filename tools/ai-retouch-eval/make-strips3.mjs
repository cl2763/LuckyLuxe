/* 三格对照条:原图 | 第一轮 B | 第二轮 B
 * 🔴 这条只用来判**光影/死白**(全图属性,三格挤得下);
 *    判 ①a 甲面细节仍用两格条 make-strips.mjs —— 三格每格太小,看不出图案换没换。
 */
import { readdirSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const [, , IN_DIR, R1, R2, OUT] = process.argv
const PY = '/opt/anaconda3/bin/python3'
mkdirSync(OUT, { recursive: true })
let n = 0
for (const f of readdirSync(IN_DIR).filter((x) => x.endsWith('.jpg')).sort()) {
  const a = join(IN_DIR, f), b = join(R1, `B_${f}`), c = join(R2, `B2_${f}`)
  const out = join(OUT, `T3_${f}`)
  if (!existsSync(c) || existsSync(out)) continue
  execFileSync(PY, ['-c', `
import sys
from PIL import Image, ImageDraw
H, gap, bar = 900, 10, 30
ims = []
for p in sys.argv[1:4]:
    im = Image.open(p).convert('RGB')
    ims.append(im.resize((int(im.width*H/im.height), H), Image.LANCZOS))
W = sum(i.width for i in ims) + gap*2
c = Image.new('RGB', (W, H+bar), (250,248,243)); d = ImageDraw.Draw(c)
x = 0
for im, t in zip(ims, ['原图', '第一轮 B 旧口令', '第二轮 B 新口令']):
    c.paste(im, (x, bar)); d.text((x+6, 8), t, fill=(40,36,32)); x += im.width + gap
c.save(sys.argv[4], 'JPEG', quality=86)`, a, existsSync(b) ? b : a, c, out])
  n++
}
console.log(`  新出三格条 ${n} 条`)
