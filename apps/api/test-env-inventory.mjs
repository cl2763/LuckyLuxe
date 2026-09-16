/* 环境变量清单常驻判据(店主 09f)—— **给推 main 前那份核对表当护栏**
 * 它守两件:①这把刀的扫描面不许缩水 ②「必须未设」那一格只许变短。
 * 判据本身的两面 probe 在 `tools/env-inventory.mjs --probe`(六种写法 + 五种形似而非)。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fullInventory, prodFiles, otherFiles, MUST_BE_UNSET } from '../../tools/env-inventory.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
let n = 0
const fails = []
const check = (name, cond, detail = '') => {
  n += 1
  if (cond) console.log(`ok ${n} - ${name}`)
  else { console.log(`not ok ${n} - ${name} :: ${detail}`); fails.push(name) }
}

/* 🔴 与报表同一把尺子(J-39):两边都走 `fullInventory` —— 第一版报表并了「只经动态取键读到的」,
   判据没并,于是同一件事一个报 2 一个报 0。 */
const { P, fatal, boxes } = await fullInventory(ROOT)
const sum = Object.values(boxes).reduce((a, b) => a + b, 0)

check(`① 🔴 扫描面:从 local-server.mjs 顺 import 可达 ${prodFiles(ROOT).length} 个模块 >= 110(缩水立刻红 —— J-65③:一个数不带扫描面等于没有依据)`,
  prodFiles(ROOT).length >= 110, String(prodFiles(ROOT).length))
check(`①b 其余面(tools/apps/web/根脚本)${otherFiles(ROOT).length} 个 >= 150 —— 它们**不在生产上跑**,单独一栏`,
  otherFiles(ROOT).length >= 150, String(otherFiles(ROOT).length))
check(`② 底数闭合(J-48):四格合计 ${sum} ≡ 生产面变量名 ${P.all.size}`, sum === P.all.size, `${sum} vs ${P.all.size}`)
check(`③ 🔴 启动必需 ${boxes['启动必需'] || 0} 条 >= 2(它们走 secret-gate 那道闸;少了说明闸被拆了)`,
  (boxes['启动必需'] || 0) >= 2, JSON.stringify(boxes))
check(`④ 🔴 「必须未设」名单 ${MUST_BE_UNSET.length} 条 <= 2,**每条都写了「设了会怎样」**(只许变短;进新成员要店主点头)`,
  MUST_BE_UNSET.length <= 2 && MUST_BE_UNSET.every((x) => String(x.设了会怎样 || '').length > 30), JSON.stringify(MUST_BE_UNSET.map((x) => x.name)))
check(`⑤ 说不清(动态取键)${P.dynamic.length} 处 <= 3,逐处点名到行(按 J-66③ 当最坏那格,不许扫进别的格)`,
  P.dynamic.length <= 3, JSON.stringify(P.dynamic.map((d) => `${d.文件}:${d.行}`)))
/* ⑥ 自守:塞一行新的读法进去,必须被数到(零命中不算通过 —— J-58①) */
const { scanFile } = await import('../../tools/env-inventory.mjs')
check('⑥ 自守:构造一行新读法必须被数到(数不到说明这把刀是废的)',
  scanFile("const x = process.env.A_BRAND_NEW_VAR_FOR_PROBE", 'x.mjs').names.has('A_BRAND_NEW_VAR_FOR_PROBE'))
/* ⑦ 🔴 09h 现查登记:`owner-token.mjs` 那道闸**写好了但主进程没接** ——
   判据把这件事钉住:名单只许变短(接上了就该从这张表里消失)。 */
check(`⑦ 🔴 「闸写好了但没接上」现为 ${(fatal.unwired || []).length} 处 <= 1(只许变短;`
  + `现册:${(fatal.unwired || []).map((u) => u.模块.split('/').pop()).join(',') || '无'})`,
  (fatal.unwired || []).length <= 1, JSON.stringify(fatal.unwired || []))
check('⑥b 反向守:字符串里提到的不算(J-61 数执行不数提及)',
  !scanFile("const y = 'process.env.MENTIONED_ONLY'", 'x.mjs').names.has('MENTIONED_ONLY'))

console.log(`\n1..${n}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${n} 条)· 四格:${Object.entries(boxes).map(([k, v]) => `${k} ${v}`).join(' · ')} · 说不清 ${P.dynamic.length}`)
