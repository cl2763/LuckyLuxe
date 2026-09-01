/* 依赖沙箱(4310)的套件共用前置(店主 02p 追问:别每把刀各打一个补丁)。
   背景:run-all-tests 的 cleanup 会 pkill 掉所有 local-server.mjs —— 沙箱 4310 也在内。
   排在其后又需要**真环境**的套件(目前只有 mp-placeholder-size,现扫全仓确认)必须自己确保它活着。
   收成一处出口:第二把这类刀出现时接这里,不许再各写一套(=「每处各写一套占位」的老毛病换地方长)。 */
export async function ensureSandbox({ label = '' } = {}) {
  const up = async () => fetch('http://127.0.0.1:4310/health').then((r) => r.ok).catch(() => false)
  if (await up()) return { ok: true, started: false }
  const { spawn } = await import('node:child_process')
  spawn('bash', ['start-sandbox.sh', 'sandbox-data'], { cwd: process.cwd(), detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 2000))
    if (await up()) return { ok: true, started: true }
  }
  console.log(`⚠️  ${label} 沙箱 4310 拉不起来 —— **这一刀本轮未跑**`)
  return { ok: false, started: false }
}
