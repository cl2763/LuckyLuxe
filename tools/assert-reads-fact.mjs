#!/usr/bin/env node
/* J-62 第二款 · 判据也不许「验了回执就当验过了」(店主 07m §一,2026-09-14)
 *
 * 款文:凡是断言「某件事写成了 / 发出去了 / 扣了款 / 占了位」的判据,
 * **必须从事实那一头读回来** —— 查库、重新 GET、或者证明下一次调用能看到它。
 * **不许只读这一次调用的返回体。**
 *
 * 这把刀是**第一遍静态筛**(便宜那一遍),只出三个数和一份嫌疑名单,**不改任何东西**:
 *   · 断言「写成功」的总条数
 *   · **A 类**:条件里读的只有**这一次调用的返回体**(status / data.x / body.x)→ **嫌疑名单**
 *   · **B 类**:条件里读了**库 / 二次 GET / 下一次调用**  → 从事实那头读回来了
 *
 * ⚠️ 静态筛只能缩小范围,**不能替代造病**(第二遍)。
 * 一条 A 类也可能是对的(比如它验的本来就是「接口该回 400」);
 * 一条 B 类也可能是假的(读了库但读的是别的表)。**判别式只有一个:注掉落库,它红不红。**
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const API = join(ROOT, 'apps/api')
/* J-61②:刀默认排除**判据自身与夹具**,并具名 */
const SELF = ['tools/assert-reads-fact.mjs']

/* ── 什么算「写」:请求侧出现改动型动词 ── */
const MUTATES = /method:\s*['"](POST|PUT|PATCH|DELETE)['"]|adminPost\(|adminPut\(|adminDel\(|\bpost\(|\bput\(|\bdel\(/
/* ── 什么算「断言写成功」:名字里说了成了,或条件在看 2xx ── */
const CLAIMS_OK = /成功|已保存|已提交|已发送|已核销|已到账|已确认|已绑定|已更新|写进|落库|创建|生成|新增|入库|扣|发出|占了?位|保存|记一笔|签署|签字/
const OK_STATUS = /status\s*===\s*(200|201|204)|\.ok\b/
/* ── B 类的形态:从事实那头读回来 ──
   🔴 09-14 这里返工过一次,原因值得留着:
   第一版只看**断言自己那几行**有没有 `dbx.prepare` / GET —— 结果 479 条嫌疑,**假阳一片**。
   真实写法是:POST 一次 → GET 一次 → 后面挂十几条断言读那个 GET 的结果。
   断言自己那行当然看不见 GET,于是全被判成 A 类。
   **一份 479 条里大半是错的名单,和没有名单一样。**
   改成**追变量的来源**:把断言条件里的标识符抠出来,回头找它最近一次赋值,
   看右边是「改动型调用」(A)还是「GET / 查库」(B)。 */
/* 🔴 09-14 这里返工过**两次**,两次都记着(尺子不准,名单就是废的):
   ①第一版只看断言自己那几行 → 479 条嫌疑,大半是错的
     (真实写法是 POST → GET → 后面挂十几条断言读那个 GET)。
   ②第二版改成追变量来源,抽样一核**还是错**:
     · `const wifis = (await request('/admin/store-wifi', {}, …)).data.wifis` —— GET 不写 `method`,认不出;
     · `…((await request('/services', …)).data.services || []).some(…)` —— GET **内联在条件里**,根本不在声明上。
   现在的口径:**一次调用带改动型 `method` 才算「写」,不带就是「读」**;
   并且条件本身、条件里标识符的声明,两头都看。 */
const WRITE_VERB = /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/
/* 一段文本里有没有「读」:request/fetch 调用且那一段里不带改动型 method;或直接查库 */
function readsFact(text) {
  if (/\bdbx?\s*\.\s*prepare\s*\(|DatabaseSync|adminGet\(/.test(text)) return true
  for (const m of text.matchAll(/\b(?:request|fetch|apiGet|getJson)\s*\(/g)) {
    const seg = text.slice(m.index, m.index + 220)
    if (!WRITE_VERB.test(seg)) return true          // 不带改动型 method = 读
  }
  return false
}
function writesOnly(text) {
  return /\badminPost\(|\badminPut\(|\badminDel\(/.test(text) || WRITE_VERB.test(text)
}

const files = readdirSync(API).filter((b) => /^test-.*\.mjs$/.test(b))
const rows = []
for (const b of files) {
  const rel = `apps/api/${b}`
  if (SELF.includes(rel)) continue
  const src = readFileSync(join(API, b), 'utf8')
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (!/\bcheck\s*\(/.test(lines[i])) continue
    /* 断言这一条的全文:从 check( 起到括号配平(最多 8 行) */
    let depth = 0, end = i, text = ''
    for (let j = i; j < Math.min(lines.length, i + 8); j += 1) {
      text += `${lines[j]}\n`
      for (const ch of lines[j]) { if (ch === '(') depth += 1; else if (ch === ')') depth -= 1 }
      if (depth <= 0 && j > i) { end = j; break }
      end = j
    }
    /* 上文 18 行:这一条断言前面发生了什么 */
    const before = lines.slice(Math.max(0, i - 18), i).join('\n')
    if (!MUTATES.test(before)) continue                     // 前面没有「写」,不在本刀范围
    if (!(CLAIMS_OK.test(text) || OK_STATUS.test(text))) continue   // 没在断言「成了」
    /* 两头都看:①条件本身有没有读 ②条件里的标识符是不是来自读 */
    const cond = text.replace(/check\(\s*(`[^`]*`|'[^']*'|"[^"]*")\s*,/, '')
    let src2 = readsFact(cond) ? 'fact' : ''
    if (!src2) {
      const ids = [...new Set((cond.match(/\b[a-zA-Z_$][\w$]*\b/g) || []))]
        .filter((x) => !['check', 'true', 'false', 'null', 'undefined', 'String', 'Number', 'Boolean',
          'Object', 'Array', 'JSON', 'Math', 'status', 'data', 'body', 'length', 'includes', 'test',
          'some', 'every', 'filter', 'map', 'find', 'toFixed', 'trim', 'await', 'const'].includes(x))
      const head = lines.slice(0, i).join('\n')
      for (const id of ids) {
        const decl = [...head.matchAll(new RegExp(`(?:const|let|var)\\s+(?:\\{[^}]*\\b${id}\\b[^}]*\\}|${id})\\s*=([\\s\\S]{0,300})`, 'g'))].pop()
        if (!decl) continue
        if (readsFact(decl[1])) { src2 = 'fact'; break }
        if (writesOnly(decl[1])) src2 = src2 || 'write'
      }
    }
    const hit = src2 === 'fact' ? { why: '从事实那头读回来了(条件本身或条件里的变量来自 GET / 查库)' } : null
    /* 条件里若出现 4xx/5xx,多半验的是「该拒」,不是「该成」—— 单独标出来不算嫌疑 */
    const isRefusal = /status\s*===\s*(400|401|403|404|409|422|500|503)/.test(text)
    rows.push({
      file: rel, line: i + 1, cls: isRefusal ? '拒' : (hit ? 'B' : 'A'), why: hit ? hit.why : '',
      name: (text.match(/check\(\s*[`'"]([^`'"]{0,90})/) || [, ''])[1],
    })
  }
}

const A = rows.filter((r) => r.cls === 'A')
const B = rows.filter((r) => r.cls === 'B')
const R = rows.filter((r) => r.cls === '拒')
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ 总条数: rows.length, A: A.length, B: B.length, 拒: R.length, 明细: rows }, null, 2))
} else {
  console.log(`# J-62 第二款 · 第一遍静态筛\n`)
  console.log(`扫了 ${files.length} 个套件。断言「写成功」的 **${rows.length - R.length}** 条(另 ${R.length} 条验的是「该拒」,不在本刀范围):`)
  console.log(`  · **A 类(嫌疑名单)**:只读这一次调用的返回体 —— **${A.length} 条**`)
  console.log(`  · B 类:从事实那头读回来了 —— ${B.length} 条(${[...new Set(B.map((b) => b.why))].join(' / ')})`)
  console.log(`\n⚠️ 静态筛只缩小范围,**不能替代造病** —— 判别式只有一个:注掉落库,它红不红。`)
  const by = {}
  for (const a of A) (by[a.file] ||= []).push(a)
  console.log(`\n## A 类按套件(前 15)\n`)
  for (const [f, v] of Object.entries(by).sort((x, y) => y[1].length - x[1].length).slice(0, 15)) {
    console.log(`- \`${f}\` —— ${v.length} 条`)
  }
}
