/* 三端版本指纹(店主 04f §一.3)—— **三端同号才算同一版本**

   「你测的和她用的是不是同一份」过去只能猜:回归把服务 restore 成别的版本、
   浏览器拿着旧缓存、小程序没重编译 —— 三种长得一模一样。

   这里出 `{ build, commit, builtAt }`:
   · `build` = 这台服务**实发的** admin.html 指纹 —— **由服务自己算,不读手写常量**
     (2026-08-30 退回件②的教训:手写的那个我改了三轮 admin.js 它一个字没动);
   · `commit` = 部署的提交号;· `builtAt` = 这台服务起来的时刻。
   网页左下角读它、小程序「关于」页读它、后端自己出它 —— 一处对不上就知道谁的缓存旧了。 */
export function createAppVersion({ readFileSync, statSync, join, webRoot, fingerprintHtml }) {
  const bootAt = new Date().toISOString()
  function servedAdminBuild() {
    try {
      const m = /LL_BUILD="?([0-9a-f]+)"?/.exec(fingerprintHtml(readFileSync(join(webRoot, 'admin.html'), 'utf8'), { webRoot, statSync }))
      return m ? m[1] : 'none'
    } catch { return 'error' }
  }
  return {
    servedAdminBuild,
    version: () => ({
      build: servedAdminBuild(),
      commit: String(process.env.RAILWAY_GIT_COMMIT_SHA || 'local').slice(0, 7),
      builtAt: bootAt,
    }),
  }
}
