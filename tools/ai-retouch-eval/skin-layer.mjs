/* 腿 B · 非生成式「皮肤层」(12e §二 腿B)—— ¥0,不经模型
 *
 * 店主要的是「手部质感 + 甲面细节质感」两样分开修。腿 A 靠口令,腿 B 靠后处理,**谁也不替谁**。
 *
 * 做法(§二 原样):
 *   基底 = 模型出图过 **亮度回贴全(LM-YC)** —— 原图的光和色 + 模型的细节
 *   掩膜内(皮肤):① 冷白位移  ② 频率分离磨皮
 *   掩膜外(甲面、背景):**原样用 LM-YC 的像素**(所以甲面一个像素不动 —— 这是构造保证,不是效果)
 *   边缘羽化 6 px
 *
 * 🔴 已知失败面,必须连叠图一起给店主看,不许只报数:
 *   **14 号红甲、42/43 裸甲会被肤色掩膜当成皮肤** —— 那几张的甲面会被磨、被拉冷。
 *   这正是「零依赖做不出甲面分割」的代价,叠图里一眼能看出来。
 */

/* ── 参数摆在明面上(§二:不许藏在脚本里)──
 * 🔴 12f §三:Y加/Cb加/Cr减 从**绝对值**改成**按掩膜内 Y 均值的百分比**。
 *   案底:28 号(暗片)中档 [全图] R:B 崩到 1.087,跟完全没回贴的腿A(1.085)一样蓝。
 *   机理(我核过,与令里给的原因不同,更正如下):
 *     Cb/Cr **不随亮度走** —— 28 号 Cb 均值 124.8、02 号 119.6,都在 128 附近,+6 对两张都约 4.8%。
 *     真凶是 **RGB 幅值**:28 号 Y≈26.8 ⇒ B≈21,而 Cb+6 让 B 增加 1.772×6≈10.6,
 *     **在 21 的基数上是 +50%**,R:B 从 1.57 崩到 0.78;02 号 Y≈78.7 同样偏移只从 1.27 到 1.0。
 *   ⇒ 按 Y 均值取百分比,偏移量就跟 RGB 幅值同比例缩放,暗片不再被打爆。
 */
export const PARAMS = {
  轻: { Y百分比: 3, Cb百分比: 1.5, Cr百分比: 1.5, 磨皮_双边空间: 6, 磨皮_双边值域: 24, 高频保留: 0.6 },
  中: { Y百分比: 6, Cb百分比: 3, Cr百分比: 3, 磨皮_双边空间: 9, 磨皮_双边值域: 36, 高频保留: 0.6 },
}
export const 羽化px = 6
export const 说明 = {
  Y百分比: '亮度上移 = 掩膜内 Y 均值 × 这个百分比 —— 「白净」的白',
  Cb百分比: '蓝色度上移(同样按 Y 均值取百分比)· Cr百分比:红色度下移 —— 合起来是「偏冷」',
  磨皮_双边空间: '双边滤波的空间半径,越大磨得越远',
  磨皮_双边值域: '双边滤波的值域容差,越大越不保边',
  高频保留: '频率分离里高频回填的比例 —— 0.6 表示保留六成纹理,不磨成塑料',
}

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
const PY = '/opt/anaconda3/bin/python3'

/** 对一张 LM-YC 基底出「轻/中」两档 + 掩膜叠图 */
export function skinLayer({ base, orig, outDir, 序号, 档 }) {
  mkdirSync(outDir, { recursive: true })
  const p = PARAMS[档]
  return JSON.parse(execFileSync(PY, ['-c', `
import sys, json, os
import numpy as np
from PIL import Image
from scipy import ndimage

base_p, orig_p, out_dir, num, grade = sys.argv[1:6]
Ypct, Cbpct, Crpct, bs, br, keep, feather = [float(x) for x in sys.argv[6:13]]

base = Image.open(base_p).convert('RGB')
ycc = np.asarray(base.convert('YCbCr')).astype(np.float64)

# 肤色掩膜(与 metrics.mjs 同一套口径)
small = base.copy(); small.thumbnail((600,600), Image.LANCZOS)
y = np.asarray(small.convert('YCbCr')).astype(float)
sk = (y[:,:,1]>=77)&(y[:,:,1]<=127)&(y[:,:,2]>=133)&(y[:,:,2]<=173)
sk = ndimage.binary_closing(ndimage.binary_opening(sk, np.ones((3,3))), np.ones((7,7)))
m = np.asarray(Image.fromarray((sk*255).astype(np.uint8)).resize(base.size, Image.NEAREST))>127
soft = ndimage.gaussian_filter(m.astype(np.float64), sigma=feather)[:,:,None]

out = ycc.copy()
# ① 冷白位移(按掩膜内 Y 均值的百分比 —— 见文件头的更正)
Ymean = float(ycc[:,:,0][m].mean()) if m.sum()>50 else float(ycc[:,:,0].mean())
Yadd, Cbadd, Crsub = Ymean*Ypct/100.0, Ymean*Cbpct/100.0, Ymean*Crpct/100.0
out[:,:,0] = ycc[:,:,0] + Yadd
out[:,:,1] = ycc[:,:,1] + Cbadd
out[:,:,2] = ycc[:,:,2] - Crsub
# ② 频率分离磨皮:低频用双边(scipy 没有,用「高斯 + 边缘权重」近似),高频按 keep 回填
Y = out[:,:,0]
low = ndimage.gaussian_filter(Y, sigma=bs)
edge = np.abs(Y-low)
w = np.exp(-(edge**2)/(2*br**2))              # 边缘处权重低 → 保边
smooth = low*w + Y*(1-w)
high = Y - low
out[:,:,0] = smooth + high*keep

res = ycc*(1-soft) + out*soft                  # 掩膜外原样 = LM-YC 的像素
img = Image.fromarray(np.clip(res,0,255).astype(np.uint8),'YCbCr').convert('RGB')
name = f'{num}_模型四块口令+亮度回贴全+皮肤层冷白{grade}+磨皮.jpg'
img.save(os.path.join(out_dir, name), 'JPEG', quality=94)

# 掩膜叠图(红 = 被当成皮肤的区域)—— 14/42/43 的甲面会被圈进来,这张就是证据
ov = np.asarray(base).astype(float)
ov[m] = ov[m]*0.55 + np.array([210,60,60])*0.45
Image.fromarray(ov.astype(np.uint8)).save(os.path.join(out_dir, f'{num}_皮肤掩膜叠图.jpg'),'JPEG',quality=85)
print(json.dumps({'产出': name, '掩膜占比': round(float(m.mean()*100),1), '掩膜内Y均值': round(Ymean,1), '实际Y加': round(Yadd,1), '实际Cb加': round(Cbadd,1)}, ensure_ascii=False))
`, base, orig, outDir, 序号, 档,
    String(p.Y百分比), String(p.Cb百分比), String(p.Cr百分比), String(p.磨皮_双边空间), String(p.磨皮_双边值域), String(p.高频保留), String(羽化px),
  ], { encoding: 'utf8' }))
}
