/* 12k §二-1 —— 反馈组件的唯一嵌入口
 * build-report*.mjs 出页时调 fbScript() 拼到 html 末尾;
 * 已经生成过的页面(第五轮)用 CLI 模式回炉嵌一次:
 *   node feedback-embed.mjs <某个对比包.html> [...]
 * 幂等:已经嵌过的再跑一遍不会嵌第二份(靠标记行判「嵌过没有」,不靠「还剩几处」——幂等判据律)。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
export const FB_MARK = '<!-- ll-feedback-widget v1 -->'

export function fbScript() {
  return `\n${FB_MARK}\n<script>\n${readFileSync(join(HERE, 'feedback-widget.js'), 'utf8')}\n</script>\n`
}

if (process.argv[1] && process.argv[1].endsWith('feedback-embed.mjs')) {
  const files = process.argv.slice(2)
  if (!files.length) { console.error('用法:node feedback-embed.mjs <对比包.html> [...]'); process.exit(2) }
  for (const f of files) {
    const s = readFileSync(f, 'utf8')
    if (s.includes(FB_MARK)) { console.log(`  已嵌过,跳过:${f}`); continue }
    writeFileSync(f, s + fbScript())
    console.log(`  已嵌入反馈组件:${f}`)
  }
}
