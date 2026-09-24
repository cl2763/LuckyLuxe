import {fileURLToPath} from 'node:url'
export const SANDBOX_URL=process.env.TEST_SANDBOX_URL || 'http://127.0.0.1:4310'
/* 依赖沙箱(4310)的套件共用前置(店主 02p 追问:别每把刀各打一个补丁)。
   背景:run-all-tests 的 cleanup 会 pkill 掉所有 local-server.mjs —— 沙箱 4310 也在内。
   排在其后又需要**真环境**的套件(目前只有 mp-placeholder-size,现扫全仓确认)必须自己确保它活着。
   收成一处出口:第二把这类刀出现时接这里,不许再各写一套(=「每处各写一套占位」的老毛病换地方长)。 */
/* 🔴 03f 病二的结构性那一半(店主令):**服务必须起于源码之后**。
   案由:我改完 finance-reverse.mjs 就跑刀,而 4310 进程起在最后一次保存**之前两秒**,
   加载的还是旧模块 —— 刀收紧后第一次真咬,咬到的正是「改了没重启」。
   这是「改了没编译 / 加了没进库」的第三形态,同族一并管住:
   比较 4310 进程启动时刻与 apps/api/*.mjs 的最大 mtime,旧进程**出声红**,不是跳过。 */
/* 沙箱数据目录与库文件路径的**唯一出口** —— 各套件不许再各写一条硬路径。 */
export const SANDBOX_DATA_DIR = process.env.SANDBOX_DATA_DIR || 'sandbox-data'
/* 🔴 相对路径要相对 **`apps/api`**,不是相对 `process.cwd()` ——
   整轮回归里 cwd 是 `apps/api`,可单独跑一把刀时 cwd 常是仓根,
   拿 cwd 拼出来的路径当场打不开(`test-demo-mark` 单跑现场炸过,就是我这一版写的)。
   锚在**本文件所在目录**上,cwd 是什么都不影响。 */
export const SANDBOX_DB_PATH = (() => {
  if(process.env.TEST_SANDBOX_URL){if(!process.env.TEST_DB_PATH)throw Error('隔离目标必须给 TEST_DB_PATH');return process.env.TEST_DB_PATH}
  const here = new URL('.', import.meta.url).pathname
  const dir = SANDBOX_DATA_DIR.startsWith('/') ? SANDBOX_DATA_DIR : `${here}${SANDBOX_DATA_DIR}`
  return `${dir.replace(/\/+$/, '')}/lucky-luxe.sqlite`
})()

async function assertServerNewerThanSource(label) {
  const { execFileSync } = await import('node:child_process')
  const { readdirSync, statSync } = await import('node:fs')
  let started = 0
  let pidSeen = ''
  try {
    /* 🔴 03t 查实的**判据自身缺陷**(J 族):原来是 `lsof -ti :4310`,不带 `-sTCP:LISTEN` ——
       而 `lsof -i :端口` 把**客户端连接**也算进去。现测:第一个返回的是 `wechatwebdevtools`
       的一条 **CLOSED** 客户端连接(pid 59534),真正 LISTEN 的 node 排在后面;
       代码取 `[0]`,于是它一直拿**微信开发者工具的启动时刻**当"沙箱启动时刻"去比源码。
       后果两面都有:
       · 误红 —— 工具开得早,永远"起于源码之前",mp-overlap / mp-home-sections 连着几轮被判 0 断言;
       · 误绿 —— 哪天某个客户端进程比源码新,它就放行一个真正过期的沙箱。
       **判据不确定比判据错更糟**:同一份代码单跑绿、整轮红,人只会去怀疑产品。
       只认监听者。 */
    const pids = execFileSync('lsof', ['-ti', ':'+new URL(SANDBOX_URL).port, '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    const pid = pids[0]
    if (!pid) return true
    pidSeen = pids.length > 1 ? `${pid}(另有 ${pids.length - 1} 个监听者)` : pid
    const lstart = execFileSync('ps', ['-o', 'lstart=', '-p', pid], { encoding: 'utf8' }).trim()
    started = new Date(lstart).getTime()
  } catch { return true }                       // 拿不到就不拦(如实不判,不假装通过)
  if (!started) return true
  let newest = 0
  let newestFile = ''
  for (const f of readdirSync(fileURLToPath(new URL('.',import.meta.url)))) {
    if (!f.endsWith('.mjs')) continue
    /* 🔴 03u:原来把 **测试文件也算进源码** —— 改一把刀就说"沙箱过期",要重起一次才能跑。
       但 `test-*.mjs` / `run-*.mjs` **不在服务加载的模块图里**,服务加载的是不是旧的与它们无关。
       判据要认的是「**服务代码**变了没有」,不是「这个目录里任何文件动过没有」。
       (与前一处 lsof 读到浏览器进程同族:比之前先问清楚,比的到底是不是那个东西。) */
    if (f.startsWith('test-') || f.startsWith('run-')) continue
    try {
      const m = statSync(new URL(f,import.meta.url)).mtimeMs
      if (m > newest) { newest = m; newestFile = f }
    } catch { /* 读不到就跳过这一个 */ }
  }
  if (newest > started) {
    const gap = Math.round((newest - started) / 1000)
    console.log(`🔴 ${label} 沙箱进程起于源码**之前** ${gap} 秒 —— 它加载的是旧模块,`
      + '现在跑出来的绿是假的(「改了没重启」= 改了没编译 / 加了没进库 的第三形态)。')
    /* 🔴 03r:这把刀在整轮回归里红、单跑却 4/4 绿 —— 而它只报一个「差 N 秒」,
       说不出是**哪个进程**、**哪个文件**,人就只能猜。判据红的时候必须能指认现场。 */
    console.log(`   现场:4310 pid=${pidSeen} 起于 ${new Date(started).toISOString()}`
      + ` · 最新源码 ${newestFile} 改于 ${new Date(newest).toISOString()}`)
    console.log('   处置:用自己的独立测试进程重新启动；不停止其他正在运行的服务')
    return false
  }
  return true
}

export async function ensureSandbox({ label = '' } = {}) {
  if(process.env.TEST_SANDBOX_URL){
    const u=new URL(SANDBOX_URL)
    if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('隔离验收只允许本机地址')
    const {assertTestTarget}=await import('./test-guard.mjs');await assertTestTarget(SANDBOX_URL)
    const health=await fetch(SANDBOX_URL+'/health').then(r=>r.json())
    const {realpathSync}=await import('node:fs')
    if(realpathSync(health.dataFile)!==realpathSync(SANDBOX_DB_PATH))throw Error('API 与测试直读数据库不一致')
    const fresh=await assertServerNewerThanSource(label)
    return {ok:fresh,started:false,stale:!fresh}
  }
  const up = async () => fetch('http://127.0.0.1:4310/health').then((r) => r.ok).catch(() => false)
  if (await up()) {
    const fresh = await assertServerNewerThanSource(label)
    return { ok: fresh, started: false, stale: !fresh }
  }
  const { spawn } = await import('node:child_process')
  /* 🔴 夜15 (丙):沙箱位置做成可配 —— CI 上要把它指到**临时目录**(而且那个目录名以
     `sandbox-data` 收尾,这样种子自带的「只许沙箱」护栏一个字都不用改)。
     日常不设这个变量,行为与以前**完全一样**。 */
  spawn('bash', ['start-sandbox.sh', SANDBOX_DATA_DIR], { cwd: process.cwd(), detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 2000))
    if (await up()) return { ok: true, started: true }
  }
  console.log(`⚠️  ${label} 沙箱 4310 拉不起来 —— **这一刀本轮未跑**`)
  return { ok: false, started: false }
}
