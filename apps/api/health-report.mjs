/* `/health` 那一份自报(从 `local-server.mjs` 搬出;公约②边改边拆:D151 往这里加了两格)

   这一页不是「活没活着」那么简单 —— 它是**判据的读口**。好几条护栏靠它取事实:
   · `dataScope`  —— 测试护栏问「这台服务往哪个库写」,不是 'test' 就拒跑(店主 08-24 裁 C);
   · `dataScopeName` —— 细分:ci / sandbox / local / production(06a §四:三个库不许都叫 live);
   · `dataFile`   —— 《写库自报律》的「路径」那一格(只对回环下发;线上 /health 是公开的);
   · `tenantFallback` —— 顾客侧「没带租户/带了无效租户」被拒的次数,回归要求全 0;
   · `adminBuild` / `version` —— 三端指纹,排「你测的和她用的是不是同一份」;
   · `snapshotRaster` —— 生产装没装栅格化后端,空=真机快照会白;
   · `mergeWindowSeconds` / `mergeWindowCapSeconds` / `mergeWindowsOpen`(D151 + 05r 补五 §三)
     —— 窗多长、封顶几秒、这会儿有几个人正被等着;三个都报,判据与店主都不用猜;
   · `guestIdUnsigned` —— **现测**(夜9 段1 按 J-52 改):这个进程**还接不接受「非服务端签发」的顾客身份**。
     它以前是一个**写死的 `true`** —— 而上线清单第 4 行那条 🔴 硬门槛正是读这一格,
     也就是说**那条红从来没有量过任何东西**。夜 9 段 0 逐条查完三条身份路(结论见
     `handoff/night-runs/访客身份串_现查结论_2026-09-12.md`):
       · 小程序/微信:`mini.<payload>.<sig>`,HMAC 签名 + 验签 + 过期 + openid 对得上 —— **服务端签发**;
       · 网页顾客端:只发 `x-tenant-id` + `Bearer`,**没有任何客户端自造串**;
       · 唯一不签名的那条是演示令牌 `demo-<scope>:<邮箱>`,它**只在 `DEMO_LOGIN_ALLOWED` 下可达**。
     所以这一格 = `demoLoginAllowed` 本身 —— **同一处真相,不在这里另抄一份判断**。

   所以这里**只出事实,不出配置值与密钥**。 */
import { join } from 'node:path'

const LOOPBACK = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/

export function healthReport(req, deps) {
  const {
    rasterBackend, tenantFallbackTally, getAiUsage, mergeWindowSeconds, mergeWindowCapSeconds, openMergeWindows,
    dataDir, dbConcurrency, replyLength, appVersion, tenantNullRows, dataScope, dataScopeName, iso,
    demoLoginAllowed,
    miniSecretExplicit,
  } = deps
  /* 🔴 J-52:读口里每一格都必须是量出来的。**取不到就报 null,不许兜成 true/false** ——
     兜一个默认值等于又变回写死的常量(静默失败器族)。null 的意思是「这一格没量到」,
     判据看见 null 要报「没量成」,不许当事实用。 */
  const guestIdUnsigned = typeof demoLoginAllowed === 'boolean' ? demoLoginAllowed : null
  /* J-53(07c 裁 #54):顾客令牌签名密钥**是不是显式配的**。同样是量出来的,取不到报 null。
     ⚠️ 只回 boolean —— 密钥本身、连它的长度都不许出现在任何输出里。 */
  const miniSecretSet = typeof miniSecretExplicit === 'boolean' ? miniSecretExplicit : null
  return {
    ok: true,
    service: 'lucky-luxe-api-local',
    commit: String(process.env.RAILWAY_GIT_COMMIT_SHA || 'local').slice(0, 7),
    snapshotRaster: rasterBackend() || 'none',
    tenantFallback: { ...tenantFallbackTally },
    aiUsage: getAiUsage(),
    mergeWindowSeconds: mergeWindowSeconds(),
    mergeWindowCapSeconds: mergeWindowCapSeconds(),
    mergeWindowsOpen: openMergeWindows(),
    guestIdUnsigned,
    miniSecretSet,
    ...(LOOPBACK.test(String(req.socket?.remoteAddress || '')) ? { dataFile: join(dataDir, 'lucky-luxe.sqlite') } : {}),
    dbConcurrency,
    replyLength: replyLength.snapshot(),
    adminBuild: appVersion.servedAdminBuild(),
    version: appVersion.version(),
    tenantNullRows,
    dataScope,
    /* 🔴 06a §四:`dataScope` 只有 test/live 两档,**分不出本机库 / 沙箱库 / 生产库** ——
       三个都叫 live,店主一看就以为「护栏对三个都失效」(其实 live 是拒绝档)。
       所以再下发一个细分名 ci/sandbox/local/production,由 `data-scope.mjs` 按**库路径**算,
       预检据此断言「4128 与 4310 不许同名」。 */
    dataScopeName,
    time: iso(new Date()),
  }
}
