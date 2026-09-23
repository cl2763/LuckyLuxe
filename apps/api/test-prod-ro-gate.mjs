#!/usr/bin/env node
/* 生产只读闸判据(店主 2026-09-24 裁:「两次靠自觉都没守住,改机器闸」)
 *
 * 守的是 tools/prod-ro.mjs —— 生产查询的唯一入口。
 * 分层归因(判据四):每一刀都标明**是哪一道闸**挡下的,并单独证明
 * 「拿掉闸一,闸二照样挡得住」—— 否则分不出哪层在守、哪层是摆设。 */

import { scanBanned, assertReadOnlySql, buildCommand, buildPayload, SHAPE, DB_PATH } from '../../tools/prod-ro.mjs'

let n = 0, bad = 0
const ok = (c, m) => { n++; c ? console.log(`ok ${n} - ${m}`) : (bad++, console.log(`not ok ${n} - ${m}`)) }
const rejects = (fn) => { try { fn(); return null } catch (e) { return e.message } }

console.log('── 闸一:黑名单点名(诊断用,不是安全底线)──')
for (const [input, word] of [
  ['cat /etc/passwd > /tmp/x', '> /'], ['tee /tmp/x', 'tee'], ['cp a b', 'cp'], ['mv a b', 'mv'],
  ['rm -rf /', 'rm'], ['cat << EOF', 'cat <<'], ['echo x >> y', '>>'], ['base64 -d > /tmp/q', '> /'],
]) ok((scanBanned(input) || '').includes(word), `闸一点名「${word}」:${input}`)
ok(scanBanned('SELECT * FROM t WHERE n > 0') === null, '闸一不误杀 SQL 比较号 n > 0')
ok(scanBanned("SELECT name FROM stores WHERE name LIKE '%美甲%'") === null, '闸一不误杀中文 LIKE')

console.log('── 闸二:SQL 白名单(真正挡住「塞一条命令」的那道)──')
// 🔴 关键归因:**绕过闸一直接喂闸二**,证明闸二自己也挡得住 —— 不是靠闸一在前面兜着
for (const cmd of ['cat /etc/passwd > /tmp/x', 'tee /tmp/x', 'DROP TABLE tenants', 'UPDATE t SET a=1',
                   'DELETE FROM t', 'ATTACH DATABASE x AS y', 'PRAGMA journal_mode=DELETE', 'VACUUM INTO "/tmp/x"'])
  ok(rejects(() => assertReadOnlySql(cmd)) !== null, `闸二独立挡下(不经闸一):${cmd.slice(0, 34)}`)
ok(rejects(() => assertReadOnlySql('SELECT 1; DROP TABLE t')) !== null, '闸二:多语句夹带')
ok(rejects(() => assertReadOnlySql('/* SELECT */ DELETE FROM t')) !== null, '闸二:块注释藏头')
ok(rejects(() => assertReadOnlySql('-- SELECT\nDELETE FROM t')) !== null, '闸二:行注释藏头')
ok(rejects(() => assertReadOnlySql('')) !== null, '闸二:空 SQL')
ok(rejects(() => assertReadOnlySql('SELECT 1')) === null, '闸二放行 SELECT')
ok(rejects(() => assertReadOnlySql('PRAGMA table_info(stores)')) === null, '闸二放行 PRAGMA table_info')

console.log('── 闸三:命令形状白名单 ──')
const good = buildCommand({ a: 'SELECT 1' }, 'SELECT 1')
ok(SHAPE.test(good), '闸三:正常查询拼出的命令符合形状')
for (const evil of [good + ' > /tmp/x', good + ' | tee /tmp/x', good.replace('node', 'sh -c node'), good + '; rm -rf /'])
  ok(!SHAPE.test(evil), `闸三:形状被篡改即拒 — ${evil.slice(-22)}`)
ok(!/[<>|&`$]/.test(good.replace(/^node --experimental-sqlite -e '.*' /, '')), '闸三:base64 段只含 A-Za-z0-9+/=,没有 shell 元字符')

console.log('── 闸四:sqlite 只读 ──')
ok(buildPayload({ a: 'SELECT 1' }).includes('readOnly:true'), '闸四:payload 里写死 readOnly:true')
ok(buildPayload({ a: 'SELECT 1' }).includes(JSON.stringify(DB_PATH)), '闸四:库路径写死,不从参数取')
ok(!/process\.argv\[2\]|process\.env/.test(buildPayload({ a: 'SELECT 1' })), '闸四:payload 不读任何外部变量(库路径无注入面)')

console.log('── 反向守:不许有第二条进生产的路 ──')
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../../', import.meta.url).pathname
const hits = []
for (const dir of ['tools', 'apps/api', 'apps/web']) {
  let fs2 = []
  try { fs2 = readdirSync(join(ROOT, dir)) } catch { throw new Error(`反向守:读不到 ${dir} —— 前置没了就红,不许静默跳过`) }
  for (const f of fs2) {
    if (!/\.(mjs|js|sh)$/.test(f)) continue
    if (f === 'prod-ro.mjs' || f === 'test-prod-ro-gate.mjs') continue
    // 先剥注释再扫:注释里提到 `railway ssh` 的有两处(db-backup-core 的事故记述、
    // db-target-guard 的法条引用),把注释算进来会制造噪音,真的第二条路反而埋在噪音里。
    const src = readFileSync(join(ROOT, dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*(\/\/|#).*$/gm, ' ')
    if (/railway\s*['"`]?\s*,?\s*\[?\s*['"`]?ssh/.test(src) || /railway\s+ssh/.test(src)) hits.push(`${dir}/${f}`)
  }
}
ok(hits.length === 0, `反向守:全仓只有 prod-ro.mjs 一处 railway ssh${hits.length ? ' —— 另有 ' + hits.join(' ') : ''}`)

console.log(`\n  ${n - bad} 过 · ${bad} 红`)
process.exit(bad ? 1 : 0)
