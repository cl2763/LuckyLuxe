/* 12a §1.3 · 甲面贴回 PoC(店主 11y §一.3:与第一轮并行,先做那张稳定翻车的)
 *
 * ══ 要回答的只有一个问题 ══
 * **拼接边自然不自然。** 不是「贴回好不好用」,是「看不看得出来」。
 *
 * ══ 为什么值得做 ══
 * A 模型在同一张图上**两次都给甲尖加了原图没有的银色亮片**,
 * 而 prompt 里【绝对不改】清单白纸黑字写着「图案…与原图完全一致」。
 * ⇒ **靠 prompt 保不住甲面**。贴回就是:让模型只管光和肤色,甲面像素**原样搬回来**。
 *
 * ══ mask 怎么取(12a 说「rembg 或任意可用的分割」)══
 * 本机没有 rembg / opencv,而 12a §3 要「与主线零依赖」——
 * 🔴 这里**不引入分割模型**,用一个更笨但更可控的办法:
 *   甲面在修图前后**位置几乎不变**(位置变了那张本来就该判 ①b 翻车),
 *   所以拿**原图与结果图的差异**找不出甲面;要找甲面得用**原图自身的特征**。
 *   甲面 = 高饱和/高光泽/边界清晰的连通块。本 PoC 用「原图与结果图的**局部差异图**」
 *   反过来定位模型改动最大的区域,再把那些区域用**原图像素**盖回去。
 * ⚠️ 这不是产品级分割 —— 它回答的正是 PoC 那一问:**边能不能看**。
 *   真做进产品要用真分割(12b 再说),这里只出证据。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [, , ORIG, GEN, OUTDIR, TAG] = process.argv
if (!ORIG || !GEN || !OUTDIR) { console.error('用法:node nail-paste-back.mjs <原图> <模型出图> <输出目录> [标签]'); process.exit(2) }
mkdirSync(OUTDIR, { recursive: true })
const PY = '/opt/anaconda3/bin/python3'

const script = `
import sys, numpy as np
from PIL import Image, ImageFilter
from skimage.filters import threshold_otsu
from skimage.morphology import binary_closing, binary_opening, disk, remove_small_objects

orig_p, gen_p, out_dir, tag = sys.argv[1:5]
orig = Image.open(orig_p).convert('RGB')
gen  = Image.open(gen_p).convert('RGB')
# 模型出图比原图小(B 的面积上限所致)——先对齐到原图尺寸再比
gen_r = gen.resize(orig.size, Image.LANCZOS)

a = np.asarray(orig, dtype=np.float32)
b = np.asarray(gen_r, dtype=np.float32)
diff = np.abs(a - b).mean(axis=2)                     # 逐像素改动量
diff_s = np.asarray(Image.fromarray(diff.astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), dtype=np.float32)

# 改动最大的那一档 = 模型动得最多的地方(亮片就加在这里)
thr = max(threshold_otsu(diff_s), float(np.percentile(diff_s, 92)))
m = diff_s > thr
m = binary_closing(m, disk(7))
m = binary_opening(m, disk(3))
m = remove_small_objects(m, min_size=int(0.00015 * m.size))
cover = m.mean()

# 羽化边缘再贴 —— 硬边一定看得出来,PoC 要回答的就是这个
mask_img = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))
mask_np = np.asarray(mask_img, dtype=np.float32)[..., None] / 255.0
pasted = (a * mask_np + b * (1 - mask_np)).astype(np.uint8)
Image.fromarray(pasted).save(f'{out_dir}/{tag}_贴回.jpg', 'JPEG', quality=95)
Image.fromarray((m*255).astype(np.uint8)).save(f'{out_dir}/{tag}_mask.png')

# 三联:原图 | 模型出图 | 贴回
tw = 560
ims = [orig, gen_r, Image.fromarray(pasted)]
ims = [im.resize((tw, round(im.height*tw/im.width)), Image.LANCZOS) for im in ims]
h = max(i.height for i in ims)
sheet = Image.new('RGB', (tw*3, h), 'white')
for i, im in enumerate(ims): sheet.paste(im, (i*tw, 0))
sheet.save(f'{out_dir}/{tag}_三联_原_模型_贴回.jpg', 'JPEG', quality=92)
print(f'  {tag}: 贴回覆盖 {cover*100:.1f}% 画面 · 阈值 {thr:.1f} · 三联已出')
`
console.log(execFileSync(PY, ['-c', script, ORIG, GEN, OUTDIR, TAG || 'poc'], { encoding: 'utf8' }).trim())
