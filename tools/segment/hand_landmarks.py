"""MediaPipe 手部关键点(12g §二-1)—— 只出点,不出掩膜。
21 点里指尖是 4/8/12/16/20(拇指/食指/中指/无名/小指),DIP 关节是 3/7/11/15/19。
甲面大致落在「DIP → 指尖」这一小段的延长范围内,用这两点定框比目测网格准。"""
import sys, json, time
import numpy as np
from PIL import Image
import mediapipe as mp

TIP = [4, 8, 12, 16, 20]
DIP = [3, 7, 11, 15, 19]

def run(paths, model_path=None):
    BaseOptions = mp.tasks.BaseOptions
    HL = mp.tasks.vision.HandLandmarker
    opts = mp.tasks.vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        num_hands=2, running_mode=mp.tasks.vision.RunningMode.IMAGE)
    out = []
    with HL.create_from_options(opts) as det:
        for p in paths:
            im = Image.open(p).convert('RGB')
            arr = np.asarray(im)
            t0 = time.time()
            res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=arr))
            ms = (time.time()-t0)*1000
            hands = []
            for lm in (res.hand_landmarks or []):
                pts = [{'x': round(l.x,4), 'y': round(l.y,4)} for l in lm]
                hands.append({'全部21点': pts,
                              '指尖': [pts[i] for i in TIP],
                              'DIP': [pts[i] for i in DIP]})
            out.append({'文件': p.split('/')[-1], '手数': len(hands), '耗时ms': round(ms,1), '手': hands})
    return out

if __name__ == '__main__':
    model = sys.argv[1]
    print(json.dumps(run(sys.argv[2:], model), ensure_ascii=False))
