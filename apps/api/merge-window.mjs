/* D151 · 入站合并窗(静默等待)—— 顾客连发几句,合成一条再答

   案由(店主六通打分):顾客习惯把一件事拆成三句发。逐句答的后果是
   **三条回复叠在一起、后一条把前一条的问题又问一遍**,像个没听完话就抢答的人。

   规则(店主 05q §二 D151 原文):
   · 收到第一句 → 等 **8 秒**(可配 5–15);
   · 窗内再来的句子 → 并进来,并**按最后一句刷新**这 8 秒;
   · 窗关时把几句合成一条再交给引擎;
   · **窗内早到的那几次调用不出回复** —— 它们的回复「作废不发」。

   为什么放在这一层:五个进线口(企微回调 / 企微 sync_msg / 模拟器两口 / 顾客端)
   走的是同一个 `handleWecomInbound`,窗装在它的入口,**五个口一起吃到**
   (D155 把顾客端并进来之后,小程序自然也吃到 —— 这就是并出口的红利)。

   🔴 一个字都不许猜:合并出来的那条**就是几句原文按顺序连起来**,
   不做摘要、不改写、不去重(D153 引用不重写同族)。 */

/* 定时器**显式 import**:这个文件是搬出来的独立模块,自由标识符扫描要求
   「用到什么就说清从哪来」—— 靠全局隐式拿到的东西,搬到别处就可能不在了。 */
import { clearTimeout as clearTimer, setTimeout as setTimer } from 'node:timers'

const MIN_S = 5
const MAX_S = 15
const DEFAULT_S = 8

/** 窗长(秒)。环境变量可配,越界钳到 5–15;`/health` 报的就是这个数。 */
export function mergeWindowSeconds() {
  const raw = Number(process.env.MERGE_WINDOW_SECONDS)
  if (!Number.isFinite(raw)) return DEFAULT_S
  return Math.min(MAX_S, Math.max(MIN_S, Math.round(raw)))
}

/* key → { parts: string[], timer, waiters: [], closed: boolean } */
const open = new Map()

/** 进窗。
 *  @returns {Promise<{ merged: string|null, superseded: boolean, parts: string[] }>}
 *  · 窗关时**最后一个**进来的那次拿到 `{ merged: '三句连起来', superseded: false }`;
 *  · 早到的那几次拿到 `{ superseded: true }` —— 调用方据此**不出回复**。
 *  窗长为 0(仅测试用 `MERGE_WINDOW_MS=0`)时直接放行,等同于没有窗。 */
export function enterMergeWindow(key, content) {
  const forcedMs = Number(process.env.MERGE_WINDOW_MS)
  const ms = Number.isFinite(forcedMs) ? forcedMs : mergeWindowSeconds() * 1000
  const text = String(content || '')
  if (ms <= 0) return Promise.resolve({ merged: text, superseded: false, parts: [text] })

  return new Promise((resolve) => {
    let win = open.get(key)
    if (!win) {
      win = { parts: [], waiters: [], timer: null }
      open.set(key, win)
    }
    win.parts.push(text)
    /* 早到的那几次先记下来 —— 窗一关,除了最后一个,其余全部按「作废不发」回。 */
    win.waiters.push(resolve)
    if (win.timer) clearTimer(win.timer)   // 按最后一句刷新
    win.timer = setTimer(() => {
      open.delete(key)
      const merged = win.parts.join(' ')
      const last = win.waiters.pop()
      for (const w of win.waiters) w({ merged: null, superseded: true, parts: win.parts.slice() })
      if (last) last({ merged, superseded: false, parts: win.parts.slice() })
    }, ms)
    /* 定时器不许把进程钉住(回归跑完要能退) */
    if (typeof win.timer.unref === 'function') win.timer.unref()
  })
}

/** 测试收尾用:把还开着的窗全清掉(夹具不收尾会让判据非幂等,J 族有案底) */
export function resetMergeWindows() {
  for (const win of open.values()) if (win.timer) clearTimer(win.timer)
  open.clear()
}
