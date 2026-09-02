/* 依赖沙箱(4310)的套件共用前置(店主 02p 追问:别每把刀各打一个补丁)。
   背景:run-all-tests 的 cleanup 会 pkill 掉所有 local-server.mjs —— 沙箱 4310 也在内。
   排在其后又需要**真环境**的套件(目前只有 mp-placeholder-size,现扫全仓确认)必须自己确保它活着。
   收成一处出口:第二把这类刀出现时接这里,不许再各写一套(=「每处各写一套占位」的老毛病换地方长)。 */
/* 🔴 03f 病二的结构性那一半(店主令):**服务必须起于源码之后**。
   案由:我改完 finance-reverse.mjs 就跑刀,而 4310 进程起在最后一次保存**之前两秒**,
   加载的还是旧模块 —— 刀收紧后第一次真咬,咬到的正是「改了没重启」。
   这是「改了没编译 / 加了没进库」的第三形态,同族一并管住:
   比较 4310 进程启动时刻与 apps/api/*.mjs 的最大 mtime,旧进程**出声红**,不是跳过。 */
async function assertServerNewerThanSource(label) {
  const { execFileSync } = await import('node:child_process')
  const { readdirSync, statSync } = await import('node:fs')
  let started = 0
  try {
    const pid = execFileSync('lsof', ['-ti', ':4310'], { encoding: 'utf8' }).split('\n').filter(Boolean)[0]
    if (!pid) return true
    const lstart = execFileSync('ps', ['-o', 'lstart=', '-p', pid], { encoding: 'utf8' }).trim()
    started = new Date(lstart).getTime()
  } catch { return true }                       // 拿不到就不拦(如实不判,不假装通过)
  if (!started) return true
  let newest = 0
  for (const f of readdirSync('.')) {
    if (!f.endsWith('.mjs')) continue
    try { newest = Math.max(newest, statSync(f).mtimeMs) } catch { /* 读不到就跳过这一个 */ }
  }
  if (newest > started) {
    const gap = Math.round((newest - started) / 1000)
    console.log(`🔴 ${label} 沙箱进程起于源码**之前** ${gap} 秒 —— 它加载的是旧模块,`
      + '现在跑出来的绿是假的(「改了没重启」= 改了没编译 / 加了没进库 的第三形态)。')
    console.log('   处置:pkill -f local-server.mjs → bash apps/api/start-sandbox.sh → 重跑')
    return false
  }
  return true
}

export async function ensureSandbox({ label = '' } = {}) {
  const up = async () => fetch('http://127.0.0.1:4310/health').then((r) => r.ok).catch(() => false)
  if (await up()) {
    const fresh = await assertServerNewerThanSource(label)
    return { ok: fresh, started: false, stale: !fresh }
  }
  const { spawn } = await import('node:child_process')
  spawn('bash', ['start-sandbox.sh', 'sandbox-data'], { cwd: process.cwd(), detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 2000))
    if (await up()) return { ok: true, started: true }
  }
  console.log(`⚠️  ${label} 沙箱 4310 拉不起来 —— **这一刀本轮未跑**`)
  return { ok: false, started: false }
}
