#!/usr/bin/env node
/* 生产只读查询的**唯一入口**(店主 2026-09-24 裁,12m 期间立)
 *
 * ══ 为什么有这把闸 ══
 * 我两次往生产容器里写文件(`/tmp/q.mjs`),两次都违反停线「只读进容器可以,写文件不行,
 * 即使 /tmp」。第一次靠自觉、第二次还是没守住 —— **两次靠自觉都没守住,就该改机器闸**。
 * 店主原话:「以后查生产一律走它,手敲命令进生产 = 违规。」
 *
 * ══ 三道闸(白名单为主,黑名单只负责点名)══
 *   闸一 · 输入黑名单:原始输入里出现 `> /`、`>>`、`>&`、`tee`、`cp`、`mv`、`cat <<` → 拒,并说出是哪个词。
 *          (点名用。base64 之后这些字符根本到不了远端 shell,所以它不是安全底线,是给人看的诊断。)
 *   闸二 · SQL 白名单:每条必须以 `SELECT` 或 `PRAGMA table_info(` 开头,且不许多语句。
 *          —— 这是真正挡住「塞一条命令进来」的那道(判据三:白名单 > 黑名单)。
 *   闸三 · 命令形状白名单:拼好的远端命令必须**逐字匹配**固定形状,多一个字符都拒。
 *          本地不经 shell(spawnSync argv,`shell:false`),所以本地没有可注入的面。
 *   闸四 · sqlite 本身:`readOnly: true` 打开,任何写在 sqlite 层就失败。
 *
 * ══ 不做的事 ══
 * 不接受「命令」,只接受 SQL;库路径写死,不从参数取;不提供任何写口、不提供 --force。
 *
 * ══ 用法 ══
 *   node tools/prod-ro.mjs "SELECT COUNT(*) n FROM tenants"
 *   node tools/prod-ro.mjs --file q.json          # {"名字": "SELECT ...", ...}
 *   node tools/prod-ro.mjs --dry "SELECT 1"       # 只打印拼好的命令,不连生产
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const DB_PATH = '/app/apps/api/local-data/lucky-luxe.sqlite'

/* 闸一:黑名单点名。只认**重定向形状**,不认裸 `>` —— SQL 的 `n > 0` 是合法的。 */
const BANNED = [
  [/>\s*[/~]/, '> /(重定向到文件)'],
  [/>>/, '>>(追加重定向)'],
  [/>&/, '>&(描述符重定向)'],
  [/\btee\b/i, 'tee'],
  [/\bcp\b/i, 'cp'],
  [/\bmv\b/i, 'mv'],
  [/\bdd\b/i, 'dd'],
  [/\brm\b/i, 'rm'],
  [/cat\s*<</i, 'cat <<'],
  [/\bbase64\s+-d\b/i, 'base64 -d'],
]
export function scanBanned(text) {
  for (const [re, name] of BANNED) if (re.test(text)) return name
  return null
}

/* 闸二:SQL 白名单 */
const STRIP = (sql) => String(sql)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')   // 块注释
  .replace(/--[^\n]*/g, ' ')            // 行注释
  .trim()
export function assertReadOnlySql(sql, label = 'SQL') {
  const bare = STRIP(sql)
  if (!bare) throw new Error(`[闸二] ${label}:空 SQL`)
  const body = bare.replace(/;\s*$/, '')
  if (body.includes(';')) throw new Error(`[闸二] ${label}:不许多语句(出现了 ";")`)
  if (!/^SELECT\s/i.test(body) && !/^PRAGMA\s+table_info\s*\(/i.test(body)) {
    throw new Error(`[闸二] ${label}:只放行 SELECT / PRAGMA table_info,收到的是「${body.slice(0, 40)}…」`)
  }
  return body
}

/* 闸三:命令形状白名单 —— 拼好的远端命令必须逐字长这样 */
/* 🔴 `--no-warnings`(12t 现修):远端 node 的 ExperimentalWarning 走 stderr,
   而 `railway ssh` 把 stdout/stderr **混在同一个 PTY 流**里 —— 警告会插进 JSON 中间,
   把返回体切坏(现测:85 KB 的 dump 在第 2291 行被一行警告劈开)。
   在远端关掉警告是根治;在本地 grep 掉那一行是治标,而且会连 JSON 一起删。 */
export const SHAPE = /^node --no-warnings --experimental-sqlite -e 'eval\(Buffer\.from\(process\.argv\[1\],"base64"\)\.toString\(\)\)' [A-Za-z0-9+/=]+$/

export function buildPayload(queries) {
  const pairs = Object.entries(queries)
  if (!pairs.length) throw new Error('[闸二] 一条 SQL 也没给')
  for (const [name, sql] of pairs) assertReadOnlySql(sql, name)
  return [
    `const {DatabaseSync}=require('node:sqlite');`,
    `const db=new DatabaseSync(${JSON.stringify(DB_PATH)},{readOnly:true});`,   // 闸四
    `const Q=${JSON.stringify(pairs)};const out={};`,
    `for(const [n,s] of Q){try{out[n]=db.prepare(s).all()}catch(e){out[n]={ERR:e.message}}}`,
    `console.log(JSON.stringify(out,null,1));`,
  ].join('')
}

export function buildCommand(queries, rawInput) {
  const hit = scanBanned(rawInput ?? JSON.stringify(queries))
  if (hit) throw new Error(`[闸一] 输入里出现「${hit}」—— 这把闸只走 SELECT,不接受命令。拒。`)
  const b64 = Buffer.from(buildPayload(queries), 'utf8').toString('base64')
  const cmd = `node --no-warnings --experimental-sqlite -e 'eval(Buffer.from(process.argv[1],"base64").toString())' ${b64}`
  const hit2 = scanBanned(cmd)
  if (hit2) throw new Error(`[闸三] 拼好的命令里出现「${hit2}」—— 拒。`)
  if (!SHAPE.test(cmd)) throw new Error('[闸三] 拼好的命令不符合白名单形状 —— 拒(形状白名单,判据三)。')
  return cmd
}

/* ── CLI ── */
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const argv = process.argv.slice(2)
  const dry = argv.includes('--dry')
  const rest = argv.filter((a) => a !== '--dry')
  let queries
  const fi = rest.indexOf('--file')
  if (fi >= 0) {
    queries = JSON.parse(readFileSync(rest[fi + 1], 'utf8'))
  } else {
    if (!rest.length) { console.error('用法:node tools/prod-ro.mjs "SELECT ..."  |  --file q.json  |  --dry'); process.exit(2) }
    queries = Object.fromEntries(rest.map((s, i) => [`q${i + 1}`, s]))
  }
  let cmd
  try { cmd = buildCommand(queries, rest.join('\n')) }
  catch (e) { console.error(`🔴 ${e.message}`); process.exit(1) }

  if (dry) { console.log(cmd); process.exit(0) }
  // 本地不经 shell:argv 数组直传,没有可注入的面
  const r = spawnSync('railway', ['ssh', cmd], { stdio: ['ignore', 'inherit', 'inherit'], shell: false })
  process.exit(r.status ?? 1)
}
