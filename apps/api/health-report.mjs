/* `/health` 那一份自报(从 `local-server.mjs` 搬出;公约②边改边拆:D151 往这里加了两格)

   这一页不是「活没活着」那么简单 —— 它是**判据的读口**。好几条护栏靠它取事实:
   · `dataScope`  —— 测试护栏问「这台服务往哪个库写」,不是 'test' 就拒跑(店主 08-24 裁 C);
   · `dataFile`   —— 《写库自报律》的「路径」那一格(只对回环下发;线上 /health 是公开的);
   · `tenantFallback` —— 顾客侧「没带租户/带了无效租户」被拒的次数,回归要求全 0;
   · `adminBuild` / `version` —— 三端指纹,排「你测的和她用的是不是同一份」;
   · `snapshotRaster` —— 生产装没装栅格化后端,空=真机快照会白;
   · `mergeWindowSeconds` / `mergeWindowCapSeconds` / `mergeWindowsOpen`(D151 + 05r 补五 §三)
     —— 窗多长、封顶几秒、这会儿有几个人正被等着;三个都报,判据与店主都不用猜;
   · `guestIdUnsigned` —— 上线批占位:访客身份串现在是客户端自己生成的,
     上生产前要改成服务端签发,那条判据看它变 false。

   所以这里**只出事实,不出配置值与密钥**。 */
import { join } from 'node:path'

const LOOPBACK = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/

export function healthReport(req, deps) {
  const {
    rasterBackend, tenantFallbackTally, getAiUsage, mergeWindowSeconds, mergeWindowCapSeconds, openMergeWindows,
    dataDir, dbConcurrency, replyLength, appVersion, tenantNullRows, dataScope, iso,
  } = deps
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
    guestIdUnsigned: true,
    ...(LOOPBACK.test(String(req.socket?.remoteAddress || '')) ? { dataFile: join(dataDir, 'lucky-luxe.sqlite') } : {}),
    dbConcurrency,
    replyLength: replyLength.snapshot(),
    adminBuild: appVersion.servedAdminBuild(),
    version: appVersion.version(),
    tenantNullRows,
    dataScope,
    time: iso(new Date()),
  }
}
