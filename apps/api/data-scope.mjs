/* 这台服务往哪个库写 —— **按库文件的绝对路径判**,不按环境变量的一句话(店主 06a §四)
 *
 * ══ 立件经过(先把我自己说错的那句更正掉)══
 * 我在 05z 待裁 #28 写「4310 的 dataScope 是 live,套件护栏拦不住它」——**这句话是错的**。
 * `assertTestTarget` 要求 `dataScope === 'test'` 才放行,`live` 是**拒绝**那一档:
 * 现测(只调护栏本身,没跑任何会写库的套件):对 4128 与 4310 各调一次,**两台都被当场拒绝**。
 * 店主据此把它提到 P0 并说「4128 也是 live,护栏对最不能碰的库同样失效」——
 * 前半句(两台都是 live)属实,后半句不成立:**live 正是拦下来的那一档。**
 *
 * ══ 但她指出的三件事仍然成立,这一件就是来收它们的 ══
 * ① `dataScope` 只有 test / live 两档,**分不出本机库 / 沙箱库 / 生产库**;
 * ② 护栏信的是**服务自己报的一个字符串**,不是库文件在哪;
 * ③ 只要谁在店主那台服务上设了 `LL_TEST_DATA=1`,那道门就开了 —— 一个环境变量顶掉了全部保护。
 *
 * 所以这里给两样东西:
 * · `scopeOf(dataDir)` → 细分名字:`ci` / `sandbox` / `local` / `production`
 *   (**路径优先**:路径判得出就用路径的结论;只有路径判不出时才看环境变量 —— 06h 裁 #37);
 * · `isCiDataDir(dir)` → 只有回归临时库那一种目录才是真的可写测试库。
 *   `LL_TEST_DATA=1` 仍然保留(有人手工建临时库跑),但**它只能把 ci 认出来,不能把 local/sandbox 变成可写**。
 */
import { basename, resolve } from 'node:path'
/* 「哪些库域算开发档」**全仓只有一处定义**(`secret-gate.mjs:17`),这里引它,不另写一份。
   secret-gate 自己不 import 任何东西,不会绕成环。
   ⚠️ 登记一处存量重复:下面的 `DEMO_OK_SCOPES` 与它是同一个集合(都是 {ci, sandbox}),
   合并是对的,但那会动演示门,**不在本批范围**,留给后续批。 */
import { DEV_SCOPES } from './secret-gate.mjs'

/** 回归临时库:`/tmp/ll-ci-data.XXXXXX` 这一种(run-all-tests.sh 建的) */
export function isCiDataDir(dataDir) {
  return /^ll-ci-data\./.test(basename(resolve(String(dataDir || ''))))
}

/** 细分名字 —— 报数、护栏、预检都用这一个出口(一件事一处真相) */
export function scopeOf(dataDir, env = process.env) {
  const dir = resolve(String(dataDir || ''))
  /* 🔴 06h 裁 #37:**路径判据在前,环境变量在后**。
     上一版把环境变量排在第一行 —— 跟本文件抬头那句「按库文件的绝对路径判,不按环境变量的一句话」
     正好相反。现测后果:谁的 shell 里常设着 `NODE_ENV=production`(店主那台就是),
     回归临时库 `/tmp/ll-ci-data.XXXX` 会被判成 `production`,护栏拒跑,**整轮回归起不来**。
     方向是朝安全那边失败(拒绝,不是放行),所以不是安全洞,是**口径自相矛盾**。
     现在:路径判得出 ci / sandbox / local 就**用路径的结论**;只有路径判不出(unknown)才看环境变量 ——
     真生产在 Railway 上路径本来就是 unknown,那一支保留是对的,只是不该排在前面。 */
  if (isCiDataDir(dir)) return 'ci'
  if (/[/\\]sandbox-data$/.test(dir)) return 'sandbox'
  if (/[/\\]local-data$/.test(dir)) return 'local'
  if (env.NODE_ENV === 'production' || env.RAILWAY_ENVIRONMENT) return 'production'
  return 'unknown'
}

/** 老口径(test / live)—— 护栏与 D72 建店 kind 还在用,保持语义不变:
 *  只有 ci 才是 test;`LL_TEST_DATA=1` 只在**目录本身不是本机库/沙箱库**时才认(堵住那个口子)。 */
export function legacyScope(dataDir, env = process.env) {
  const name = scopeOf(dataDir, env)
  if (name === 'ci') return 'test'
  if (env.LL_TEST_DATA === '1' && name === 'unknown') return 'test'
  return 'live'
}

/* ══ 裁 #90(店主 07l §二,2026-09-14):判「这是不是真环境」**只许这一个出口** ══
 *
 * 以前这件事在仓里有**两个判法**,而且可以分叉:
 *   · `local-server.mjs` 的 `IS_PRODUCTION` —— 纯环境变量
 *   · 本文件的 `scopeOf()`                  —— 路径在前(裁 #37 治过)
 * 最坏的那个分叉是**真实存在的部署事故**:
 *   **部署时 `NODE_ENV` 没设 → `IS_PRODUCTION` 为 false → 演示门开着 → 而它连的是生产库。**
 * `scopeOf` 看的是库路径,这个组合它认得出来。
 *
 * 🔴 **但店主定的是「或」不是「换」**:不许把 `IS_PRODUCTION` 换成库域判断 ——
 * 换掉有可能在某个组合下(`IS_PRODUCTION=true` 而库域被判成 sandbox)**把门打开**,那是把闸放松。
 * 正确形状是**两个判据任一成立就关**:
 *
 *     演示门开 ⇔ (不是 IS_PRODUCTION) 且 (库域 ∈ {ci, sandbox})
 *
 * 这个形状**只会更严,永远不会更松**。合「失败朝安全那边」。
 */
export const DEMO_OK_SCOPES = new Set(['ci', 'sandbox'])

/** 环境变量那一路的生产判定(两个判据里的第一个) */
export function isProductionEnv(env = process.env) {
  return env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT)
}

/* ══ 🔴 `treatAsReal()` —— 裁#90 的「或」用在「要不要动真库」上(店主 09r §三 批)══
 *
 * 立件:两条**一次性迁移**(`backfillTenantKindOnce` / `retireLegacyDemoArchives`)
 * 此前只靠 `IS_PRODUCTION` 这一个纯环境变量挡着,而它们**会改生产库里 `tenants.kind`
 * 与 `users.tags_json` 的内容**(不是加行,是改内容)。
 * 变量漏设一次,它们就会按 **id 前缀 / 名字含「演示」** 去改判真店 ——
 * 而那正是 **D73 已经废弃的判法**(演示店走显式勾选,不再看 id 前缀),
 * 并且现成的靶子就有:**`jics-nail`(小婕真店)与 `jics-store`(沙箱镜像)前缀相同。**
 *
 * 形状与 `demoLoginAllowed` 一模一样,**两个判据任一说「这是真的」就当真环境办**,
 * 只会更严、不会更松:
 *
 *     当真环境办 ⇔ (环境变量说是生产) 或 (库域不是 ci/sandbox)
 *
 * 🔴 第二个判据**必须**写成 `!DEV_SCOPES.has(...)`,**不许写 `=== 'production'`** ——
 * 生产库路径以 `local-data` 收尾,`scopeOf()` 在生产上返回的是 `'local'`(09p §一 现查),
 * 拿 `=== 'production'` 判**在生产上永远不成立,等于没加**。
 *
 * 代价(店主 09r 明确接受):**本机库也会被判成真环境**,那两条迁移以后在本机也不跑。
 * 理由是「那两条的判法本身就是错的,让它跳过正是我们要的」。
 * 沙箱(`sandbox`)与回归临时库(`ci`)不受影响。
 *
 * @returns {boolean} true = 按真环境办(该跳过的就跳过)
 */
export function treatAsReal({ dataDir = '', env = process.env } = {}) {
  if (isProductionEnv(env)) return true                       // ① 环境变量说是生产
  if (!DEV_SCOPES.has(scopeOf(dataDir, env))) return true      // ② 库域不是开发档
  return false
}

/** 演示门唯一出口:**两个判据任一说「这是真的」就关**。 */
export function demoLoginAllowed({ dataDir = '', env = process.env } = {}) {
  if (isProductionEnv(env)) return false                    // ① 环境变量说是生产 → 关
  if (!DEMO_OK_SCOPES.has(scopeOf(dataDir, env))) return false  // ② 库域不是 ci/sandbox → 关
  return env.ALLOW_DEMO_ADMIN_LOGIN === 'true'              // 两关都过了,才看那个开关
}
