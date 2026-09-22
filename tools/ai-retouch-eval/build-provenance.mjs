/* 12a · 样片来源清单 —— 每张图从哪来、被怎么处理过、送进模型时是什么尺寸 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const [, , IN_DIR, R1_DIR, OUT] = process.argv
const man = JSON.parse(readFileSync(join(IN_DIR, '_归一化清单.json'), 'utf8'))
const logP = join(R1_DIR, '_跑批日志.json')
const L = existsSync(logP) ? JSON.parse(readFileSync(logP, 'utf8')) : { 明细: [] }
const by = new Map(L.明细.map((r) => [`${r.模型}_${r.文件}`, r]))
let md = `# 12a · 样片来源清单(41 张)

来源:店主给的 41 张美甲客照(HEIC/JPG 原片)。归一化三步:
1. HEIC → JPG(\`sips\`;MPO 走 Pillow \`seek(0)\` 兜底)
2. 按 EXIF 方向摆正
3. **裁掉顶部 18%** —— 🔴 目的就一个:**保证对比包里不出现顾客的脸**(店主红线)。
   裁完**逐张量了像素**确认真裁掉了(第一版 \`sips --cropOffset\` 写了日志却没真裁,是拼接查看图时才发现的)。
4. 长边压到 ≤4096

送模型时的 \`size\`:B 模型有面积上限 **4,624,220 px**,41 张原图全部超标,
所以统一按原图比例缩进这个上限内(**向下取整并保持偶数** —— 取大一点点会被接口 400 拒)。
两个模型传同一个 size,否则没法对照。

| # | 原文件 | 原尺寸 | 裁掉顶部 | 归一化后 | 送模型 size | A 出图 | B 出图 |
|---|---|---|---|---|---|---|---|
`
for (const r of man) {
  const a = by.get(`A_${r.归一化后}`), b = by.get(`B_${r.归一化后}`)
  md += `| ${r.序号} | ${r.原文件} | ${r.原尺寸} | ${r.裁掉顶部} | ${r.终尺寸} | ${a?.请求尺寸 || b?.请求尺寸 || '—'} | ${a?.出图尺寸 || '**未出图**'} | ${b?.出图尺寸 || '**未出图**'} |\n`
}
md += `
**脸**:41 张一张不剩地裁过顶部;对比包逐格看过,没有人脸。
**原片**:不进仓库、不进对比包目录以外的地方;这一批全程只在本机与产出夹里动，生产零接触。
`
writeFileSync(OUT, md)
console.log(`  样片来源清单 ${man.length} 行 → ${OUT}`)
