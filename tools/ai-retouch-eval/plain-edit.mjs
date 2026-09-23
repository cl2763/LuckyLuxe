/* 非生成式对照(12c §三)—— 只做曲线 / 白平衡 / 局部提亮,**不经模型**,零成本
 *
 * 🔴 存在的意义:给「值不值得用 AI」一个底。
 *    如果常规调色就能到店主要的样子,那 AI 这条路的性价比要重新算。
 * 做法按桶分(和送模型的口令同一套分桶逻辑,才有可比性):
 *   桶 A 暗调:**不整体提亮**,只抬最暗处(阴影提升,高光不动),轻微提对比
 *   桶 B 正常:不动曝光,只压高光 + 轻微提对比
 *   白平衡一律**以原图为准**,不做色温校正 —— 和口令一致
 * 全程不改甲面、不改构图 —— 常规调色本来就做不到那些,这正是它的优点。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { bucketOf } from './bucket-prompts.mjs'
const [, , IN_DIR, OUT_DIR, BUCKETS_JSON, LIST] = process.argv
const PY = '/opt/anaconda3/bin/python3'
mkdirSync(OUT_DIR, { recursive: true })
const metrics = new Map(JSON.parse(readFileSync(BUCKETS_JSON, 'utf8')).map((t) => [t.f, t]))
const files = LIST.split(',')
for (const f of files) {
  const b = bucketOf(metrics.get(f))
  execFileSync(PY, ['-c', `
import sys
import numpy as np
from PIL import Image
src, dst, bucket = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.float64) / 255.0
l = 0.299*a[:,:,0] + 0.587*a[:,:,1] + 0.114*a[:,:,2]

if bucket == 'A':
    # 暗调:只抬最暗处,高光按住不动 —— 权重随亮度衰减,亮到 0.5 以上基本不动
    w = np.clip(1.0 - l/0.5, 0, 1)[:,:,None]      # 暗处权重高
    lifted = a ** 0.72                             # gamma 提亮
    a = a*(1-w) + lifted*w
    # 轻微 S 曲线提对比,但把高光端压住
    a = np.clip(a + 0.10*(a-0.5)*(1-np.clip(l,0,1)[:,:,None]), 0, 1)
else:
    # 正常曝光:不动中间调,只压高光 + 很轻的对比
    hw = np.clip((l-0.75)/0.25, 0, 1)[:,:,None]    # 只对很亮的地方生效
    a = a*(1-hw) + (a**1.18)*hw                    # 压高光
    a = np.clip(0.5 + (a-0.5)*1.05, 0, 1)

# 白平衡:不动。以原图为准(和口令一致),这里刻意什么都不做。
out = Image.fromarray((np.clip(a,0,1)*255).round().astype(np.uint8))
out.save(dst, 'JPEG', quality=94)
`, join(IN_DIR, f), join(OUT_DIR, `P_${f}`), b])
  console.log(`  ${f}  桶${b}  → P_${f}`)
}
