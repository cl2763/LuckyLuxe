#!/usr/bin/env node
/* J-38(店主 05y §二 立)· **图要带拍摄时刻,不许拿修前的图给修后的结论作证**
 *
 * 案底:`09截图/01_整机深色…png` 拍于 20:41:48,而它作证的那一段(金额归一 `54f1d31`)提交于 20:59:18 ——
 * 图比修法早 18 分钟,图上大数字仍是带 `.00` 的那一版,**正是 §四 声称已修的那件事**,
 * 而回执里没有一句说明这张拍于修前。不是撒谎,但店主打开图看到的还是那个病。
 *
 * 这把刀做机械比对:**每一张交付图的拍摄时刻 vs 本批最后一次代码提交的时刻**。
 *   · 图早于代码提交 → 🔴(要么重拍,要么在对照说明里写明「这张拍于 X,证的是 Y;Z 那处已在 W 修掉」)
 *   · 图晚于代码提交 → ✅
 * 时刻从哪来:优先**文件名里的 `YYYYMMDD-HHMMSS`**(`tools/web-page-shots.mjs` 会写进去),
 * 没有就退回文件 mtime,并在输出里标明用的是哪一种(退回 mtime 不如文件名可靠:拷贝会改 mtime)。
 *
 * 用法:node tools/shot-freshness.mjs <图目录|图文件> [...]  [--since <git-ref>]
 *   --since 给的那个 ref 之后的提交才算「本批」;不给就用「与 origin/main 的分叉点」。
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const sinceIdx = args.indexOf('--since')
const SINCE = sinceIdx >= 0 ? args[sinceIdx + 1] : ''
/* 🔴 现测栽了一次:`i !== sinceIdx + 1` 在没给 --since 时(sinceIdx = -1)会把**第 0 个参数**吃掉,
   于是「五页两档」那整个目录被静默丢掉,刀只比了 1 张图还报绿 ——
   **少比了不报**正是静默失败器族。现在只有真给了 --since 才跳过它后面那一个。 */
const targets = args.filter((a, i) => a !== '--since' && a !== '--files'
  && !(sinceIdx >= 0 && i === sinceIdx + 1) && !(args.indexOf('--files') >= 0 && i === args.indexOf('--files') + 1))
if (!targets.length) { console.error('用法: node tools/shot-freshness.mjs <图目录|图文件> [--since <git-ref>]'); process.exit(2) }

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
/* ── 裁 #32(店主 06g §五)· **尺子改成锚「这一段改过的文件」** ────────────────
   06f 撞上的:提交一次 `apps/api/assertion-baseline.json`(测试基线,改不了任何像素)
   就把 6 张刚拍的图判成「修前的图」。我当时**没有松判据,去重拍了一次** —— 店主认了这个反应,
   但也裁了:判据本身太粗,它拿「任意一次最后提交」去比图的时刻。
   现在细成两档尺子:
     · **细尺**:给了这一段改过的文件清单(`--files a,b,c`,或对照说明里那行「文件清单:」)
       → 只看**最后一次触碰这些文件**的提交;
     · **粗尺**:拿不到清单 → 退回三棵树的老口径(**宁严勿松**:宁可多逼一次重拍)。
   抬头必须报清楚这次用的是哪把尺子、比的是哪个提交号(J-39:数要带尺子)。 */
const CODE_PATHS = ['apps/web', 'miniprogram', 'apps/api']
const filesIdx = args.indexOf('--files')
let RULER_FILES = filesIdx >= 0 ? String(args[filesIdx + 1] || '').split(',').map((x) => x.trim()).filter(Boolean) : []
/* 清单也可以写在对照说明里:一行 `文件清单: a, b, c`(拍图的刀顺手写,回执直接引） */
if (!RULER_FILES.length) {
  for (const t of args) {
    const note = join(t, '对照说明.md')
    if (!existsSync(note)) continue
    const m = readFileSync(note, 'utf8').match(/^\s*(?:文件清单|改过的文件)\s*[::]\s*(.+)$/m)
    if (m) RULER_FILES = m[1].split(/[,,]/).map((x) => x.trim().replace(/^`|`$/g, '')).filter(Boolean)
    if (RULER_FILES.length) break
  }
}
const RULER = RULER_FILES.length ? RULER_FILES : CODE_PATHS
const RULER_KIND = RULER_FILES.length ? '细尺(只看这一段改过的文件)' : '粗尺(三棵树全看;没拿到文件清单,宁严勿松)'
let lastCodeAt = ''
let lastCodeSha = ''
try {
  const range = SINCE ? `${SINCE}..HEAD` : 'HEAD'
  const out = git('log', '-1', '--format=%H %cI', range, '--', ...RULER)
  const [sha, iso] = out.split(' ')
  lastCodeSha = (sha || '').slice(0, 7); lastCodeAt = iso || ''
} catch { /* 没有 git 信息就在下面报出来 */ }

const files = []
for (const t of targets) {
  if (!existsSync(t)) { console.log(`not ok - 找不到 ${t}`); continue }
  if (statSync(t).isDirectory()) {
    for (const f of readdirSync(t)) if (/\.(png|jpg|jpeg)$/i.test(f)) files.push(join(t, f))
  } else if (/\.(png|jpg|jpeg)$/i.test(t)) files.push(t)
}

const stampOf = (file) => {
  const m = basename(file, extname(file)).match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/)
  if (m) {
    const [, Y, M, D, h, mi, s] = m
    return { at: new Date(`${Y}-${M}-${D}T${h}:${mi}:${s}`), from: '文件名' }
  }
  return { at: statSync(file).mtime, from: 'mtime(不如文件名可靠:拷贝会改它)' }
}

let n = 0
const fails = []
console.log(`用的是**${RULER_KIND}**`)
console.log(`比的那次提交:${lastCodeSha || '(取不到)'} @ ${lastCodeAt || '(取不到)'}`)
console.log(`尺子看的路径:${RULER.join(' / ')}\n`)
for (const f of files.sort()) {
  n += 1
  const { at, from } = stampOf(f)
  const fresh = lastCodeAt ? at.getTime() >= new Date(lastCodeAt).getTime() : false
  const line = `${basename(f)} · 拍于 ${at.toISOString()}(取自${from})`
  if (fresh) console.log(`ok ${n} - ${line}`)
  else { fails.push(f); console.log(`not ok ${n} - ${line} —— **比代码提交早**,这张图证不了修后的结论`) }
}
if (!files.length) { console.log('not ok - 一张图都没找到'); process.exit(1) }
if (fails.length) {
  console.error(`\n❌ ${fails.length}/${n} 张图早于本批代码提交(J-38)。`)
  console.error('   要么重拍,要么在对照说明里逐张写明「这张拍于 X,证的是 Y 那一段;Z 那处是当时状态,已在 W 修掉」。')
  process.exit(1)
}
console.log(`\n✅ ${n} 张图都晚于本批代码提交(J-38 过)`)
