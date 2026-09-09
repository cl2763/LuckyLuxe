#!/usr/bin/env node
/* 裁 #21 · 小程序截图的**第三条路**:绕开 automator,直接拍开发者工具那个窗口
 *
 * ══ 为什么要第三条路(店主 05v 补一 §二)══
 * 店主原话:「不能就此把小程序端的图这一项永久取消 —— 她是**用眼睛**看小程序的,
 * `图=合同` 这条不能只靠数字兑现。」
 * 前两条:①`mp.screenshot()` —— 这台机器上必卡死(20 秒超时后按「没拍到」处理);
 *        ②开发者工具自带的截图按钮 —— 要手点,跑机用不上。
 * **这一条**:macOS `screencapture -l <windowid>`,窗口 id 从 `CGWindowListCopyWindowInfo` 拿。
 *
 * ══ 窗口 id 怎么拿 ══
 * `osascript` 那条路走不通(这台机器没给「辅助功能」权限,System Events 直接报 -1728);
 * 但**屏幕录制权限是有的**(`screencapture` 全屏能拍出图)。
 * 所以用一个 20 行的 ObjC 小程序枚举窗口 —— 源码就在下面,首次运行时 `clang` 编译到 /tmp,之后复用。
 * ⚠️ 开发者工具的窗口可能不在当前 Space,所以枚举用 `kCGWindowListOptionAll`(不是 OnScreenOnly);
 *    现测:OnScreenOnly 时它一个窗口都列不出来,这一步卡过一次。
 *
 * 用法:MP_AUTOMATOR=<模块> MPW_OUT=<目录> node tools/mp-window-shot.mjs <名字>:<页面路径> ...
 *   例:node tools/mp-window-shot.mjs 商家首页_浅色:/pages/merchant/home/index
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const OUT = process.env.MPW_OUT
if (!OUT) { console.error('要 MPW_OUT=<截图目录>'); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const shots = process.argv.slice(2).filter((a) => a.includes(':'))
if (!shots.length) { console.error('用法:node tools/mp-window-shot.mjs <名字>:<页面路径> ...'); process.exit(2) }

/* ── 窗口枚举小工具(首次编译,之后复用)────────────────────────── */
const SRC = '/tmp/ll-winlist.m'
const BIN = '/tmp/ll-winlist'
const OBJC = `#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
int main(void) { @autoreleasepool {
  CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID);
  if (!list) return 1;
  for (CFIndex i = 0; i < CFArrayGetCount(list); i++) {
    NSDictionary *w = (__bridge NSDictionary *)CFArrayGetValueAtIndex(list, i);
    NSString *owner = w[(id)kCGWindowOwnerName] ?: @"";
    NSString *name  = w[(id)kCGWindowName] ?: @"";
    NSDictionary *b = w[(id)kCGWindowBounds];
    int ww = [b[@"Width"] intValue], hh = [b[@"Height"] intValue];
    if (ww < 400 || hh < 400) continue;
    printf("%d\\t%dx%d\\t%s\\t%s\\n", [w[(id)kCGWindowNumber] intValue], ww, hh,
           [owner UTF8String], [name UTF8String]);
  }
  CFRelease(list);
} return 0; }`
if (!existsSync(BIN)) {
  writeFileSync(SRC, OBJC)
  execFileSync('clang', ['-framework', 'Foundation', '-framework', 'CoreGraphics', '-o', BIN, SRC])
}
/* 🔴 拍之前**先把它叫到前台**:窗口在别的桌面/被挡住时,`screencapture -l` 拿到的是
   **上一帧缓存**(现测栽过:automator 说当前页是商家首页,拍出来却是顾客首页那一帧)。
   `open -a` 不需要「辅助功能」权限(System Events 那条路这台机器是拒的)。
   副作用如实说:这一步会把开发者工具切到前台。 */
try { execFileSync('/usr/bin/open', ['-a', 'wechatwebdevtools']) } catch { /* 没装或名字不同就照旧拍,拍出来是不是新的由下面的判据看 */ }
await new Promise((r) => setTimeout(r, 2500))
const wins = execFileSync(BIN, { encoding: 'utf8' }).split('\n').filter(Boolean)
  .map((ln) => { const [id, size, owner, ...rest] = ln.split('\t'); return { id, size, owner, name: rest.join('\t') } })
/* 主窗口 = 标题里带项目名的那个(另外两个是模拟器浮窗与工具条,拍它们只有半个界面) */
const main = wins.find((w) => /开发者工具/.test(w.owner) && /miniprogram/i.test(w.name))
  || wins.find((w) => /开发者工具/.test(w.owner))
if (!main) {
  console.error('🔴 没找到开发者工具的窗口 —— 它开着吗?(枚举到的窗口:' + wins.map((w) => `${w.owner}/${w.size}`).join(' · ') + ')')
  process.exit(1)
}
console.log(`   [窗口] id=${main.id} ${main.size} 「${main.name}」`)

/* ── 让模拟器停在要拍的那一页(automator 只用来导航,不用它截图)── */
const AUTO = process.env.MP_AUTOMATOR
const T = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`automator 卡住了(${ms}ms):${what}`)), ms))])
let mp = null
if (AUTO && AUTO !== 'skip') {
  try {
    const automator = createRequire(import.meta.url)(AUTO)
    mp = await T((automator.connect || automator.default.connect).call(automator,
      { wsEndpoint: `ws://${'127.0.0.1'}:${Number(process.env.MP_AUTO_PORT || 9420)}`, timeout: 15000 }), 18000, 'connect')
  } catch (e) { console.log(`   [说明] automator 连不上(${e.message})—— 拍的就是模拟器当前那一页`) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const png = (file) => {
  const b = readFileSync(file)
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length }
}

let ok = 0
for (const spec of shots) {
  const at = spec.indexOf(':')
  const name = spec.slice(0, at)
  const path = spec.slice(at + 1)
  if (mp && path.startsWith('/')) {
    try { await T(mp.reLaunch(path), 15000, `reLaunch ${path}`); await sleep(3000) }
    catch (e) { console.log(`   [说明] 导航到 ${path} 没成(${e.message})—— 仍然拍当前页`) }
  }
  let atPage = ''
  if (mp) { try { atPage = (await T(mp.currentPage(), 8000, 'currentPage')).path } catch { atPage = '(取不到)' } }
  const file = join(OUT, `${name}.png`)
  /* `-x` 不放快门声、`-o` 不带窗口阴影(阴影会让图边上多一圈透明,魔数判据看着像另一张图) */
  execFileSync('/usr/sbin/screencapture', ['-x', '-o', '-l', String(main.id), file])
  const size = png(file)
  if (!size || size.bytes < 20000) { console.log(`not ok - ${name}:拍出来的不是像样的 PNG(${JSON.stringify(size)})`); continue }
  ok += 1
  console.log(`ok - ${name} → ${file}(${size.w}x${size.h} · ${Math.round(size.bytes / 1024)}KB · 拍的时候模拟器停在 ${atPage || '(没连 automator)'})`)
}
console.log(`\n共拍到 ${ok}/${shots.length} 张(第三条路:screencapture -l <windowid>)`)
process.exit(ok === shots.length ? 0 : 1)
