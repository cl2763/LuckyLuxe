"""12g补三(台账裁定)三件:
 ① 14 号**人给框**:框来自 100% 裁片手描多边形的外接矩形。box 提示用 multimask_output=False ——
    单掩膜,**绕开"选候选"这一步**(上一轮两个选择器都被证明在红甲上是瞎的:
    argmin(面积)挑到碎屑;肤色占比最低 → 肤色掩膜在 14 号本来就失败,拿它挑红甲等于瞎挑)。
 ④ 自动出点路一:负点从**已验准的肤色掩膜**自动取;正点取**非肤色连通块质心**当候选。
 ⑤ 自动出点路二:MobileSAM 全自动出全图所有块,按三条筛 ——
    挨着皮肤 / 面积在指甲量级 / 块内不含肤色像素。
 🔴 ④⑤ **只报能不能出对的块,不报覆盖率**(令里点名)。
"""
import sys, json, os
import numpy as np
import torch
from PIL import Image
from scipy import ndimage
from mobile_sam import sam_model_registry, SamPredictor, SamAutomaticMaskGenerator

def skin_of(rgb):
    y = np.asarray(Image.fromarray(rgb).convert('YCbCr')).astype(float)
    m = (y[:,:,1]>=77)&(y[:,:,1]<=127)&(y[:,:,2]>=133)&(y[:,:,2]<=173)
    return ndimage.binary_closing(ndimage.binary_opening(m, np.ones((3,3))), np.ones((7,7)))

ckpt, device, outdir = sys.argv[2], sys.argv[3], sys.argv[4]
cfg = json.load(open(sys.argv[1])); os.makedirs(outdir, exist_ok=True)
sam = sam_model_registry["vit_t"](checkpoint=ckpt).to(device=device).eval()
pred = SamPredictor(sam)
rep = []

for it in cfg:
    rgb = np.asarray(Image.open(it['图']).convert('RGB')); H, W = rgb.shape[:2]
    sk = skin_of(rgb)
    pred.set_image(rgb)

    if it.get('人给框'):
        masks = []
        for b in it['人给框']:
            box = np.array([b[0]*W, b[1]*H, b[2]*W, b[3]*H])
            m, _, _ = pred.predict(box=box[None,:], multimask_output=False)
            masks.append(m[0])
        u = np.zeros((H,W),bool)
        for m in masks: u |= m
        np.save(os.path.join(outdir, f"{it['序号']}_人给框_指甲掩膜.npy"), u)
        rep.append({'序号':it['序号'],'方法':'① 人给框','框数':len(masks),
          '逐片':[{'甲':i+1,'占全图%':round(float(m.mean()*100),2),'掩膜内肤色%':round(float(sk[m].mean()*100),1)} for i,m in enumerate(masks)],
          '合并占全图%':round(float(u.mean()*100),2),'合并肤色%':round(float(sk[u].mean()*100),1)})

    if it.get('人给点'):
        masks=[]
        for p in it['人给点']:
            m,s,_ = pred.predict(point_coords=np.array([[p[0]*W,p[1]*H]]), point_labels=np.array([1]), multimask_output=True)
            r=[float(sk[mm].mean()) if mm.sum() else 1.0 for mm in m]
            masks.append(m[int(np.argmin(r))])
        u=np.zeros((H,W),bool)
        for m in masks: u|=m
        np.save(os.path.join(outdir, f"{it['序号']}_人给点_指甲掩膜.npy"), u)
        rep.append({'序号':it['序号'],'方法':'② 人给点','点数':len(masks),
          '逐片':[{'甲':i+1,'占全图%':round(float(m.mean()*100),2),'掩膜内肤色%':round(float(sk[m].mean()*100),1)} for i,m in enumerate(masks)],
          '合并占全图%':round(float(u.mean()*100),2),'合并肤色%':round(float(sk[u].mean()*100),1)})

    if it.get('自动'):
        # ④ 非肤色连通块质心当正点候选
        hand = ndimage.binary_fill_holes(ndimage.binary_dilation(sk, np.ones((9,9))))
        cand = hand & (~sk)
        lab,n = ndimage.label(cand)
        area_lo, area_hi = H*W*0.0008, H*W*0.02     # 指甲量级
        cents=[]
        if n:
            sizes = ndimage.sum(cand, lab, range(1,n+1))
            for i,s in enumerate(sizes,1):
                if area_lo<=s<=area_hi:
                    cy,cx = ndimage.center_of_mass(lab==i)
                    cents.append((cx/W, cy/H))
        rep.append({'序号':it['序号'],'方法':'④ 自动出点(非肤色连通块质心)',
                    '候选块数':len(cents),'人眼指甲数':it.get('人眼指甲数'),
                    '结论':'块数与人眼数接近则可能可用' if cents else '一个候选都没出'})
        # ⑤ 全自动出块 + 三条筛
        gen = SamAutomaticMaskGenerator(sam, points_per_side=16)
        anns = gen.generate(rgb)
        keep=[]
        for a in anns:
            m=a['segmentation']; area=m.sum()
            if not (area_lo<=area<=area_hi): continue
            if float(sk[m].mean())>0.15: continue                      # 块内不含肤色
            nb = ndimage.binary_dilation(m, np.ones((15,15))) & (~m)
            if float(sk[nb].mean())<0.25: continue                     # 必须挨着皮肤
            keep.append(a)
        rep.append({'序号':it['序号'],'方法':'⑤ 全自动出块 + 三条筛',
                    '全自动出块数':len(anns),'过三条筛的块数':len(keep),
                    '人眼指甲数':it.get('人眼指甲数'),
                    '结论':'筛后块数 vs 人眼数' })
print(json.dumps(rep, ensure_ascii=False))
