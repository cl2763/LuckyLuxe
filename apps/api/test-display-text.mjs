/* 说法唯一出口刀(D126,店主 03r 从七态截图里记的两处队尾小病,2026-09-03 落)

   两处小病改的都是**渲染层**,交付时我自己挂了 ⬜:没有常驻判据 ——
   下次谁把大小写敏感的映射写回来、谁再在别处拼一句「N 小时前」,没有人拦。

   ══ 病一:内部枚举漏给人看 ══
   `const TIER = { Silver:'银卡', Gold:'金卡', … }` 键是**首字母大写**,
   而 `memberTier` 来自 AI 抽取的记忆(local-server:1439),大小写随来源。
   `TIER['gold']` 取不到 → 兜底到 `cust.memberTier` → 顾客卡上印出一个裸的 `gold`。
   **「有兜底」和「兜底是对的」是两件事**:这个兜底恰好把内部枚举漏了出去。
   判据两条:①等级映射表的键**必须全小写**(查表前一律 toLowerCase);
             ②兜底**不许是原值** —— 末级必须是中文字面量。

   ══ 病二:同一件事两种说法 ══
   报价横幅原来两种单位并存:未过期走 hoursAgo、已过期/历史走 daysAgo,
   所以同一张卡上「172 小时前」和「2 天前」会并排出现。
   判据:横幅的相对时间**只许经 agoText 一个出口**,不许再有别处直接拼 `小时前`/`天前`。

   两条都是**白名单式**:扫的是"全仓这种形状的写法",逐个必须落进白名单,新写的自动红。 */

/* ⚠️ 剥行注释必须用 `[^\S\n]` 星号,不能用 `\s` 星号 —— **`\s` 包含换行**:
   那样写会把前面的空行连同换行一起吃掉,剥完的文本比原文少行,
   于是**按它算出来的行号全是错的**(03t 现测:admin.js 8551 → 8504,少 47 行,
   我因此连报错三次条数与位置)。同族:块注释也必须**保住换行**再置空。
   (本注释刻意不写出那个正则原文(略)。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tierText, CARD_TEXT } from './conversation-card.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean)
const CODE = tracked.filter((f) => /^(apps\/(web|api)|miniprogram)\/.*\.(js|mjs)$/.test(f)
  && !/\/(test-|run-)/.test(f) && !f.endsWith('test-display-text.mjs'))
/* 注释置空(保住行号)—— 判据不许被自己的案底注释误报(02q 同族教训) */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[^\S\n]*\/\/.*$/gm, '')

/* ═══ 病一 ═══ */

/* ① 后端唯一出口自己得对:大小写不敏感 + 认不出的绝不漏原值 */
const cases = [['gold', '金卡'], ['Gold', '金卡'], ['GOLD', '金卡'], ['  platinum  ', '铂金'],
  ['silver', '银卡'], ['diamond', '钻石'], ['guest', '顾客']]
const wrong = cases.filter(([raw, want]) => tierText(raw) !== want)
check(`① 等级映射出口大小写不敏感:${cases.length} 个已知输入逐个对(gold/Gold/GOLD 同归「金卡」)`,
  wrong.length === 0, wrong.map(([r, w]) => `${r}→${tierText(r)}(应 ${w})`).join(' | '))

/* ①b 🔴 认不出的**绝不回原值** —— 这条正是病根:兜底把内部枚举当中文名显示了 */
const unknowns = ['vip_x', 'TIER_9', 'gold2', '未知等级']
const leaked = unknowns.filter((u) => tierText(u) === u)
check(`①b 🔴 认不出的等级一律说「${CARD_TEXT.tierUnknown}」,**绝不回原值** —— `
  + '「有兜底」≠「兜底是对的」,把内部枚举当中文名显示正是这次的病根',
  leaked.length === 0 && unknowns.every((u) => tierText(u) === CARD_TEXT.tierUnknown),
  `漏原值:${leaked.join(' | ')}`)
check('①c 空值给空串(不是「会员」也不是「—」):没有等级和等级认不出是两件事,不许说同一句话',
  tierText('') === '' && tierText(null) === '' && tierText(undefined) === '', JSON.stringify(tierText('')))

/* ①d 白名单式:全仓等级映射表的键必须全小写(大写键=下一个 gold) */
const TIERMAP = /(?:TIER|TIER_CN|TIER_TEXT|MEMBER_TIER_STYLES)\s*=\s*\{([^}]*)\}/g
const badKeys = []
for (const f of CODE) {
  const src = bare(readFileSync(join(ROOT, f), 'utf8'))
  for (const m of src.matchAll(TIERMAP)) {
    for (const k of m[1].matchAll(/(?:^|[,{\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
      if (/[A-Z]/.test(k[1])) badKeys.push(`${f} 键「${k[1]}」`)
    }
  }
}
/* 白名单:MEMBER_TIER_STYLES 是**CSS 类名表**,键即梯子键,查表已改成大小写不敏感比对。
   理由随码;什么时候要动:若它改回按原样查表(那时大写键又会漏)。 */
const KEY_ALLOW = { 'apps/web/admin.js 键「Silver」': 1, 'apps/web/admin.js 键「Gold」': 1,
  'apps/web/admin.js 键「Platinum」': 1, 'apps/web/admin.js 键「Diamond」': 1 }
const stillBad = badKeys.filter((x) => !KEY_ALLOW[x])
check(`①d 白名单式:全仓 ${CODE.length} 个源文件里等级映射表的键必须全小写(查表前 toLowerCase);`
  + `大写键在册 ${Object.keys(KEY_ALLOW).length} 个(admin.js 的 CSS 类名表,已改大小写不敏感比对)`,
  stillBad.length === 0, stillBad.join(' | '))

/* ═══ 病二 ═══ */

/* ② 报价横幅的相对时间只许一个出口 */
const qs = bare(readFileSync(join(ROOT, 'apps/api/quote-state.mjs'), 'utf8'))
const bannerLines = qs.split('\n').filter((l) => /banner:|`本会话/.test(l))
const selfMade = bannerLines.filter((l) => /小时前|天前/.test(l))
check('② 报价横幅的相对时间只经 agoText 一个出口(横幅行里不许再出现自拼的「小时前」/「天前」)——'
  + '原来未过期走小时、已过期走天,同一张卡上两种说法并排',
  selfMade.length === 0, selfMade.map((l) => l.trim().slice(0, 50)).join(' | '))
check('②b agoText 在场且四处横幅都用它', /const agoText =/.test(qs) && (qs.match(/agoText\(/g) || []).length >= 4,
  `agoText 调用 ${(qs.match(/agoText\(/g) || []).length} 处`)

/* ②c 门槛边界(corner case:恰好等于门槛)—— 复刻 agoText 的算法当场对 */
const now = new Date('2026-09-02T12:00:00Z')
const hA = (at) => Math.max(0, Math.round((now - new Date(at)) / 3600000))
const dA = (at) => Math.max(1, Math.round((now - new Date(at)) / 86400000))
const ago = (at) => (hA(at) < 48 ? `${hA(at)} 小时前` : `${dA(at)} 天前`)
const bounds = [['2026-09-02T11:00:00Z', '1 小时前'], ['2026-08-31T13:00:00Z', '47 小时前'],
  ['2026-08-31T12:00:00Z', '2 天前'], ['2026-08-31T11:00:00Z', '2 天前'], ['2026-08-26T08:00:00Z', '7 天前']]
const offBound = bounds.filter(([at, want]) => ago(at) !== want)
check('②c 门槛边界:47 小时说小时 · **恰好 48 小时**说天 · 49 小时说天 · 172 小时说「7 天前」',
  offBound.length === 0, offBound.map(([a, w]) => `${a}→${ago(a)}(应 ${w})`).join(' | '))

/* ③ 零命中先证刀能咬(店主 03j 律):两条各造一个已知阳性 */
const CANARY_MAP = "const TIER = { Silver: '银卡', Gold: '金卡' }"
const canaryKeys = []
for (const m of bare(CANARY_MAP).matchAll(TIERMAP)) {
  for (const k of m[1].matchAll(/(?:^|[,{\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) if (/[A-Z]/.test(k[1])) canaryKeys.push(k[1])
}
const CANARY_BANNER = "        banner: `本次会话已报价 ${price} · ${hoursAgo(x, now)} 小时前`"
check('③ 🔴 零命中先证刀能咬:①d 造「大写键的映射表」必须咬中;② 造「横幅行自拼小时前」必须咬中',
  canaryKeys.length === 2 && /小时前|天前/.test(CANARY_BANNER) && /banner:/.test(CANARY_BANNER),
  JSON.stringify({ 大写键: canaryKeys, 横幅: /banner:/.test(CANARY_BANNER) }))

/* ③b 反向守:改对了的写法不许被咬(判据要能分出修没修,不是见谁都红) */
const NEG_MAP = "const TIER = { silver: '银卡', gold: '金卡' }"
const negKeys = []
for (const m of bare(NEG_MAP).matchAll(TIERMAP)) {
  for (const k of m[1].matchAll(/(?:^|[,{\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) if (/[A-Z]/.test(k[1])) negKeys.push(k[1])
}
check('③b 反向守:全小写键的映射表不许被咬中(否则修完还红,人会去放宽判据)',
  negKeys.length === 0, JSON.stringify(negKeys))

/* ④ 反向守:扫描面没缩水(判据覆盖面要有判据) */
check(`④ 反向守:扫描面 ${CODE.length} >= 120 个源文件(git ls-files 全量;目录被排除立刻红)`,
  CODE.length >= 120, String(CODE.length))

console.log(`\n[说法唯一出口] 源文件 ${CODE.length} 个 · 等级大写键在册 ${Object.keys(KEY_ALLOW).length} · 横幅自拼 ${selfMade.length}`)
if (fails.length) { console.error(`\n❌ test-display-text ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-display-text 通过 ${checks} 项`)
