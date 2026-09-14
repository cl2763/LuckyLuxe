#!/usr/bin/env node
/* J-62 全站成功态清单(店主 07l §一,2026-09-14)
 *
 * 「界面给了回执,后端必须真的收到。」
 * 这把扫描器只做一件事:**把全站所有向用户显示「成了」的地方抠出来,一处不漏。**
 * 它**不判对错、不修任何东西**(店主 07l §十:先出清单,不许边扫边修)。
 *
 * ══ 判据三(白名单判据 > 黑名单):不许靠列举 ══
 * 不是「我列几个我知道的成功提示」,是**把全仓所有出成功态的调用形态抠出来**,
 * 每一处必须落进一个分类。新长出来的自动进清单。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/* 四个面(店主点名的四个):小程序顾客端/商家端同住 miniprogram,按路径再分 */
const SURFACES = [
  { key: '小程序', dirs: ['miniprogram'], ext: /\.(js|wxml)$/ },
  { key: '网页顾客端', dirs: ['apps/web'], ext: /^customer.*\.(js|html)$/, byBase: true },
  { key: '网页后台', dirs: ['apps/web'], ext: /\.(js|html)$/, exclude: /^customer/ },
]

/* ── 成功态的**形态**(不是词表:形态=什么调用/什么写法会让用户看到「成了」)── */
const SHAPES = [
  { id: 'toast-success', re: /icon:\s*['"]success['"]/g, what: '小程序 wx.showToast icon=success(绿勾)' },
  { id: 'wx-modal-ok', re: /showModal\([^)]{0,400}?(成功|已保存|已提交|已发送|已核销|已到账|已确认)/g, what: '小程序 showModal 成功态' },
  { id: 'web-toast', re: /\b(toast|notify|showToast|flash|banner)\s*\(\s*[`'"][^`'"]{0,80}?(成功|已保存|已提交|已发送|已核销|已到账|已确认|已绑定|已更新|已删除|已撤回|已作废)/g, what: '网页 toast/notify 成功文案' },
  { id: 'inline-text', re: /[`'"][^`'"\n]{0,40}(已保存|已提交|已发送|已核销|已到账|已确认|已绑定|已授权|已更新|已删除|保存成功|提交成功|发送成功|核销成功|充值成功|预约成功|支付成功|绑定成功|设置成功|上传成功|导入成功|确认成功)[^`'"\n]{0,40}[`'"]/g, what: '写死的成功句(界面直出)' },
]

const walk = (dir, out = []) => {
  let entries = []
  try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/* J-61②:刀默认排除**判据自身 + 判据的夹具**,并具名 */
const SELF_EXCLUDE = [
  { path: 'tools/success-state-scan.mjs', why: '本文件:形态串的字面量就住在这里' },
  { path: 'apps/api/test-success-state.mjs', why: '本判据的套件' },
]
const isSelf = (f) => SELF_EXCLUDE.some((s) => f === s.path)

const hits = []
for (const s of SURFACES) {
  for (const dir of s.dirs) {
    for (const f of walk(dir)) {
      const base = f.split('/').pop()
      if (s.byBase ? !s.ext.test(base) : !s.ext.test(base)) continue
      if (s.exclude && s.exclude.test(base)) continue
      if (isSelf(f)) continue
      const src = readFileSync(join(ROOT, f), 'utf8')
      const lines = src.split('\n')
      for (const shape of SHAPES) {
        shape.re.lastIndex = 0
        let m
        while ((m = shape.re.exec(src))) {
          const line = src.slice(0, m.index).split('\n').length
          const surface = s.key === '小程序'
            ? (f.includes('/merchant/') ? '小程序商家端' : f.includes('/staff/') ? '小程序员工端' : '小程序顾客端')
            : s.key
          hits.push({ surface, file: f, line, shape: shape.id, text: lines[line - 1].trim().slice(0, 120) })
        }
      }
    }
  }
}

/* 去重:同一行被多个形态命中只算一处(J-48:量过的个数与去重行数分开报) */
const seen = new Set()
const uniq = hits.filter((h) => { const k = `${h.file}:${h.line}`; if (seen.has(k)) return false; seen.add(k); return true })

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ 命中次数: hits.length, 去重处数: uniq.length, 明细: uniq }, null, 2))
} else {
  const bySurface = {}
  for (const h of uniq) (bySurface[h.surface] ||= []).push(h)
  console.log(`# 全站成功态清单(J-62)\n`)
  console.log(`**底数闭合(J-48)**:形态命中 **${hits.length}** 次 · 去重后 **${uniq.length}** 处(同一行多形态命中算一处)\n`)
  for (const [k, v] of Object.entries(bySurface).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`## ${k} —— ${v.length} 处`)
    for (const h of v) console.log(`- \`${h.file}:${h.line}\` [${h.shape}] ${h.text}`)
    console.log('')
  }
}
