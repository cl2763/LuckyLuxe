#!/usr/bin/env node
/* 06d §一 · 上线批清单**合成一份**,会变的数**由脚本重算并带读数时刻**(店主 06d 裁,06i §三 排期)
 *
 * ══ 案由 ══
 * 仓里曾经有两份:`上线批清单_2026-09-09.md`(12 条)与 `上线批清点_2026-09-10.md`(段 5 新增 3 条)。
 * 第一份写「本地领先 origin/main **194** 个提交」,而同一天早报写的是 **208** ——
 * 同一件事两个数,**两处都没带读数时刻**。
 * 店主的话:「上线批清单是那种**别人会拿去当准数用**的文件,它里面的数过期比没有更危险。」
 *
 * ══ 所以这把刀做三件 ══
 * ① **只出一份**:`handoff/上线批清单_最新.md`(不带日期,每次覆盖同一份);
 * ② 会变的数**现查**:领先多少提交、/health 里的几个值、几把棘轮的现测值 ——
 *    **人不许手抄**(和 J-23「未动那行由刀打印」同族);
 * ③ 每个现查值后面跟 **「截至 HH:MM 现查」**,并在抬头写清是哪一次提交、哪台服务上读的(J-39 同族)。
 *
 * ⚠️ 只读:它不碰生产、不写任何库,`/health` 也只读本机两台。
 * 用法:node tools/release-checklist.mjs [--out <路径>]
 */
import { writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { probe } from './scanner-probe.mjs'
/* J-58⑤ 自守:这把刀读 `/health` 的每一格生成上线清单;核心判定是「某一格是不是真话」。
   现踩案底(夜9):`guestIdUnsigned` 那一格曾是**写死的 `true`**,清单第 4 行因此一直是假红 ——
   所以 probe 验的是:**给它一格 `null`(没量到)要认出来,给它 boolean 才算量到**。 */
const measured = (v) => typeof v === 'boolean'
if (process.argv.includes('--probe')) {
  probe('release-checklist', [
    { 样本: false, 该命中: true },
    { 样本: true, 该命中: true },
    { 样本: null, 该命中: false },
    { 样本: undefined, 该命中: false },
  ], measured)
  process.exit(process.exitCode || 0)
}


const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'handoff/上线批清单_最新.md'
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8' }).trim() } catch { return '(取不到)' } }
const now = new Date()
const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
const AT = `(截至 ${hhmm} 现查)`

const health = async (port) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) }).then((x) => x.json())
    return r
  } catch { return null }
}
const h4128 = await health(4128)
const h4310 = await health(4310)

const ahead = git('rev-list', '--count', 'origin/main..HEAD')
const head = git('rev-parse', '--short', 'HEAD')
const styleLits = (readFileSync('apps/web/styles.css', 'utf8').match(/#[0-9a-fA-F]{3,8}\b/g) || []).length
const mpLits = (() => {
  let total = 0
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'miniprogram_npm' || e.name === 'node_modules') continue
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.wxss') && !/tokens\.wxss|tokens-component\.wxss|fraunces-digits\.wxss/.test(p)) {
        total += (readFileSync(p, 'utf8').match(/#[0-9a-fA-F]{3,8}\b|rgba?\([0-9 .,]+\)/g) || []).length
      }
    }
  }
  walk('miniprogram')
  return total
})()
/* 乙档现数从**最新那份红榜**里读(它自己带刀号与指纹,J-39);读不到就如实说读不到 */
const latestRed = (() => {
  const dir = 'handoff/night-runs'
  /* 🔴 按**文件时间**取最新,不按文件名排序:名字里有中文,`sort()` 会把「金放对面后」排到
     「06h后」后面,于是取到的是**旧的那一份**(现测栽过一次)。同族:06e 那次红榜名字写死。 */
  const cands = readdirSync(dir).filter((f) => /^对比度红榜_.*后台.*\.md$/.test(f))
  if (!cands.length) return null
  const pick = cands.map((f) => ({ f, m: statSync(`${dir}/${f}`).mtimeMs })).sort((a, b) => b.m - a.m)[0].f
  const src = readFileSync(`${dir}/${pick}`, 'utf8')
  const m = src.match(/甲档 (\d+) 条\(去重 (\d+)\)· 乙档 (\d+) 条\(去重 (\d+)\)/)
  return { file: pick, a: m ? m[2] : '?', b: m ? m[4] : '?' }
})()

/* 4b 现查:只读两台本机服务的库域,推断它们这把钥匙是怎么来的。**一个字都不读密钥本身。** */
const miniKeyOf = async (port) => {
  try {
    const h = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json())
    const scope = h.dataScopeName || 'unknown'
    /* 🔴 这里**不许靠推断**。头一版我写的是「它起得来,说明已显式配置」—— 那是错的:
       进程可能起于这道闸落地**之前**,活着什么都证明不了(J-52:读口里每一格都要量出来)。
       改成读 `/health` 现测的那一格;这一格不在,就照实说「这台还是旧码」。 */
    if (h.miniSecretSet === true) return `库域 ${scope} · **已显式配置**(现测)`
    if (h.miniSecretSet === false) {
      return scope === 'ci' || scope === 'sandbox'
        ? `库域 ${scope} · 用明写的开发值(**不需要配**,现测)`
        : `🔴 库域 ${scope} · **没显式配**(现测)—— 这台起于这道闸落地之前`
    }
    return `库域 ${scope} · (这台没有 miniSecretSet 这一格 —— **还是旧码**,没验成)`
  } catch { return '(取不到 /health)' }
}
const localMiniKey = await miniKeyOf(4128)
const sandMiniKey = await miniKeyOf(4310)

const L = (x) => (x === null || x === undefined ? '(读不到)' : String(x))
const rows = [

  ['1', '**推 main**', `本地领先 \`origin/main\` **${ahead}** 个提交(HEAD \`${head}\`)${AT}`,
    '批准后一次推;推前手动备份生产库、CI 全绿、推后只读核验四项', '🔴 要店主先批'],
  ['2', '推前**手动备份一次生产库**', `这一批**没连过生产**${AT}`, '推之前手动备份一次,路径写进回报', '🔴 批准后 Code'],
  ['3', '自托管 **Fraunces woff2**', '小程序端已内嵌 base64 子集(2,748 字节),不依赖域名;`FRAUNCES_URL` 仍是空串',
    '有自有域名后再自托管;现状不挡上线', '🟡 上线批'],
  /* 🔴 夜9 段0/段1:这一条**原来是假红** —— 它读的那一格 `guestIdUnsigned` 是个**写死的 true**
     (`health-report.mjs:35`),从来没量过任何东西。段 0 逐条查完三条身份路,结论 **(B)**:
     都已经是服务端签发/校验(结论见 `handoff/night-runs/访客身份串_现查结论_2026-09-12.md`)。
     那一格现在是**现测**:它等于「这个进程还接不接受非服务端签发的顾客身份」。
     所以本机两台报 `true` 是**对的**——它们开着演示登录;真生产进程报 `false`(夜9 现测)。
     这一行因此从「要写代码」变成「上线时只读核一次」。 */
  ['4', '访客身份串服务端签发(**夜9 查实:已经是**)',
    `4128 \`guestIdUnsigned\` = **${L(h4128 && h4128.guestIdUnsigned)}** · 4310 = **${L(h4310 && h4310.guestIdUnsigned)}**${AT}`
    + ' —— 这一格已是**现测**(J-52):它 = **这个进程还接不接受非服务端签发的顾客身份**,'
    + '也就是这个进程开没开演示登录。所以两台报什么取决于它们各自是怎么起的;'
    + '模拟生产进程(`NODE_ENV=production`)现测为 **false**。**读这一行要连进程一起读**',
    '上线后只读核一次 `/health` 这一格是 false 即可;**不需要再写实现**', '🟡 只读核'],
  /* 🔴 07c 裁 #54 §一.5:J-53 的上线硬门槛。
     这一条与第 4 行是**两件事**:第 4 行问「谁来签」(已查实是服务端),
     这一条问「**用哪把钥匙签**」—— 而那把钥匙原来的回落链末端是仓库里的字面量。 */
  ['4b', '🔴 **生产必须显式设 `WECHAT_MINI_TOKEN_SECRET`**(J-53)',
    `本机 4128 ${localMiniKey} · 沙箱 4310 ${sandMiniKey}(截至 ${hhmm} 现查,只读本机)`,
    '① 店主**亲手**生成一把并灌进生产环境变量(Code 不查看、不打印、不拷贝)'
    + ' ② **不得等于 `OWNER_TOKEN`** —— 设一样服务会拒绝启动'
    + ' ③ 上线后只读核一次:服务起得来 = 设对了(起不来会明写缺哪个变量)', '🔴 店主本人'],
  ['5', '生产 `ALLOW_DEMO_ADMIN_LOGIN` **必须未设**',
    '沙箱启动脚本里显式 `true`(**只影响本机沙箱**);生产值**没查**(不碰生产)',
    '上线前在生产上只读确认未设', '🔴 批准后只读核'],
  ['6', '两家真店密码**由店主亲手设**', '未设', '走平台后台「重置老板密码」那条唯一合法路径', '🔴 店主本人'],
  ['7', '31 张表**去 DEFAULT**', '两份旧清单一份写「未逐表核」、一份写「沙箱库 68 张表建表语句里带 DEFAULT」',
    '逐张核「哪些 DEFAULT 是业务默认、哪些该去」;`test-schema-consistency` 兜底', '🟡 上线批'],
  ['8', '生产**会话唯一索引**', '本机/沙箱已有 `(tenant_id, provider, external_user_id)`(启动日志 D132 那行)',
    '上线后只读核一次', '🟡 上线批'],
  ['9', '企微每店先填 `open_kfid`', '未填', '每家店一条真值', '🔴 店主/运营'],
  ['10', '版本指纹灌 **git 提交号**', '现在是手写串', `构建时注入 \`git rev-parse --short HEAD\`(现 \`${head}\`)`, '🟡 上线批'],
  ['11', '对比度**乙档欠账**',
    latestRed ? `最新红榜 \`${latestRed.file}\`:甲档去重 **${latestRed.a}** · 乙档去重 **${latestRed.b}**${AT}` : '(读不到最新红榜)',
    '乙档多半是合同图配色本身,归配色批;甲档必须保持 0', '🟡 配色批'],
  ['12', '小程序 wxss 写死色', `现测 **${mpLits}** 处${AT}(棘轮只许降)`, '边改边收;归一那几批已经在往下带', '🟡 长期'],
  ['13', '`styles.css` 写死色', `现测 **${styleLits}** 处${AT}`, '同上', '🟡 长期'],
  ['14', '两页「钉浅色」的钉子', '`platform.html` / `sign.html` 各一颗 `data-theme="light"`(判据锁死只许 2 颗)',
    'D188 整页双档化时拆掉', '🟡 D188'],
  /* 🔴 11i §一:店主原话「一定要确保租户不要篡位,会员档案不要串味,**这是最严重的**」。
     这一条进推前清单,是因为它是这个产品最贵的一条护栏 —— 推之前必须看见它是绿的。 */
  ['16', '🔴 **跨店隔离总验**', (() => {
    const f = 'apps/api/test-cross-tenant-isolation.mjs'
    if (!existsSync(f)) return '🔴 **套件不在**'
    const src = readFileSync(f, 'utf8')
    const n = (src.match(/^\s*check\(/gm) || []).length
    const pos = (src.match(/阳性对照/g) || []).length
    const inReg = readFileSync('apps/api/run-all-tests.sh', 'utf8').includes('cross-tenant-isolation')
    /* 判据五(计数即证):源码里的 `check(` 调用点会比实跑条数少 —— ⑤ 组是一个 check( 在 for 里跑三遍。
       差额别在这里猜(第一版拿正则去认 for 块,嵌套的 `]` 直接把它骗了,算出来跟静态数一样,
       等于这行字什么也没证明)。改成**读套件自己声明的那个数** —— 套件里有 EXPECTED_CHECKS,
       跑的时候它自己对,对不上就红。这里只负责把它显示出来,并守住「这个声明还在」。 */
    const m = src.match(/const EXPECTED_CHECKS = (\d+)/)
    const declared = m ? Number(m[1]) : null
    if (declared === null) return `🔴 **套件没有声明 EXPECTED_CHECKS** —— 条数没人守(判据五)`
    return `套件在 · 实跑 ${declared} 条(套件自己守住这个数,对不上就红)· 源码 ${n} 个 check( 调用点 · 其中 ${pos} 处写明阳性对照 · 进回归=${inReg ? '是' : '🔴 否'}`
  })(),
    '推之前它必须绿。**每一条「拒」都要有阳性对照** —— 没有阳性对照的「拒」不算数(J-58①)', '🔴 每批'],
  ['15', '登录态那几页的覆盖', '**夜8 已补齐 13/13,没扫 0**(06i 时是 11/13:`结算页` 卡在夹具把 technician 塞成 null、`门店信息` 的到达 marker 写错 —— 两处都是夹具/判据自己的毛病,不是产品缺东西)',
    '这一条已经清了;下一步是把那 13 页的乙档欠账收掉(见第 11 行)', '✅ 已清(夜8)'],
]

const lines = ['# 上线批清单(**唯一一份**,每次由脚本覆盖)', '',
  `> 生成于 ${now.toISOString()} · HEAD \`${head}\` · 由 \`tools/release-checklist.mjs\` 现查重算`,
  '> 🔴 **凡带「截至 HH:MM 现查」的数都是这一次跑出来的**,不是手抄的 —— 别人拿去当准数用之前先看这一行。',
  '> 上一版曾经有两份(`上线批清单_2026-09-09.md` 12 条 + `上线批清点_2026-09-10.md` 3 条),',
  '> 两份对同一件事给了 **194** 和 **208** 两个数且都没带时刻 —— 店主 06d 裁:合成一份、数由脚本重算。', '',
  '| # | 事 | 现在是什么(现查) | 上线前要做什么 | 谁做 |', '|---|---|---|---|---|']
for (const r of rows) lines.push(`| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} |`)
lines.push('', '## 这一份里哪些是「现查」出来的',
  '', '- 领先提交数 / HEAD:`git rev-list --count origin/main..HEAD`',
  '- `guestIdUnsigned`:本机 4128 与 4310 的 `/health`(**只读本机,不碰生产**)',
  '- 两把写死色棘轮:按预检那两条同样的命令重数',
  '- 甲/乙档:从**最新那份红榜**里读(红榜自己带刀号与界面指纹)', '')
writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log(`✅ 上线批清单已重算 → ${OUT}`)
console.log(`   领先 ${ahead} · HEAD ${head} · guestIdUnsigned 4128=${L(h4128 && h4128.guestIdUnsigned)} 4310=${L(h4310 && h4310.guestIdUnsigned)}`)
console.log(`   styles.css 写死色 ${styleLits} · 小程序 wxss ${mpLits}` + (latestRed ? ` · 红榜 ${latestRed.file} 甲${latestRed.a}/乙${latestRed.b}` : ''))
