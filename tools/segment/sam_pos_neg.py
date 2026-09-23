"""正点+负点两版并排(12g补二)—— **只改提示,不动任何参数**。
  版一 正点only  :每枚甲面中心 1 个正点(= 上一轮的做法,作对照)
  版二 正+负     :同样的正点 + 甲根下方皮肤的负点
🔴 候选挑法也一并改:上一轮用 argmin(面积最小)挑候选 —— 挑到的是噪声碎屑,不是甲面。
   改成**挑掩膜内肤色占比最低**的那个候选 —— 这条直接对着「圈的是不是甲面」这件事。
"""
import sys, json, time, os
import numpy as np
import torch
from PIL import Image
from mobile_sam import sam_model_registry, SamPredictor

def skin_of(im):
    y = np.asarray(Image.fromarray(im).convert('YCbCr')).astype(float)
    return (y[:,:,1]>=77)&(y[:,:,1]<=127)&(y[:,:,2]>=133)&(y[:,:,2]<=173)

cfg = json.load(open(sys.argv[1])); ckpt, device, outdir = sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(outdir, exist_ok=True)
sam = sam_model_registry["vit_t"](checkpoint=ckpt).to(device=device).eval()
pred = SamPredictor(sam)
rep = []
for item in cfg:
    im = np.asarray(Image.open(item['图']).convert('RGB')); H, W = im.shape[:2]
    sk = skin_of(im)
    pred.set_image(im)
    for mode in ['正点only', '正加负']:
        masks, picks = [], []
        for i, p in enumerate(item['提示点']):
            pc = [[p[0]*W, p[1]*H]]; pl = [1]
            if mode == '正加负' and item.get('负点'):
                for q in item['负点']:
                    pc.append([q[0]*W, q[1]*H]); pl.append(0)
            m, s, _ = pred.predict(point_coords=np.array(pc), point_labels=np.array(pl), multimask_output=True)
            # 挑「掩膜内肤色占比最低」的候选 —— 直接对着「圈的是不是甲面」
            ratios = [float(sk[mm].mean()) if mm.sum() else 1.0 for mm in m]
            k = int(np.argmin(ratios))
            masks.append(m[k]); picks.append({'甲': i+1, '像素': int(m[k].sum()),
                '占全图%': round(float(m[k].mean()*100),2),
                '掩膜内肤色%': round(ratios[k]*100,1)})
        u = np.zeros((H,W), bool)
        for m in masks: u |= m
        np.save(os.path.join(outdir, f"{item['序号']}_{mode}_指甲掩膜.npy"), u)
        rep.append({'序号': item['序号'], '版本': mode, '片数': len(masks),
                    '合并占全图%': round(float(u.mean()*100),2),
                    '合并掩膜内肤色%': round(float(sk[u].mean()*100),1), '逐片': picks})
print(json.dumps(rep, ensure_ascii=False))
