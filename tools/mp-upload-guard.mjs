/* 🔴 上传前置闸(夜16-续 §二.1 裁):**跑 `cli upload` 之前,连的必须是生产。**
 *
 * ══ 案底 ══
 * `miniprogram/utils/api.js:6` 写着:
 *   `const USE_LOCAL_SANDBOX = true // …本地开发沙盘;上传前务必改 false`
 * **那句「务必改 false」在代码里没有任何东西拦它。**
 * 夜16 我真的跑了一次 `cli upload`,传上去的开发版连的是**本机沙箱** ——
 * 当时只在回执里写了一句提醒。
 *
 * 🔴 **J-92:在文档/回执里认出来的问题,如果代码里没有对应处置,那句提醒就是在给这个问题背书。**
 * ⇒ 把那句注释变成一道机器闸。
 *
 * 用法:
 *   node tools/mp-upload-guard.mjs            # 只检查,不上传(退出码 0/1)
 *   bash tools/mp-upload.sh <version> <desc>  # 先过闸,再 cli upload
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const API_REL = 'miniprogram/utils/api.js'

/** 唯一出口:判据与那个 shell 包装用的是同一个函数,不许各写一套 */
export function checkUploadReady(src) {
  const line = String(src).split('\n').find((l) => /^\s*const\s+USE_LOCAL_SANDBOX\s*=/.test(l)) || ''
  const m = line.match(/=\s*(true|false)\b/)
  if (!m) return { ok: false, value: null, reason: '找不到 `const USE_LOCAL_SANDBOX = true|false` 这一行 —— 判据读不到它就不许放行(读不到 ≠ 没问题)' }
  if (m[1] !== 'false') {
    return { ok: false, value: m[1],
      reason: `🔴 \`USE_LOCAL_SANDBOX = ${m[1]}\`(${API_REL})—— 这一版连的是**本机沙箱**,不是生产。\n`
        + '   传上去的包在顾客手机上打不开任何接口。上传/提审前改成 `false`。' }
  }
  return { ok: true, value: 'false', reason: '' }
}

/* 命令行模式 */
if (process.argv[1] && process.argv[1].endsWith('mp-upload-guard.mjs')) {
  const r = checkUploadReady(readFileSync(join(ROOT, API_REL), 'utf8'))
  if (!r.ok) { console.error(`\n${r.reason}\n`); process.exit(1) }
  console.log(`✅ 上传前置闸通过:USE_LOCAL_SANDBOX = false(${API_REL})`)
}
