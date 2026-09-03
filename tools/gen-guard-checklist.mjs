#!/usr/bin/env node
/* 写库脚本护栏 · 三列清单**生成器**(店主 03z §一 裁 · 04a §一 病二 收窄,2026-09-03)

   ══ 为什么改成生成 ══
   店主 03z:**「清单是人写的,刀是机器咬的,以刀为准。」**
   手写那份停在 09-02,而这一批的正面案例就摆在那儿 ——
   清单写着「包了事务」的九处里,`ledger-guards` 现测根本没有事务。

   ══ 04a 又收窄了两处(店主亲核咬出来的)══
   ① **同一个提交上清单就过期了** —— 因为生成它的尺子和守它的刀各写了一份。
      改法:尺子搬进 `tools/guard-scan.mjs` **只此一份**,
      并由 `test-db-target-guard` 常驻守「清单 ≡ 当前提交现扫输出」。
   ② **刀咬到自己** —— 生成器源码里的 `DatabaseSync` / `BEGIN IMMEDIATE` 是尺子的字面量,
      被当成「含事务的写库点」列进了清单。排除面因此写成**带理由的表 + 棘轮**(见 guard-scan.mjs 的 KNIVES),
      不是一句悄悄的排除,更不许用「把字面量拆开拼」这种躲刀的写法。

   ══ 用法 ══
     node tools/gen-guard-checklist.mjs            # 打印到 stdout(默认只读,不写文件)
     node tools/gen-guard-checklist.mjs --write    # 重写 handoff/写库脚本护栏三列清单.md
   **默认不写文件**(与造景脚本同一姿态:要落盘就显式说)。 */

import { writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { scanWriteSites, renderChecklist } from './guard-scan.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'handoff', '写库脚本护栏三列清单.md')
const WRITE = process.argv.includes('--write')

const scan = scanWriteSites(ROOT)
const stamp = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const md = renderChecklist(scan, stamp)

if (WRITE) {
  writeFileSync(OUT, md)
  console.log(`已重写 ${OUT}`)
  console.log(`  候选 ${scan.CAND.length} · 会写库 ${scan.rows.length}(A ${scan.A.length} / B ${scan.B.length})`
    + `· A 类未接护栏 ${scan.noGuardA.length} · 含事务 ${scan.withTxn.length}`)
} else {
  console.log(md)
  console.error(`\n(默认只打印不落盘;要重写文件加 --write。目标:${existsSync(OUT) ? '已存在,会覆盖' : '新建'})`)
}
