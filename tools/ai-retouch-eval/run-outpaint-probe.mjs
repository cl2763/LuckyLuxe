/* 扩图探针(12d补 §三-4)—— **只探 1 次 ¥0.32**
 * 问题:横 16:9 从竖图裁会把手切掉,要扩图(outpaint)才成立。
 * 做法:把竖图放进 16:9 画布正中(两侧留白),请模型把两侧补全。
 *   若 B 支持,补出来的两侧应与原背景连续且手不变;
 *   若不支持(重画整张 / 改手 / 留白还在),就在 12b 里把 16:9 写「暂不提供」并注明原因。
 * 🔴 判据是**看图 + 量手框**:手框 mean abs diff 大 = 手被动过 = 扩图不可用。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { BG_PREFIX, SUFFIX } from './round4-prompts.mjs'

const [, , ENV_FILE, SRC, OUT_DIR] = process.argv
const KEY = (/ARK_API_KEY\s*=\s*(.+)/.exec(readFileSync(ENV_FILE, 'utf8'))?.[1] || '').trim()
if (!KEY) { console.error('🔴 钥匙读不到'); process.exit(2) }
const PY = '/opt/anaconda3/bin/python3', AREA_CAP = 4624220
mkdirSync(OUT_DIR, { recursive: true })

/* 先做画布:原竖图居中,两侧补中性灰(不补白 —— 白会被当成过曝目标) */
const canvas = join(OUT_DIR, '_画布_16x9.jpg')
const size = execFileSync(PY, ['-c', `
import sys
import numpy as np
from PIL import Image
src, dst, cap = sys.argv[1], sys.argv[2], ${AREA_CAP}
im = Image.open(src).convert('RGB')
H = im.height; W = int(round(H*16/9))
# 缩到面积上限内并保持偶数
import math
r = min(1.0, math.sqrt(cap/(W*H)))
W2 = int(W*r)//2*2; H2 = int(H*r)//2*2
while W2*H2 > cap: H2 -= 2
im2 = im.resize((int(im.width*H2/im.height)//2*2, H2), Image.LANCZOS)
c = Image.new('RGB', (W2, H2), (128,128,128))
c.paste(im2, ((W2-im2.width)//2, 0))
c.save(dst, 'JPEG', quality=95)
print(f'{W2}x{H2}')
`, SRC, canvas], { encoding: 'utf8' }).trim()
console.log(`  画布 ${size}(原竖图居中,两侧中性灰待补)`)

const PROMPT = BG_PREFIX +
  `这张图两侧是灰色的空白区域,请把空白区域补全成与中间部分连续、自然的同一个场景背景。` +
  `中间已有的部分——手、指甲、指甲上的每一处图案与装饰、原有背景——一个像素都不要改动,只填补两侧空白。` + SUFFIX

const t0 = Date.now()
const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
  body: JSON.stringify({
    model: 'doubao-seedream-5-0-pro-260628', prompt: PROMPT,
    image: `data:image/jpeg;base64,${readFileSync(canvas).toString('base64')}`,
    size, watermark: false, response_format: 'url',
  }),
  signal: AbortSignal.timeout(300000),
}).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }))
const d = await r.json()
const rec = { 源: SRC.split('/').pop(), 画布: size, 耗时ms: Date.now() - t0, 口令: PROMPT }
if (!r.ok || !d.data?.[0]?.url) {
  rec.状态 = `🔴 ${r.status ? 'HTTP ' + r.status : '网络'}`; rec.错误 = String(d.error?.message || '').slice(0, 220)
  console.log(`  ${rec.状态} ${rec.错误}`)
} else {
  writeFileSync(join(OUT_DIR, 'OUT_16x9.jpg'), Buffer.from(await (await fetch(d.data[0].url)).arrayBuffer()))
  rec.状态 = '✅'; rec.出图尺寸 = d.data[0].size; rec.花费元 = 0.32
  console.log(`  ✅ 出图 ${rec.出图尺寸} · ${Math.round(rec.耗时ms / 1000)}s · ¥0.32`)
}
writeFileSync(join(OUT_DIR, '_探针日志.json'), JSON.stringify(rec, null, 2))
