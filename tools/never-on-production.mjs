/* J-114 运行时闸 —— 会造人造钱的种子脚本,跑起来自己拦(店主 11l §四,2026-09-22)
 *
 * ══ 案由 ══
 * 11k 我给 10 支会造人造钱的脚本写死了文件头「此脚本永不对生产跑」,并进了回归。
 * 店主当场指出:**文件头是给人看的,脚本跑起来不会拦。**
 * 真正拦它们的是 `db-target.mjs`(不许有默认目标库)与生产例外七条 —— **不是 J-114 这条**。
 *
 * ══ 判断从哪来(11l 明写:不许另造一套)══
 * 用现成的 `apps/api/data-scope.mjs` 的 `scopeOf(dataDir)` —— 它按**库文件绝对路径**判,
 * 给出 `ci / sandbox / local / production / unknown` 五档。
 * 🔴 **白名单式**:只有 `ci` 与 `sandbox` 放行,**其余一律拒**(包括 `unknown`)。
 *    黑名单(「不是 production 就放行」)会在路径判不出来时默默放行,那正是这条闸要防的。
 *    `local` 也拒 —— 本机库是店主的真实经营数据,02x 那次 148 行就是写进它的。
 *
 * ══ 走 HTTP 的那几支怎么判 ══
 * 它们没有库路径,只有 `BASE_URL`。按 `db-target.mjs` 早就立的那句:
 * **端口会骗人,只有库文件绝对路径不会** —— 所以先打 `/health` 把端口翻译成库路径,再交给 `scopeOf`。
 * 打不通 / 不下发库路径 ⇒ **拒**(判不出来不等于安全)。 */
import { scopeOf } from '../apps/api/data-scope.mjs'

const ALLOWED = ['ci', 'sandbox']

function refuse(what, detail) {
  console.error('\n🔴 J-114:此脚本永不对生产跑。')
  console.error(`   这一支会凭空造出**人**(顾客/技师)或**钱**(单/储值/积分/券)。`)
  console.error(`   「造演示环境」和「开一家真店」是两件事,不许用同一个工具做 ——`)
  console.error(`   前者以「有东西可看」为成功,后者以「一个假的都没有」为成功,目标正相反。\n`)
  console.error(`   判到的库域:${what}${detail ? `(${detail})` : ''}`)
  console.error(`   只许 ci(回归临时库)与 sandbox(沙箱库)。local / production / unknown 一律拒。\n`)
  process.exit(2)
}

/** 直连库的那几支:传库目录(DATA_DIR)或库文件路径都行 */
export function assertNotProductionByPath(dataDirOrFile) {
  const dir = String(dataDirOrFile || '').replace(/\/[^/]*\.sqlite$/, '')
  if (!dir) refuse('(没给目标库)', '写库脚本不许有默认目标库')
  const scope = scopeOf(dir)
  if (!ALLOWED.includes(scope)) refuse(scope, dir)
  return scope
}

/** 走 HTTP 的那几支:先把端口翻译成库路径,再判 */
export async function assertNotProductionByBaseUrl(baseUrl) {
  if (!baseUrl) refuse('(没给 BASE_URL)', '写库脚本不许有默认目标')
  let dataFile = null
  try {
    const r = await fetch(`${baseUrl}/health`).then((x) => x.json())
    dataFile = r?.dataFile || r?.dbPath || null
  } catch (e) {
    refuse('打不通那台服务', `${baseUrl} —— 判不出库域不等于安全`)
  }
  if (!dataFile) refuse('那台服务不下发库路径', `${baseUrl} —— 端口会骗人,只有库路径不会`)
  return assertNotProductionByPath(dataFile)
}
