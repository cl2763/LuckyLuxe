/* 测试护栏(店主 2026-08-24 裁 C):**套件永远不许写进真库。**

   立这条的原因(查明结论):每个 test-*.mjs 的 BASE_URL 默认是 `http://127.0.0.1:4128` ——
   那正是**店主自己那台服务**的端口。全量回归脚本会先 pkill 掉它、再用临时库在同一端口起一台,
   所以走 run-all-tests.sh 是安全的;但**单独 `node apps/api/test-xxx.mjs`** 时,
   4128 上跑的是店主的真库,套件就直接往真账本里建店、开单、记收入。
   真库里 43 个测试租户(最早 2026-08-07)就是这么来的。

   判据律:这里问的是**服务器往哪个库写**(/health 的 dataScope,由服务端自己判定),
   不是问一个"记得设就设"的环境变量 —— 忘了设的时候,废判据照样绿,这条不会。 */
export async function assertTestTarget(baseUrl) {
  let health = null
  try {
    const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(4000) })
    health = await r.json()
  } catch (e) {
    console.error(`\n[测试护栏] 连不上 ${baseUrl} —— 先起测试服务再跑套件。\n  推荐:bash apps/api/run-all-tests.sh <套件名>\n`)
    process.exit(2)
  }
  if (health?.dataScope !== 'test') {
    console.error(`\n🔴 [测试护栏] 拒绝跑:${baseUrl} 连的是**非测试库**(dataScope=${health?.dataScope || '未知'})。`)
    console.error('   套件会建店/开单/记收入 —— 打在真库上就是往店主账本里掺假数据。')
    console.error('   正确跑法:bash apps/api/run-all-tests.sh [套件名]   (它会用临时库 /tmp/ll-ci-data.XXXX)')
    console.error('   要手工起测试服务:DATA_DIR=$(mktemp -d /tmp/ll-ci-data.XXXXXX) PORT=4128 node apps/api/local-server.mjs\n')
    process.exit(2)
  }
}
