/* 「未动须有证」刀(店主 03q 立律,2026-09-03 落)

   ══ 立律案由(同族第三次,一次比一次贴近)══
   ① 02x 误跑演示夹具 → 148 行写进本机库;
   ② 03d 手敲 curl → 冲销了一条**真实收入**;
   ③ 03p **我自己找到了病根(DB_PATH 焊死本机库)、也修了脚本,
      但已经落地的 5 行没清,回执还写着「本机库未动」** —— 店主拿备份逐表对行数查出来的。

   店主的定性,照录:**事故本身不是最重的,「未动」写错才是。**
   **四库四名是交付里最后一道可信的话;它一失实,别的都不用看了。**

   ══ 律 ══
   **开批先打逐表行数快照,交齐时对照;没有对照表不许写「未动」。**

   ══ 本刀守什么 ══
   律是给人的,判据得守到东西上。三层:
   ① 快照件本身在,且**没有默认目标库**(与 db-target 同一姿态 —— 打错了不报错正是病根);
   ② 快照件真能对出差异(**造一份差一行的快照,必须红且点名是哪张表**)——
      一把"对什么都说没差异"的对账器,比没有还危险;
   ③ 回执自证:凡写了「未动」的交付文档,同一份文档里**必须有对照表**
      (库文件绝对路径 + 逐表行数 或 「逐表零差异」那句)。
      这一条是白名单式的:**扫的是"谁说了未动",不是"我记得哪几篇写过"**。 */

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ① 快照件在,且自己没有默认目标库 */
const SNAP = 'tools/db-snapshot.mjs'
const snapSrc = existsSync(join(ROOT, SNAP)) ? readFileSync(join(ROOT, SNAP), 'utf8') : ''
check(`① 「未动须有证」的快照件在(${SNAP}),且目标库走 requireTarget —— `
  + '对账器自己有默认目标 = 你以为在对 A 库,它在对 B 库',
  /requireTarget/.test(snapSrc) && /process\.argv\[2\]/.test(snapSrc), SNAP)

/* ② 行为层:造一份**差一行**的快照,对账器必须红且点名是哪张表。
   静态扫到"写了 diff 逻辑"不等于它真对得出来(判据律:能验行为就别验中间产物)。 */
const SB = join(ROOT, 'apps/api/sandbox-data/lucky-luxe.sqlite')
if (!existsSync(SB)) {
  console.log('⚠️  [untouched-proof] 沙箱库不在 —— **行为层这一刀本轮未跑**(不静默跳过,如实说)')
} else {
  const tmp = join(ROOT, 'apps/api/.untouched-canary.json')
  try {
    execFileSync('node', [join(ROOT, SNAP), SB, tmp], { cwd: ROOT, encoding: 'utf8' })
    const snap = JSON.parse(readFileSync(tmp, 'utf8'))
    /* 落刀凭据(刀留痕律):注入点 = 哪张表、从几改成几 */
    /* 🔴 03y:快照格式从「一个数字」升成 `{rows, cols}`(店主要求对照表出行/列两栏)——
       这把刀的造病段还在按数字加 1,改完之后它注入的是 `NaN`,对账器当然看不出差异。
       **判据要跟着被测物的格式走**:被测物换了形状,造病也得换。 */
    const victim = Object.keys(snap.tables).find((t) => ((snap.tables[t] || {}).rows || 0) > 0)
    const was = snap.tables[victim].rows
    snap.tables[victim] = { ...snap.tables[victim], rows: was + 1 }
    writeFileSync(tmp, JSON.stringify(snap, null, 2))
    console.log(`   [刀] 注入点=快照文件的 ${victim} 表:${was} → ${was + 1}(库本身一个字没动)`)
    let out = ''
    let red = false
    try { out = execFileSync('node', [join(ROOT, SNAP), SB, '--diff', tmp], { cwd: ROOT, encoding: 'utf8' }) } catch (e) { red = true; out = String(e.stdout || '') }
    check('② 🔴 行为层造病验红:快照里改一张表的行数(库本身不动),对账器必须**红且点名那张表** —— '
      + '一把"对什么都说没差异"的对账器比没有还危险',
      red && out.includes(victim) && /不许写「未动」/.test(out), `red=${red} 输出含表名=${out.includes(victim)}`)
    /* ②c 🔴 03y 店主补的那一栏也要能造病验红:**只改列数、行数不动**,对账器必须照样红。
       案由:D121 那批本机库「行数零差异」是真的,但启动迁移给两张表各加了一列 ——
       只比行数的对照表**看不出结构变了**。列这一栏不验,等于加了个不干活的栏目。 */
    execFileSync('node', [join(ROOT, SNAP), SB, tmp], { cwd: ROOT, encoding: 'utf8' })
    const s2 = JSON.parse(readFileSync(tmp, 'utf8'))
    const v2 = Object.keys(s2.tables).find((t) => ((s2.tables[t] || {}).cols || 0) > 0)
    const wasCols = s2.tables[v2].cols
    s2.tables[v2] = { ...s2.tables[v2], cols: wasCols + 1 }
    writeFileSync(tmp, JSON.stringify(s2, null, 2))
    console.log(`   [刀] 注入点=快照文件的 ${v2} 表**列数**:${wasCols} → ${wasCols + 1}(行数一个没动)`)
    let colRed = false
    let colOut = ''
    try { colOut = execFileSync('node', [join(ROOT, SNAP), SB, '--diff', tmp], { cwd: ROOT, encoding: 'utf8' }) } catch (e) { colRed = true; colOut = String(e.stdout || '') }
    check('②c 🔴 只改列数(行数不动)对账器也必须红并点名 —— '
      + 'D121 那批就是「行零差异、结构变了」,只比行数的对照表看不出来',
    colRed && colOut.includes(v2) && /列/.test(colOut), `red=${colRed} 含表名=${colOut.includes(v2)}`)

    /* ②b 还原:同一份快照重打一次,必须回绿(判据要能分出"有差"和"没差",不是一律红) */
    execFileSync('node', [join(ROOT, SNAP), SB, tmp], { cwd: ROOT, encoding: 'utf8' })
    let green = true
    let out2 = ''
    try { out2 = execFileSync('node', [join(ROOT, SNAP), SB, '--diff', tmp], { cwd: ROOT, encoding: 'utf8' }) } catch { green = false }
    check('②b 反向守:还原后同一份快照必须报「逐表零差异」(否则它是把见谁都红的废刀)',
      green && /逐表零差异/.test(out2), out2.split('\n').slice(-2).join(' '))
  } finally {
    try { unlinkSync(tmp) } catch { /* 夹具收尾:不留脏文件(J 族教训:判据不收尾会变得非幂等) */ }
  }
}

/* ③ 回执自证(白名单式):凡写了「未动」的交付文档,同一份文档里必须有对照表。
   扫的是"谁说了未动",不是"我记得哪几篇写过" —— 新写的回执自动进扫描面。 */
const docs = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', 'handoff'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((f) => f.endsWith('.md'))
/* 「说了未动」的形态:「〈库名〉未动」。四库四名 —— 生产库/本机库/沙箱库/回归临时库 */
const SAYS = /(生产库|本机库|沙箱库)\s*(?:·\s*)?未动/
/* 🔴 J-49(店主 07a §六 立)· **声称要靠标记,不靠措辞** ——
   这一条是被一句**诚实话**逼出来的。夜 8 回执里写的是:
     「但『本机库未动』这句话这一夜**我不能说**,因为它确实多了 4 行心跳。」
   那是**否认**自己能作这句声称,而上一版判据按字面搜「未动」,把否认当成了声称,当场判红。
   店主的话:**判据认词不认标记,就会专门惩罚说话最谨慎的那个人。**
   所以现在分两步走:
     ① **逐行**看:哪一行在**作声称**、哪一行只是在**否认/引述/讨论**这句话;
     ② 作声称的,必须有**机器可读的标记**(下面 MARK_RE),而且标记指的那份对照表**文件真的在**。
   留一条 PROOF_LEGACY:立律之前那批用「逐表零差异」这类措辞举过证的,不追溯 ——
   **不是放宽,是不把旧账算成新账**(把它们一并判红会让棘轮 34 立刻涨,而那正是 J-49 要防的「拿棘轮吸收判据缺陷」)。 */
/* 🔴 收尾补跑时又咬出**同一族的第二种**:`夜班令8_未送达_存档` 里写着
   「**本机库未动**的对照表」「**本机库未动**对照表」—— 那是**指令在点名要我交的那份东西**,
   不是一次声称;而「未动对照」恰恰就是标记本身的名字。**判据认词不认标记,连标记的名字都会误伤。**
   所以把「未动 + 对照」这种**名词用法**一并划进「不是声称」。
   真声称若写成「本机库未动。未动对照:xxx.md」,文档级的 MARK_RE 早就先放行了,不受这条影响。 */
const DENY = /不能说|不敢说|不该说|没法说|不许说|不写这句|否认|假红|误判|不是一次声称|这句话.{0,6}不|未动\s*的?\s*对照|不说|别说/
/* 标记格式**写死在这里**,是这条判据唯一认的声称凭据。
   ⚠️ 只认**像真路径**的那种(带 `/`、以 `.md` 收尾)—— 台账里那句
   「未动对照:<文件路径>」是在**描述格式**,不是在作声称;拿占位符当声称就又成了认词不认物。
   现测:上一版的正则把台账那行也咬了,③a 当场报「标记指空」。 */
const MARK_RE = /未动对照\s*[::]\s*([A-Za-z0-9_./\u4e00-\u9fa5-]*\/[A-Za-z0-9_./\u4e00-\u9fa5-]*\.md)/
/* 🔴 J-51(店主 07b §一 立)· **豁免也是判据的一部分,要具名冻结,不许用内容模式。**
   上一版这条豁免是个**内容模式**:/逐表零差异|逐表行数|未动须有证|行数快照|db-snapshot/ ——
   而这些**正是每一批例行都会出现的词**(`db-snapshot` 就是每批要跑的那把刀的名字,
   「逐表零差异」是它的输出原话)。**结构上等于:下一篇回执只要提到 db-snapshot,就自动豁免、不用带标记**
   —— 标记要求恰好对它最该管的那批文件失效,而且走进豁免时一声不响。
   现测证过:写「本机库未动」+「逐表零差异」、不带标记的新文档,在旧口径下是**绿的**(刀 WW)。
   所以改成**具名清单**:立律之前那批逐个列名冻住,**清单只许变短**(有人补了标记就划掉),
   **新文件一律走标记,没有例外**。
   这是 J-49 的下一层:**J-49 说「声称要靠标记不靠词」,J-51 说「豁免也要靠名单不靠词」。** */
const PROOF_FROZEN = new Set([
  "handoff/AI复测_真模型12场景_2026-09-03.md",
  "handoff/P0-P2开检反馈总表.md",
  "handoff/night-runs/05t回执_2026-09-09.md",
  "handoff/night-runs/05v回执_2026-09-09.md",
  "handoff/night-runs/07截图/对照说明.md",
  "handoff/night-runs/D154截图/说明.md",
  "handoff/night-runs/D185_4128待清单_2026-09-09.md",
  "handoff/night-runs/夜班总结_2026-09-08.md",
  "handoff/night-runs/夜班总结_2026-09-09.md",
  "handoff/night-runs/待裁_2026-09-09.md",
  "handoff/回执04a_三病现修+D130身份串味+D131报数_2026-09-03.md",
  "handoff/回执04b_D131九处全修+三处小病+D132请裁_2026-09-03.md",
  "handoff/回执04c_D132会话归店+source地图_2026-09-03.md",
  "handoff/回执04d-1_口径④放闸+source地图补跑_2026-09-03.md",
  "handoff/回执04d-2_AI复测12场景_2026-09-03.md",
  "handoff/回执04e_C2重跑+D136销号+结案批交齐_2026-09-03.md",
  "handoff/回执04f-1_D134现修_2026-09-03.md",
  "handoff/回执04f-2_去DEFAULT31张表_2026-09-03.md",
  "handoff/回执04f-3_三端版本指纹_2026-09-03.md",
  "handoff/回执04g_D137触发器回落红线+重建前必备份+finance_targets_2026-09-03.md",
  "handoff/回执05a_大批05⓪对话全录_2026-09-03.md",
  "handoff/回执05c_⓪b脱敏正门+①门与三档_2026-09-03.md",
  "handoff/回执05d_安全两破口现修+重标名单_2026-09-04.md",
  "handoff/回执05e_按表改标+提示词+两门重跑_2026-09-04.md",
  "handoff/回执05f_三跑取中位+换门_2026-09-04.md",
  "handoff/回执05g_②事实闸_2026-09-04.md",
  "handoff/回执05h_J-20一处真相+尺子改名+③基线_2026-09-05.md",
  "handoff/回执05j_③预约采集_一句一问+查真可约+草稿只建一次_2026-09-05.md",
  "handoff/回执05k_④审样本页_待审与回流_2026-09-06.md",
  "handoff/回执05o-2_新店luvia-bj两库建店_三店判据_2026-09-08.md",
  "handoff/回执05r补一_六张截图落仓+千分位+三店各开一次_2026-09-08.md",
  "handoff/回执05r补三_D155小程序AI同一出口_2026-09-08.md",
  "handoff/回执05r补二_D156顶栏显当前店名_2026-09-08.md",
  "handoff/回执05r补四_段7部分交付_D151合并窗_2026-09-08.md",
  "handoff/夜班令9_八小时_上线硬门槛先查后做_2026-09-11.md",
  "handoff/小批05i_05h验收_J-23未动与对照表矛盾_D140币种一处真相现修_放行③实现_2026-09-05.md",
  "handoff/小批07b_豁免要具名_棘轮降了也要举证_2026-09-12.md",
  "handoff/店主拍板台账.md"
])
const PROOF_FROZEN_CAP = 38   /* 只许变短(J-43:这个数由已验红的这一版判据量出) */
/* 一份文档里「真的在作声称」的行 —— 否认/引述的那些不算 */
/* 🔴 否认必须**挨着那句话**,不能是这一行里随便哪儿的一个「不」。
   现测栽了一次:`安全保证:生产库未动 · 本机库未动。未推 main。**做完不说可以关帐**。`——
   句尾那个「不说」跟前面那句声称毫无关系,而我把裸的「不说」加进 DENY,
   **一口气把 4 篇真声称放走了**(34 → 30,看着还像判据变严了)。
   所以改成**就近判**:只看「库名未动」前后各 14 个字的窗口里有没有否认/转述的词。
   （③f/③i 两条常驻造病守着这一条:真声称不许被吞,转述不许被算。） */
const DENY_NEAR = /不能说|不敢说|不该说|没法说|不许说|不写这句|不说|别说|否认|假红|误判|不是一次声称|这句话/
const claimLinesOf = (src) => src.split('\n').filter((ln) => {
  if (!SAYS.test(ln)) return false
  if (DENY.test(ln) && /未动\s*的?\s*对照|不是一次声称|假红|误判/.test(ln)) return false
  for (const m of ln.matchAll(/(生产库|本机库|沙箱库)\s*(?:·\s*)?未动/g)) {
    const win = ln.slice(Math.max(0, m.index - 14), m.index + m[0].length + 14)
    if (!DENY_NEAR.test(win)) return true      /* 这一处是**真在声称** */
  }
  return false
})
/* 白名单:立律(03q)之前写的回执按当时的规矩办,不追溯 —— 但**必须逐条列出**,
   靠日期猜"哪些是旧的"就是黑名单判据。上限即实际条数,新增要报批。 */
const markerMissing = []
const LEGACY = docs.filter((f) => {
  /* 🔴 现测栽了一次:`git ls-files` 列的是**索引里**的文件,而刚被删掉的那一份还在索引里 ——
     直接 readFileSync 会 ENOENT **整把刀崩掉**(崩掉不是红,是连结论都没有)。
     文件不在就跳过,并不当成违规:它已经不在仓里了,谈不上「声称」。 */
  if (!existsSync(join(ROOT, f))) return false
  const src = readFileSync(join(ROOT, f), 'utf8')
  const m = src.match(MARK_RE)
  if (m) {
    /* 写了标记就得**指得到东西**(J-27 同族:说「交了」而仓里没有那份文件,等于没交)——
       但只在这份文档**真的在作声称**时才较这个真:07a 里那行 `未动对照:handoff/night-runs/xxx对照表.md`
       是在**定义格式**(占位文件名),不是在举证。**没有声称,标记就不承担举证责任。** */
    if (claimLinesOf(src).length > 0 && !existsSync(join(ROOT, m[1]))) markerMissing.push(`${f} → ${m[1]}`)
    return false
  }
  if (PROOF_FROZEN.has(f)) return false
  return claimLinesOf(src).length > 0
})
/* 立律当天先量底数并上棘轮:存量只许降不许升,新写的回执一旦无证即红 */
/* 🔴 落刀现测校正:这个数我原来是**猜的**(写了 61,实测 34)。
   猜出来的棘轮天然留着 27 格空隙 —— 悄悄新增 27 篇无证回执它都不会红。
   店主 03m:**棘轮不许留空隙,上限 = 实际条数。** */
const LEGACY_CAP = 34
check(`③ 回执自证棘轮:${docs.length} 篇 handoff 文档里,写了「〈库名〉未动」却没有对照表的存量 `
  + `${LEGACY.length} 篇 ≤ ${LEGACY_CAP}(立律 03q 前的按当时规矩不追溯;**只许降不许升** —— 新写一篇无证回执立刻红)`,
  LEGACY.length <= LEGACY_CAP, `${LEGACY.length} 篇:${LEGACY.slice(0, 5).join(' | ')}`)

/* ③a 写了标记就得指得到东西 —— 标记指向一份不存在的对照表,等于没证(J-27 同族) */
check(`③a 写了「未动对照:」标记的文档,标记指的那份对照表**文件真的在**(现测 ${markerMissing.length} 处指空)`,
  markerMissing.length === 0, markerMissing.slice(0, 5).join(' | '))

/* ③b 零命中先证刀能咬:造两句已知阳性,一句无证一句有证,必须分得出来 */
const CANARY_BAD = '本批交付完成。生产库未动 · 本机库未动。'
/* 标记**另起一行**——真实回执就是这么写的:声称一行、标记一行。
   (写在同一行也行,但那一行会被「未动对照」这个名词规则判成非声称,
    文档级的 MARK_RE 照样放行 —— 两条路结果一致,这里取更像真实的那种。) */
const CANARY_OK = '本批交付完成。生产库未动 · 本机库未动。\n未动对照:handoff/night-runs/日1_三库逐表对照表_2026-09-12.md'
check('③b 🔴 零命中先证刀能咬:「写了未动**没标记**」必须咬中,「写了未动**且带标记**」必须放行',
  claimLinesOf(CANARY_BAD).length > 0 && !MARK_RE.test(CANARY_BAD)
  && claimLinesOf(CANARY_OK).length > 0 && MARK_RE.test(CANARY_OK),
  JSON.stringify({ 无标记被咬: claimLinesOf(CANARY_BAD).length > 0 && !MARK_RE.test(CANARY_BAD),
    带标记放行: MARK_RE.test(CANARY_OK) }))

/* ③c/③d/③e · J-49 那三条造病(店主 日班令1 段0 点名要的),在判据里常驻:
   判据自己拿三句已知样本走一遍 —— 光靠「跑起来是绿的」证明不了它**分得出**这三种情况。 */
const C_CLAIM_NOMARK = '本批交付完成。**本机库未动**,沙箱库只有心跳。'
const C_MARK_DEAD = '本机库未动。未动对照:handoff/night-runs/这份根本不存在.md'
const C_DENY = '但「本机库未动」这句话这一夜**我不能说**,因为它确实多了 4 行心跳。照实写。'
check(`③j J-51:豁免是**具名清单**,只许变短 —— 现册 ${PROOF_FROZEN.size} 篇 ≤ ${PROOF_FROZEN_CAP}`,
  PROOF_FROZEN.size <= PROOF_FROZEN_CAP, String(PROOF_FROZEN.size))
check('③k J-51 反向守:**新文件走不进豁免** —— 名单里没有的,写多少个「逐表零差异 / db-snapshot」都不算举证',
  !PROOF_FROZEN.has('handoff/night-runs/这是一篇新写的回执.md'))
/* ③l 清单里的名字必须**真的还在仓里**:文件改名/删掉之后条目还留着,等于替不存在的东西背书
   (和 ⑥「白名单不许有死条目」同一条道理) */
const frozenDead = [...PROOF_FROZEN].filter((f) => !existsSync(join(ROOT, f)))
check(`③l 具名清单里没有死条目(现测 ${frozenDead.length} 条指空)`,
  frozenDead.length === 0, frozenDead.slice(0, 4).join(' | '))

check('③c 造病一:写了「未动」当声称、却**没有标记** → 必须算违规',
  claimLinesOf(C_CLAIM_NOMARK).length > 0 && !MARK_RE.test(C_CLAIM_NOMARK))
check('③d 造病二:写了标记、但对照表文件**不存在** → 必须算违规(J-27 同族)',
  MARK_RE.test(C_MARK_DEAD) && !existsSync(join(ROOT, (C_MARK_DEAD.match(MARK_RE) || [])[1] || 'x')))
check('③e 🔴 反向守:像夜 8 那样**否认**自己能说这句话的 —— **不许红**(J-49 的由来)',
  claimLinesOf(C_DENY).length === 0,
  `现测把它当成了 ${claimLinesOf(C_DENY).length} 条声称`)
/* ③f 反向守的反向守:别把 DENY 写得太宽,把真声称也一并放走了 */
check('③f 反向守的反向守:一句**平铺直叙的真声称**不许被「否认」那条规则吞掉',
  claimLinesOf('生产库未动 · 本机库未动。').length === 1)
/* ③g/③h · 收尾补跑那一次又咬出两种「不是声称」的写法,一并常驻:
   ③g 指令文档里点名要我交的那份东西 —— 「本机库未动的对照表」(未动 + 对照,是**名词**);
   ③h 别人**转述**我没说这句话 —— 「而你不说「本机库未动」」。
   两条都属 J-49:**判据认词不认标记,连标记自己的名字、连转述都会误伤。** */
check('③g 「本机库未动**的对照表**」这种**名词**用法 —— 不是声称,不许红',
  claimLinesOf('9. 本机库未动的对照表 · 沙箱库心跳 9 条形状').length === 0)
check('③h 别人**转述**「你不说『本机库未动』」 —— 不是声称,不许红',
  claimLinesOf('而你**不说「本机库未动」**,因为掉线重启后追加了 4 行。').length === 0)
check('③i 🔴 就近判:句尾另起一句里的「不说」**不许**把前面那句真声称放走(现测这一句曾放走 4 篇)',
  claimLinesOf('> 安全保证:**生产库未动 · 本机库未动**。未推 main。做完不说可以关帐。').length === 1)

/* 下限同样取实测值(176),不留空隙:文档只增不减,真要删得有人有意识地改这个数。
   留 24 格余量的写法,等于允许 handoff 被悄悄砍掉四分之一而判据不响。 */
check(`④ 反向守:扫描面 ${docs.length} >= 176 篇 handoff 文档(目录被排除或仓库被裁立刻红;下限取实测值,不留空隙)`,
  docs.length >= 176, String(docs.length))

console.log(`\n[未动须有证] handoff 文档 ${docs.length} 篇 · 说了「未动」无对照表的存量 ${LEGACY.length} 篇(棘轮 ${LEGACY_CAP})`)
if (fails.length) { console.error(`\n❌ test-untouched-proof ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-untouched-proof 通过 ${checks} 项`)
