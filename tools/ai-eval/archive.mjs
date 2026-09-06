/* 评测明细的**落盘口径**(店主 05p 补三 裁,J-30)

   案底(同一件事第二次):05l 那次已经裁过「不许再写 `/tmp`」,而 05p 的到底率三跑
   又只留在 `/tmp/br-05p-*.json` 里 —— 回执上写着 6/6/7、10/10/10、4/6,
   **明细一份都没入仓,没法核**。数字不能核,就跟没这个数一样。

   所以这一件把三样定死:
   ① **默认路径就是档案目录**,`*_OUT` 只许覆盖、不许留空;写 `/tmp` 的分支删掉;
   ② 每份明细顶部记 `ranOn`(日期 + 星期几)与**夹具店的休息日** ——
      到底率那条曲线被星期几左右过一次(05p 现测),以后每份自带这个上下文,
      下次谁拿两份不同星期几的数对比,一眼就看得出来不该比;
   ③ 文件名带批号、尺子、第几轮,同一批的几轮排在一起。 */
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const EVAL_DIR = join(ROOT, 'handoff', 'ai-eval-results')

const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/* 归档路径。**没有 /tmp 这个选项** —— 调用方给了 `override` 就用它,没给就落档案目录。 */
export function evalOutPath({ batch, name, ruler = '', round = 0, ext = 'json', override = '' }) {
  if (override) return override
  mkdirSync(EVAL_DIR, { recursive: true })
  const day = new Date().toISOString().slice(0, 10)
  const parts = [batch, name, ruler, round ? `第${round}轮` : '', day].filter(Boolean)
  return join(EVAL_DIR, `${parts.join('_')}.${ext}`)
}

/* 跑机上下文:什么时候跑的、星期几、夹具店那天开不开门。
   `db` 可空(不是每把跑机都开库);开了库就把休息日一并记上。 */
export function runStamp({ db = null, shops = [], timezone = 'America/Toronto' } = {}) {
  const now = new Date()
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  /* Intl 没有 weekday:'numeric';取英文短名再查表(比自己算稳,时区由 Intl 负责) */
  const wdShort = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now)
  const wdIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wdShort)
  const stamp = { ranOn: local, weekday: WD[wdIdx] || wdShort, timezone, ranAtUtc: now.toISOString() }
  if (db && shops.length) {
    stamp.fixtureClosedDays = {}
    for (const tid of shops) {
      try {
        const rows = db.prepare(`SELECT bh.weekday FROM business_hours bh
          JOIN stores s ON s.id = bh.store_id WHERE s.tenant_id = ? AND bh.is_closed = 1`).all(tid)
        stamp.fixtureClosedDays[tid] = rows.map((r) => WD[Number(r.weekday)] || String(r.weekday))
      } catch { stamp.fixtureClosedDays[tid] = '(读不到营业时间)' }
    }
    /* 🔴 这一栏是给「以后谁拿两份数对比」用的:
       跑在周日 vs 跑在周三,「明天」是不是营业日不一样,到底率就不可比。 */
    stamp.compareWarning = '到底率类的数,只有 ranOn 星期几相同的两份才可直接比 —— 开场里带「明天」的组会被店休日压住。'
  }
  return stamp
}
