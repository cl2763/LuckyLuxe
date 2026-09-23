"""裁定②的两把独立尺 —— 不依赖关键点、不依赖手描。
  尺一:指甲片数(人眼 vs 模型出的片数)
  尺二:**每片**掩膜里肤色像素占比 —— 圈对了应该很低,吃到手指就高
肤色判定与 metrics.mjs 同一套 YCbCr 窗口(已验准的那套)。
"""
import sys, json, os, glob
import numpy as np
from PIL import Image

def skin_mask(path):
    im = Image.open(path).convert('RGB')
    y = np.asarray(im.convert('YCbCr')).astype(float)
    return (y[:,:,1]>=77)&(y[:,:,1]<=127)&(y[:,:,2]>=133)&(y[:,:,2]<=173)

img, maskdir, num = sys.argv[1], sys.argv[2], sys.argv[3]
sk = skin_mask(img)
H, W = sk.shape
rows = []
for f in sorted(glob.glob(os.path.join(maskdir, f'{num}_甲*.npy'))):
    m = np.load(f)
    if m.shape != sk.shape:
        m = np.asarray(Image.fromarray(m.astype(np.uint8)*255).resize((W,H), Image.NEAREST))>127
    n = int(m.sum())
    rows.append({'片': os.path.basename(f).split('_')[1].replace('.npy',''),
                 '像素数': n,
                 '占全图%': round(n/m.size*100, 2),
                 '掩膜内肤色占比%': round(float(sk[m].mean()*100), 1) if n else None})
u = np.load(os.path.join(maskdir, f'{num}_指甲掩膜.npy'))
print(json.dumps({'合并占全图%': round(float(u.mean()*100),2),
                  '合并掩膜内肤色占比%': round(float(sk[u].mean()*100),1),
                  '逐片': rows}, ensure_ascii=False))
