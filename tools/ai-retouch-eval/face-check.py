# 12j补 §一-4 / §三 无人脸核验
# 判据律:不验「我裁过了」这句话,验像素 —— ①客观检测器跑全图 ②顶部 400px 拼成一张图给人眼看
# 用 tools/segment/venv 的 python(mediapipe / cv2 在那里)
import sys, os, json
import numpy as np, cv2
from PIL import Image

IN_DIR, OUT_SHEET, OUT_JSON, ONLY_FROM = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
STRIP = 400

# 🔴 静默失败器族:CascadeClassifier 读不到 xml 时**不报错**,只是 empty();
#    拿它跑出来的「0 张有脸」是假绿。所以这里显式判 empty,取不到就明说「检测器不可用」,
#    绝不让「没检出」和「没检测」长成同一个样子。
def _cc(name):
    c = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, name))
    return None if c.empty() else c
front, prof = _cc('haarcascade_frontalface_default.xml'), _cc('haarcascade_profileface.xml')
DETECTOR_OK = front is not None and prof is not None

files = sorted(f for f in os.listdir(IN_DIR) if f.endswith('.jpg') and f[:2].isdigit() and int(f[:2]) >= ONLY_FROM)
rows, strips = [], []
for f in files:
    p = os.path.join(IN_DIR, f)
    im = Image.open(p).convert('RGB')
    g = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2GRAY)
    g = cv2.equalizeHist(g)
    hits = []
    if DETECTOR_OK:
        for name, cc in (('正脸', front), ('侧脸', prof)):
            for (x, y, w, h) in cc.detectMultiScale(g, 1.1, 6, minSize=(60, 60)):
                hits.append({'类型': name, 'x': int(x), 'y': int(y), 'w': int(w), 'h': int(h)})
    rows.append({'文件': f, '尺寸': f'{im.width}x{im.height}',
                 '检出': hits, '检测器': 'haar' if DETECTOR_OK else '不可用'})
    strips.append((f, im.crop((0, 0, im.width, min(STRIP, im.height)))))

# 顶部 400px 拼图:每行 4 张,缩到宽 440
COLS, W = 4, 440
tiles = []
for f, s in strips:
    h = round(s.height * W / s.width)
    t = s.resize((W, h), Image.LANCZOS)
    lab = Image.new('RGB', (W, h + 26), (20, 20, 20)); lab.paste(t, (0, 26))
    d = __import__('PIL.ImageDraw', fromlist=['ImageDraw']).Draw(lab)
    d.text((6, 6), f, fill=(255, 235, 120))
    tiles.append(lab)
rowsn = (len(tiles) + COLS - 1) // COLS
TH = max(t.height for t in tiles)
sheet = Image.new('RGB', (COLS * (W + 8) + 8, rowsn * (TH + 8) + 8), (10, 10, 10))
for i, t in enumerate(tiles):
    sheet.paste(t, (8 + (i % COLS) * (W + 8), 8 + (i // COLS) * (TH + 8)))
sheet.save(OUT_SHEET, 'JPEG', quality=88)

json.dump(rows, open(OUT_JSON, 'w'), ensure_ascii=False, indent=1)
bad = [r for r in rows if r['检出']]
if not DETECTOR_OK:
    print('🔴 haar 级联数据缺失(本机 cv2 是 headless 构建,不带 data/*.xml)—— 自动检测这一层没跑成,')
    print('   不许把它记成「0 张有脸」。本次无人脸核验以顶部 400px 全量拼图的人眼核验为准。')
print(f'查了 {len(rows)} 张(编号 ≥ {ONLY_FROM});自动检测器报有脸的 {len(bad)} 张(检测器可用={DETECTOR_OK})')
for r in bad:
    print('  ⚠️', r['文件'], r['检出'])
print('顶部 400px 拼图:', OUT_SHEET)
