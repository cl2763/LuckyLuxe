/* 12k §二-2 —— 把店主导出的反馈并进偏好数据集(只追加,不改写)
 * 用法:node ingest-feedback.mjs <_反馈目录> [分档表.json]
 * 产出:tools/ai-retouch-eval/偏好数据集.jsonl
 * 幂等:同一个 json 再喂一次不会重复追加 —— 判据是「这份文件摄入过没有」(按内容哈希),
 *      不是「数据集里还剩几条」(幂等判据律:剩余量会被正常业务改动)。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const JSONL = join(HERE, '偏好数据集.jsonl')
const SEEN = join(HERE, '.偏好数据集.已摄入.json')
const [, , DIR, TONE] = process.argv
if (!DIR) { console.error('用法:node ingest-feedback.mjs <_反馈目录> [分档表.json]'); process.exit(2) }

const 四数 = new Map()
if (TONE && existsSync(TONE)) {
  for (const r of JSON.parse(readFileSync(TONE, 'utf8'))) 四数.set(r.f.slice(0, 2), r)
}
const seen = existsSync(SEEN) ? JSON.parse(readFileSync(SEEN, 'utf8')) : {}
const before = existsSync(JSONL) ? readFileSync(JSONL, 'utf8').split('\n').filter(Boolean).length : 0

let 新增 = 0, 跳过 = 0
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const raw = readFileSync(join(DIR, f), 'utf8')
  const h = createHash('sha256').update(raw).digest('hex').slice(0, 16)
  if (seen[h]) { 跳过++; console.log(`  摄入过,跳过:${f}`); continue }
  const p = JSON.parse(raw)
  if (!Array.isArray(p.条目)) throw new Error(`🔴 ${f} 里没有「条目」数组 —— 不是导出的反馈文件`)
  for (const x of p.条目) {
    const t = 四数.get(String(x.序号).padStart(2, '0')) || {}
    appendFileSync(JSONL, JSON.stringify({
      日期: p.日期, 轮次: p.轮次, 序号: x.序号, 版本名: x.版本名, 处理链: x.列 || null,
      判定: x.判定, 备注: x.备注 || '', 行最喜欢: x.行最喜欢 || null,
      当时四数: { 全图均亮: t.全图均亮 ?? null, 手框均亮: t.手框均亮 ?? null,
                甲面均亮: t.甲面均亮 ?? null, 全图RB: t.全图RB ?? null,
                甲面色度C: t.甲面色度C ?? null, 甲色档: t.甲色档 ?? null },
      来源文件: f,
    }) + '\n')
    新增++
  }
  seen[h] = { 文件: f, 条目数: p.条目.length, 摄入于: new Date().toISOString() }
}
writeFileSync(SEEN, JSON.stringify(seen, null, 2))
const after = existsSync(JSONL) ? readFileSync(JSONL, 'utf8').split('\n').filter(Boolean).length : 0
console.log(`  摄入 ${新增} 条(跳过已摄入文件 ${跳过} 个)`)
console.log(`  偏好数据集行数:${before} → ${after}(增量 ${after - before})`)
if (after - before !== 新增) { console.error('🔴 行数增量对不上摄入条数'); process.exit(1) }
