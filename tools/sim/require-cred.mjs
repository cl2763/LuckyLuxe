/* 凭据入参 · 唯一出口(D123,店主 03g 裁定一,2026-09-02)

   案由:一枚**活的**会话令牌硬编码在 tools/sim/ 八个文件里,并随 6 次提交进了历史;
   仓库在 GitHub 上未授权即可读。定性是**纪律事故不是泄露事故**(它只对本机库 4128 有效),
   但「凭据不入库」是硬律 —— **看形态不看后果**。

   与 tools/db-target.mjs 同一个姿态:**不给就拒绝跑,不许有默认值**。
   凭据的默认值比目标库的默认值更糟:目标库写错只是打错地方,凭据写死是直接把它带进历史。 */
export function requireCred({ envName, value, what = '凭据' }) {
  if (!value) {
    console.error(`\n❌ 拒绝执行:没有提供${what}。\n`
      + `   **凭据不许写死在脚本里** —— 写死一次就随提交进历史,历史删不掉。\n`
      + `   请用环境变量传入:${envName}=... node <脚本>\n`
      + `   本机取法:启动日志里的 Owner API token,或自己在后台登录一次拿会话。\n`)
    process.exit(2)
  }
  return String(value)
}
