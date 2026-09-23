/* 腿 B 重跑(12f §三)—— 基底换成 **腿 A′ + 亮度回贴全**,新的按比例参数,
 * 只做四张掩膜成立的(02/18/23/28);42/43/14/44 标「掩膜失效,无效」不重出。 */
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { skinLayer, PARAMS, 羽化px, 说明 } from './skin-layer.mjs'
const [, , IN_DIR, ROOT] = process.argv
const PY = '/opt/anaconda3/bin/python3'
const VALID = ['02', '18', '23', '28']
const INVALID = { '42': '掩膜占比 80.9%,白 T 恤与木地板被整片圈进来', '43': '掩膜 57.3%,木柜与拼豆画被圈进来', '14': '红甲色度≈肤色,整片甲被判成皮肤', '44': '掩膜 52.7%,木桌与墙被圈进来' }
const A2 = join(ROOT, 'A2_只去瑕疵'), OUT = join(ROOT, 'B2_皮肤层_基于只去瑕疵')
mkdirSync(OUT, { recursive: true })
const log = []
for (const g of readdirSync(A2).filter((f) => f.endsWith('.jpg')).sort()) {
  const num = g.slice(0, 2)
  if (!VALID.includes(num)) { log.push({ 序号: num, 状态: '🔴 掩膜失效,不重出', 原因: INVALID[num] }); continue }
  const orig = readdirSync(IN_DIR).find((f) => f.startsWith(num + '_'))
  const base = join(OUT, `${num}_模型只去瑕疵+亮度回贴全.jpg`)
  execFileSync(PY, ['-c', `
import sys
import numpy as np
from PIL import Image
def mh(s,r):
    sv,si,sc=np.unique(s.ravel(),return_inverse=True,return_counts=True)
    rv,rc=np.unique(r.ravel(),return_counts=True)
    return np.interp(np.cumsum(sc)/s.size, np.cumsum(rc)/r.size, rv)[si].reshape(s.shape)
gen=Image.open(sys.argv[1]).convert('RGB'); org=Image.open(sys.argv[2]).convert('RGB').resize(gen.size,Image.LANCZOS)
g=np.asarray(gen.convert('YCbCr')).astype(float); o=np.asarray(org.convert('YCbCr')).astype(float)
out=g.copy()
for c in range(3): out[:,:,c]=mh(g[:,:,c],o[:,:,c])
Image.fromarray(np.clip(out,0,255).astype(np.uint8),'YCbCr').convert('RGB').save(sys.argv[3],'JPEG',quality=94)
`, join(A2, g), join(IN_DIR, orig), base])
  const r = {}
  for (const 档 of ['轻', '中']) r[档] = skinLayer({ base, orig: join(IN_DIR, orig), outDir: OUT, 序号: num, 档 })
  log.push({ 序号: num, 状态: '✅', 基底: `${num}_模型只去瑕疵+亮度回贴全.jpg`, 轻: r.轻.产出, 中: r.中.产出,
             掩膜占比: r.轻.掩膜占比, 掩膜内Y均值: r.轻.掩膜内Y均值, 实际Y加: r.轻.实际Y加 })
  console.log(`  ${num} ✅ 掩膜 ${r.轻.掩膜占比}% · 掩膜内Y均值 ${r.轻.掩膜内Y均值} · 轻档实际 Y+${r.轻.实际Y加}`)
}
for (const x of log.filter((r) => r.状态 !== '✅')) console.log(`  ${x.序号} ${x.状态} —— ${x.原因}`)
writeFileSync(join(ROOT, '_腿B2记录.json'), JSON.stringify({ 参数: PARAMS, 羽化px, 参数说明: 说明, 有效件: VALID, 无效件: INVALID, 明细: log }, null, 2))
