"""MobileSAM 分指甲(12g §二-1;12g补 裁定三:提示点由**人**给,不由 MediaPipe 给)
🔴 这证明的是「分割本身准不准」,**不证明产品能自动出点** —— 两件事回执分开写。
耗时分两次报:mps 与**纯 CPU**(生产服务器没有 Apple GPU)。
"""
import sys, json, time, os
import numpy as np
import torch
from PIL import Image
from mobile_sam import sam_model_registry, SamPredictor

def run(img_path, points, ckpt, device):
    sam = sam_model_registry["vit_t"](checkpoint=ckpt).to(device=device).eval()
    pred = SamPredictor(sam)
    im = np.asarray(Image.open(img_path).convert('RGB'))
    H, W = im.shape[:2]
    t0 = time.time(); pred.set_image(im); t_embed = (time.time()-t0)*1000
    masks, scores = [], []
    t1 = time.time()
    for p in points:
        pc = np.array([[p[0]*W, p[1]*H]]); pl = np.array([1])
        m, s, _ = pred.predict(point_coords=pc, point_labels=pl, multimask_output=True)
        k = int(np.argmin([mm.sum() for mm in m]))     # 指甲是小块,取面积最小那个候选
        masks.append(m[k]); scores.append(float(s[k]))
    t_pred = (time.time()-t1)*1000
    return masks, scores, t_embed, t_pred, (H, W)

if __name__ == '__main__':
    cfg = json.load(open(sys.argv[1]))
    ckpt, device, outdir = sys.argv[2], sys.argv[3], sys.argv[4]
    os.makedirs(outdir, exist_ok=True)
    rep = []
    for item in cfg:
        masks, scores, te, tp, (H, W) = run(item['图'], item['提示点'], ckpt, device)
        union = np.zeros((H, W), bool)
        for m in masks: union |= m
        np.save(os.path.join(outdir, item['序号'] + '_指甲掩膜.npy'), union)
        for i, m in enumerate(masks):
            np.save(os.path.join(outdir, f"{item['序号']}_甲{i+1}.npy"), m)
        rep.append({'序号': item['序号'], '提示点数': len(item['提示点']),
                    '出掩膜片数': len(masks), '各片得分': [round(s,3) for s in scores],
                    '嵌入ms': round(te,1), '逐点预测ms': round(tp,1), '设备': device,
                    '掩膜占比%': round(float(union.mean()*100), 2)})
    print(json.dumps(rep, ensure_ascii=False))
