/* 12a 第一步 · 输入归一化(店主 12a §5 + §6,2026-09-23)
 *
 * 样片是 iPhone 实况照:41 张里 40 张 HEIC。方舟吃不了 HEIC,而且:
 *   · EXIF 方向不转正的话,送进去的是躺倒的图,模型会照着躺倒的构图改;
 *   · 长边 4032 超档位,按像素计费会更贵;
 *   · 🔴 **个别图带下巴/头发边缘** —— 令里写死「归一化时顺手把手部以上裁掉,对比包里不许出现脸」。
 *
 * 裁法(保守):**从顶部裁掉固定比例**。
 *   店内实拍的构图几乎都是「人在上、手在下」,脸只会从顶边进来。
 *   这里按顶部 18% 裁 —— 宁可多裁一点背景,也不许漏一张脸。
 *   🔴 裁完**逐张记下裁了多少**,谁都能复查(不是「我裁过了」一句话)。
 *
 * 用 macOS 自带的 `sips`:不装任何依赖(12a §3「与主线零依赖」)。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

const SRC = process.argv[2]
const OUT = process.argv[3]
if (!SRC || !OUT) {
  console.error('用法:node normalize.mjs <样片目录> <输出目录>')
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

const TOP_CROP = 0.18        // 顶部裁掉的比例 —— 脸只会从顶边进来
const MAX_EDGE = 4096
const PY = '/opt/anaconda3/bin/python3'
const sips = (...a) => execFileSync('/usr/bin/sips', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const dimsOf = (f) => {
  const o = sips('-g', 'pixelWidth', '-g', 'pixelHeight', f)
  return { w: Number(/pixelWidth:\s*(\d+)/.exec(o)?.[1]), h: Number(/pixelHeight:\s*(\d+)/.exec(o)?.[1]) }
}

const files = readdirSync(SRC)
  .filter((f) => /\.(heic|jpe?g|png)$/i.test(f))
  .filter((f) => !f.startsWith('.'))
  .sort()
console.log(`源目录 ${files.length} 张(.MOV 已按令忽略)`)

const rows = []
for (const [i, f] of files.entries()) {
  const src = join(SRC, f)
  const stem = String(i + 1).padStart(2, '0') + '_' + basename(f, extname(f)).replace(/[^\w一-龥-]/g, '')
  const dst = join(OUT, `${stem}.jpg`)
  try {
    /* ① 转 JPG + 按 EXIF 方向转正(sips 写出时自动应用方向并清掉标记) */
    sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '92', src, '--out', dst)
    const d0 = dimsOf(dst)
    /* ② 🔴 顶部裁掉。
       第一版我用 `sips -c H W --cropOffset Y X` —— **那个组合根本没生效**:
       41 张里 36 张出来还是原始 2268×4032,而我的清单却写着「裁掉 725px」。
       **是拼图看出来的:右上和右下两张,头发和下巴已经进画面了** —— 而令里写死「不许出现脸」。
       (我那条「裁了」的记录是假的 —— 日志说做了,像素说没做。)
       改用 Pillow 的 `crop`,它的语义是明确的四元组,没有「偏移量往哪个方向算」的歧义。 */
    execFileSync(PY, ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
keep = round(h * (1 - ${TOP_CROP}))
im.crop((0, h - keep, w, h)).save(sys.argv[2], 'JPEG', quality=92)
`, dst, dst], { encoding: 'utf8' })
    const d1 = dimsOf(dst)
    /* 🔴 **验它真的裁了** —— 不信自己刚写的那行日志,量像素(判据律:能验渲染结果就别验中间产物) */
    if (d1.h >= d0.h) throw new Error(`顶部裁没生效:${d0.h} → ${d1.h}`)
    /* ③ 长边上限 */
    if (Math.max(d1.w, d1.h) > MAX_EDGE) sips('-Z', String(MAX_EDGE), dst, '--out', dst)
    const d2 = dimsOf(dst)
    rows.push({ 序号: i + 1, 原文件: f, 归一化后: `${stem}.jpg`, 原尺寸: `${d0.w}×${d0.h}`,
      裁掉顶部: `${d0.h - d1.h}px(${Math.round(TOP_CROP * 100)}%)`, 终尺寸: `${d2.w}×${d2.h}`,
      字节: statSync(dst).size })
    process.stdout.write(`\r  ${i + 1}/${files.length}`)
  } catch (e) {
    /* 🔴 `sips` 处理不了 **MPO**(多帧 JPEG —— iPhone 实况照的主帧+副帧就是这个格式)。
       41 张里有 1 张是 MPO,`sips` 读它的 pixelWidth 直接返回 <nil>。
       **不跳过**:换 Pillow 走同一条归一化(转正 → 顶部裁 → 长边上限),口径一个字不差。
       (查清楚才知道文件是好的 —— 2268×4032 的正常照片,只是容器格式不同。) */
    try {
      execFileSync(PY, ['-c', `
import sys
from PIL import Image, ImageOps
im = Image.open(sys.argv[1])
im.seek(0)                      # MPO:只取主帧
im = ImageOps.exif_transpose(im).convert('RGB')
w, h = im.size
keep = round(h * (1 - ${TOP_CROP}))
im = im.crop((0, h - keep, w, h))
if max(im.size) > ${MAX_EDGE}:
    r = ${MAX_EDGE} / max(im.size)
    im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
im.save(sys.argv[2], 'JPEG', quality=92)
print(f'{w}x{h} -> {im.width}x{im.height}')
      `, src, dst], { encoding: 'utf8' })
      const d = dimsOf(dst)
      rows.push({ 序号: i + 1, 原文件: f, 归一化后: `${stem}.jpg`, 原尺寸: '(MPO,sips 读不出)',
        裁掉顶部: `${Math.round(TOP_CROP * 100)}%`, 终尺寸: `${d.w}×${d.h}`,
        字节: statSync(dst).size, 备注: 'MPO 多帧 JPEG,改走 Pillow 取主帧' })
      process.stdout.write(`\r  ${i + 1}/${files.length}(MPO 兜底)`)
    } catch (e2) {
      rows.push({ 序号: i + 1, 原文件: f, 归一化后: '🔴 失败', 错误: String(e2.message).slice(0, 120) })
    }
  }
}
console.log('')
const ok = rows.filter((r) => r.归一化后 !== '🔴 失败')
console.log(`归一化完成:${ok.length}/${files.length} 成功`)
writeFileSync(join(OUT, '_归一化清单.json'), JSON.stringify(rows, null, 2))
console.log(`清单:${join(OUT, '_归一化清单.json')}`)
