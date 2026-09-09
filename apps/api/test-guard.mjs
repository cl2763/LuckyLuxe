/* 测试护栏(店主 2026-08-24 裁 C):**套件永远不许写进真库。**

   立这条的原因(查明结论):每个 test-*.mjs 的 BASE_URL 默认是 `http://127.0.0.1:4128` ——
   那正是**店主自己那台服务**的端口。全量回归脚本会先 pkill 掉它、再用临时库在同一端口起一台,
   所以走 run-all-tests.sh 是安全的;但**单独 `node apps/api/test-xxx.mjs`** 时,
   4128 上跑的是店主的真库,套件就直接往真账本里建店、开单、记收入。
   真库里 43 个测试租户(最早 2026-08-07)就是这么来的。

   判据律:这里问的是**服务器往哪个库写**(/health 的 dataScope,由服务端自己判定),
   不是问一个"记得设就设"的环境变量 —— 忘了设的时候,废判据照样绿,这条不会。 */
/** 「这台服务往测试库写吗」的**唯一判断**。
    给那种「静态那半还想跑、只想把打接口那半跳掉」的套件用(例:test-store-name):
    先问一句,不是测试库就明说「这几条本轮未跑」,而不是整刀 exit —— 也不是偷偷跑下去。
    判断口径与 `assertTestTarget` 同一处,不许两边各写一套(一件事一处真相)。 */
export async function isTestTarget(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(4000) })
    return (await r.json())?.dataScope === 'test'
  } catch { return false }
}

/* 🔴 06a §四 第 2 条(店主裁):**护栏改成认库不认名。**
   原来只看服务自报的 `dataScope` 字符串;现在**再看一眼库文件的绝对路径** ——
   只有回归临时库(`/tmp/ll-ci-data.XXXX`)那一种目录才允许被套件写。
   两道一起:字符串说 test、路径也得是 ci 库;任一不成立就拒绝,并**把库的绝对路径打出来**
   (店主原话:「护栏必须拦住并点名库的绝对路径」)。
   为什么要第二道:`LL_TEST_DATA=1` 一个环境变量就能把第一道打开,
   而那台服务可能正连着店主的本机库 —— 一个环境变量顶掉全部保护,这不行。 */
export async function assertTestTarget(baseUrl) {
  let health = null
  try {
    const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(4000) })
    health = await r.json()
  } catch (e) {
    console.error(`\n[测试护栏] 连不上 ${baseUrl} —— 先起测试服务再跑套件。\n  推荐:bash apps/api/run-all-tests.sh <套件名>\n`)
    process.exit(2)
  }
  const dataFile = String(health?.dataFile || '')
  const { isCiDataDir } = await import('./data-scope.mjs')
  const pathOk = dataFile ? isCiDataDir(dataFile.replace(/\/[^/]+$/, '')) : false
  if (health?.dataScope !== 'test' || !pathOk) {
    console.error(`\n🔴 [测试护栏] 拒绝跑:${baseUrl} 连的**不是回归临时库**。`)
    console.error(`   服务自报 dataScope=${health?.dataScope || '未知'} · dataScopeName=${health?.dataScopeName || '(老版本没这个字段)'}`)
    console.error(`   **它开的库(绝对路径)**:${dataFile || '(服务没下发库路径)'}`)
    console.error(`   路径判据:只有 /tmp/ll-ci-data.XXXX 那一种目录才许被套件写 —— 这一条${pathOk ? '过了' : '**没过**'}。`)
    console.error('   套件会建店/开单/记收入 —— 打在真库上就是往店主账本里掺假数据。')
    console.error('   正确跑法:bash apps/api/run-all-tests.sh [套件名]   (它会用临时库 /tmp/ll-ci-data.XXXX)')
    console.error('   要手工起测试服务:DATA_DIR=$(mktemp -d /tmp/ll-ci-data.XXXXXX) PORT=4128 node apps/api/local-server.mjs\n')
    process.exit(2)
  }
}
