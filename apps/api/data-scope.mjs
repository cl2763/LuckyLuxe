/* 这台服务往哪个库写 —— **按库文件的绝对路径判**,不按环境变量的一句话(店主 06a §四)
 *
 * ══ 立件经过(先把我自己说错的那句更正掉)══
 * 我在 05z 待裁 #28 写「4310 的 dataScope 是 live,套件护栏拦不住它」——**这句话是错的**。
 * `assertTestTarget` 要求 `dataScope === 'test'` 才放行,`live` 是**拒绝**那一档:
 * 现测(只调护栏本身,没跑任何会写库的套件):对 4128 与 4310 各调一次,**两台都被当场拒绝**。
 * 店主据此把它提到 P0 并说「4128 也是 live,护栏对最不能碰的库同样失效」——
 * 前半句(两台都是 live)属实,后半句不成立:**live 正是拦下来的那一档。**
 *
 * ══ 但她指出的三件事仍然成立,这一件就是来收它们的 ══
 * ① `dataScope` 只有 test / live 两档,**分不出本机库 / 沙箱库 / 生产库**;
 * ② 护栏信的是**服务自己报的一个字符串**,不是库文件在哪;
 * ③ 只要谁在店主那台服务上设了 `LL_TEST_DATA=1`,那道门就开了 —— 一个环境变量顶掉了全部保护。
 *
 * 所以这里给两样东西:
 * · `scopeOf(dataDir)` → 细分名字:`ci` / `sandbox` / `local` / `production`(按路径判,不看环境变量);
 * · `isCiDataDir(dir)` → 只有回归临时库那一种目录才是真的可写测试库。
 *   `LL_TEST_DATA=1` 仍然保留(有人手工建临时库跑),但**它只能把 ci 认出来,不能把 local/sandbox 变成可写**。
 */
import { basename, resolve } from 'node:path'

/** 回归临时库:`/tmp/ll-ci-data.XXXXXX` 这一种(run-all-tests.sh 建的) */
export function isCiDataDir(dataDir) {
  return /^ll-ci-data\./.test(basename(resolve(String(dataDir || ''))))
}

/** 细分名字 —— 报数、护栏、预检都用这一个出口(一件事一处真相) */
export function scopeOf(dataDir, env = process.env) {
  const dir = resolve(String(dataDir || ''))
  if (env.NODE_ENV === 'production' || env.RAILWAY_ENVIRONMENT) return 'production'
  if (isCiDataDir(dir)) return 'ci'
  if (/[/\\]sandbox-data$/.test(dir)) return 'sandbox'
  if (/[/\\]local-data$/.test(dir)) return 'local'
  return 'unknown'
}

/** 老口径(test / live)—— 护栏与 D72 建店 kind 还在用,保持语义不变:
 *  只有 ci 才是 test;`LL_TEST_DATA=1` 只在**目录本身不是本机库/沙箱库**时才认(堵住那个口子)。 */
export function legacyScope(dataDir, env = process.env) {
  const name = scopeOf(dataDir, env)
  if (name === 'ci') return 'test'
  if (env.LL_TEST_DATA === '1' && name === 'unknown') return 'test'
  return 'live'
}
