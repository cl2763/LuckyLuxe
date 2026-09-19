/* 「这一套要一台活沙箱」的唯一出口(店主 09x §一 批 (乙))
 *
 * ══ 立件 ══
 * 三套主档判据(`correction-reason` · `tenant-ownership` · `tier-label`)的行为层
 * **只打沙箱 4310**(店主 03e 结构闸:账本现测对本机库 4128 关门),
 * `tenant-ownership` 还直接开 `apps/api/sandbox-data/lucky-luxe.sqlite` 造景。
 * 🔴 **CI 上没有沙箱** ⇒ 造不出阳性 ⇒ 它们如实判红(J-58①:造不出阳性就不许说验过)。
 * **判据没错,错的是它站的位置** —— 一条要沙箱才验得成的判据,站在任何新机器都跑得到的主档里。
 *
 * ══ 裁 ══
 * 店主 09x:批 (乙) —— **拿不到夹具时说「未跑」,不说「红」**,并绑三条:
 *   ① 未跑必须**被计数、被逐名点出**;② 设**只许降的上限**(今天 3);
 *   ③ **本机全量这 3 套仍必须真跑、真绿**。
 * 🔴 **这不是松判据**:它把「验过」改成「没验」,是把话说得更准,不是更松。
 *
 * ══ 代价,明写 ══
 * 走这条路的套件在没有沙箱的机器上**整套不跑**(连静态层也不跑)——
 * 因为断言基线按套计数,半跑会变成「悄悄少几条」,那比不跑更坏。
 * 🔴 **这是一笔明写的覆盖面欠账,欠账人是 (丙)「让 CI 起一台沙箱」,排推后第一件。**
 * **(丙) 落地那天,未跑上限从 3 降到 0,这件事才算结案。**
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
/* 🔴 端口做成可覆盖 —— **硬写死的端口没法造病**(预检那把刀 09m 现场学的同一条)。
   日常一个字都不用改;造病时把它指到一个死端口,就能验「拿不到沙箱会不会真的报未跑」。 */
export const SANDBOX_URL = process.env.SANDBOX_PROBE_URL || 'http://127.0.0.1:4310'
export const SANDBOX_DB = join(ROOT, 'apps/api/sandbox-data/lucky-luxe.sqlite')

/** 退出码 77 = **本轮未跑**(拿不到夹具)。`run-all-tests.sh` 认这个码:
 *  不写 TALLY、写进 not-run 名单、末尾逐名点出并对上限棘轮。 */
export const EXIT_NOT_RUN = 77

/**
 * 没有活沙箱就**当场以 77 退出**,并打一行 `[未跑] …` 说清缺什么。
 * @param {{ needDb?: boolean, why?: string }} o `needDb` = 这一套还要直接开沙箱库文件
 */
export async function requireSandboxOrSkip({ needDb = false, why = '' } = {}) {
  const missing = []
  /* ① 服务活着吗 —— 认的是「/health 答得出 ok」,不是「端口有人应答」(J-37③) */
  let alive = false
  try {
    const r = await fetch(`${SANDBOX_URL}/health`, { signal: AbortSignal.timeout(3000) })
    alive = r.ok && Boolean((await r.json().catch(() => ({}))).ok)
  } catch { alive = false }
  if (!alive) missing.push(`沙箱服务 ${SANDBOX_URL} 不在`)
  /* ② 要开库文件的,库文件也得在 */
  if (needDb && !existsSync(SANDBOX_DB)) missing.push(`沙箱库文件 ${SANDBOX_DB.replace(ROOT, '.')} 不在`)

  if (!missing.length) return true

  /* 🔴 措辞要分得开三件事:**没验成 ≠ 没守住 ≠ 通过**。这一行说的是第一件。 */
  console.log(`[未跑] ${missing.join(' · ')}${why ? ` —— ${why}` : ''}`)
  console.log('        这一套的行为层**只打沙箱**(03e 结构闸),拿不到沙箱就造不出阳性;')
  console.log('        按 J-58① **不许当通过**,按店主 09x (乙) **报「未跑」不报「红」**,')
  console.log('        并由 run-all-tests.sh 计数 + 逐名 + 对上限棘轮(今天 3,(丙) 落地后降到 0)。')
  process.exit(EXIT_NOT_RUN)
}
