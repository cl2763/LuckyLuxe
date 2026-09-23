/* 12a 指标唯一出口(12d补三 §一)
 *
 * 🔴 立这个文件的原因:同一个「死白」我和 Cowork 量出 1.57% 与 6.83%,差四倍。
 *    查明是**分辨率**:我在 400px 缩略图上量,细小高光点被 LANCZOS 平均掉;
 *    23 号缎面全是细碎高光,损失最大。**不是亮度公式的锅**(PIL convert('L') 就是 0.299/0.587/0.114)。
 *    ⇒ 从此**只留一个出数口**,别处一律调它,不许各写各的。
 *
 * ── 口径写死在这里,任何引用处都按这个口径解释 ──
 *   输入   :磁盘上的**那张文件本身**,**全分辨率**,不缩略、不裁切
 *   通道   :PIL `convert('L')`
 *   死白   :L > 225 的像素占比(%)
 *   过曝块 :L > 245 的像素占比(%)
 *   冷暖   :RGB 三通道均值的 R/B
 *   范围   :`全图` 或 `手框`(肤色掩膜内)—— **每个数必须带范围标签**(§四)
 */
import { execFileSync } from 'node:child_process'
const PY = '/opt/anaconda3/bin/python3'

export const SPEC = {
  肌理: '高斯 σ=4 残差的 std(高频能量),手框内 —— 数越大纹理越多',
  输入: '磁盘原文件,全分辨率,不缩略不裁切',
  通道: "PIL convert('L')",
  死白: 'L > 225 占比 %',
  过曝块: 'L > 245 占比 %',
  冷暖: 'RGB 均值的 R/B',
}

/** 量一批文件。返回 [{文件, 全图:{...}, 手框:{...}|null}] */
export function measure(paths) {
  if (!paths.length) return []
  return JSON.parse(execFileSync(PY, ['-c', `
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage

def stats(L, rgb, mask=None):
    l = L[mask] if mask is not None else L.ravel()
    r = rgb[:,:,0][mask] if mask is not None else rgb[:,:,0].ravel()
    b = rgb[:,:,2][mask] if mask is not None else rgb[:,:,2].ravel()
    if l.size < 50: return None
    return {'均亮': round(float(l.mean()),1),
            '死白': round(float((l>225).mean()*100),2),
            '过曝块': round(float((l>245).mean()*100),2),
            'p95': round(float(np.percentile(l,95)),1),
            'RB': round(float(r.mean()/max(b.mean(),1e-6)),3)}

out = []
for p in sys.argv[1:]:
    im = Image.open(p)
    L = np.asarray(im.convert('L')).astype(np.float64)          # 全分辨率,不缩略
    rgb = np.asarray(im.convert('RGB')).astype(np.float64)
    # 肤色掩膜在缩略图上算(只为定位,便宜),再放大回全分辨率取样
    small = im.convert('RGB').copy(); small.thumbnail((600,600), Image.LANCZOS)
    y = np.asarray(small.convert('YCbCr')).astype(float)
    sk = (y[:,:,1]>=77)&(y[:,:,1]<=127)&(y[:,:,2]>=133)&(y[:,:,2]<=173)
    sk = ndimage.binary_closing(ndimage.binary_opening(sk, np.ones((3,3))), np.ones((7,7)))
    skin_full = np.asarray(Image.fromarray((sk*255).astype(np.uint8)).resize((L.shape[1], L.shape[0]), Image.NEAREST)) > 127
    out.append({'文件': p.split('/')[-1], '全图': stats(L, rgb), '手框': stats(L, rgb, skin_full)})
print(json.dumps(out, ensure_ascii=False))
`, ...paths], { encoding: 'utf8', maxBuffer: 64e6 }))
}

/** 肌理量(12d补四 §二)—— 「磨皮有没有效」第一次有尺
 *  口径:全分辨率 · convert('L') · 高斯 σ=4 的高频残差 std · **手框内**(磨皮的宾语是皮肤)
 *  🔴 这把尺不判好坏 —— 比原图**高**说明模型加了纹理/锐化(与「轻度磨皮」相反),标红给店主看。
 */
export function texture(paths) {
  if (!paths.length) return []
  return JSON.parse(execFileSync(PY, ['-c', `
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage
out = []
for p in sys.argv[1:]:
    im = Image.open(p)
    L = np.asarray(im.convert('L')).astype(np.float64)
    hi = L - ndimage.gaussian_filter(L, sigma=4)
    small = im.convert('RGB').copy(); small.thumbnail((600,600), Image.LANCZOS)
    y = np.asarray(small.convert('YCbCr')).astype(float)
    sk = (y[:,:,1]>=77)&(y[:,:,1]<=127)&(y[:,:,2]>=133)&(y[:,:,2]<=173)
    sk = ndimage.binary_closing(ndimage.binary_opening(sk, np.ones((3,3))), np.ones((7,7)))
    m = np.asarray(Image.fromarray((sk*255).astype(np.uint8)).resize((L.shape[1],L.shape[0]), Image.NEAREST))>127
    out.append({'文件': p.split('/')[-1],
                '全图肌理': round(float(hi.std()),2),
                '手框肌理': round(float(hi[m].std()),2) if m.sum()>50 else None})
print(json.dumps(out, ensure_ascii=False))
`, ...paths], { encoding: 'utf8', maxBuffer: 64e6 }))
}
