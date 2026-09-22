/* 12a 第二轮 · 翻车记录 + L5 稳定性 + 成本耗时(小批 11z §三) */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const [, , S, D] = process.argv
const PY = '/opt/anaconda3/bin/python3'
const R2 = JSON.parse(readFileSync(join(S, 'judge_r2.json'), 'utf8'))
const R1 = new Map(JSON.parse(readFileSync(join(S, 'judge.json'), 'utf8')).filter((x) => x.m === 'B').map((x) => [x.n, x]))
const L = JSON.parse(readFileSync(join(D, 'round2/_跑批日志.json'), 'utf8'))
const L5 = JSON.parse(readFileSync(join(S, 'l5.json'), 'utf8'))
const c = (a, f) => a.filter(f).length
const pc = (n, d) => `${((n / d) * 100).toFixed(1)}%`
const both = R2.filter((x) => R1.has(x.n)), r1b = both.map((x) => R1.get(x.n))

/* 客观量(全量,按像素算) */
const tone = JSON.parse(execFileSync(PY, ['-c', `
import os, json
import numpy as np
from PIL import Image
D=os.environ['D']
def m(p):
    im=Image.open(p).convert('RGB'); im.thumbnail((400,400), Image.LANCZOS)
    a=np.asarray(im).astype(float); l=0.299*a[:,:,0]+0.587*a[:,:,1]+0.114*a[:,:,2]
    return float((l>225).mean()*100), float(a[:,:,0].mean()/max(a[:,:,2].mean(),1e-6))
rows=[]
for f in sorted(os.listdir(D+"/_input")):
    if not f.endswith(".jpg"): continue
    p1,p2=D+"/round1/B_"+f, D+"/round2/B2_"+f
    if not (os.path.exists(p1) and os.path.exists(p2)): continue
    a=m(D+"/_input/"+f); b=m(p1); cc=m(p2)
    rows.append({'f':f,'w0':a[0],'w1':b[0],'w2':cc[0],'r0':a[1],'r1':b[1],'r2':cc[1]})
ref=[]
for f in sorted(os.listdir(D+"/参考质感")):
    if f.startswith("参考05"): continue
    x=m(D+"/参考质感/"+f); ref.append({'f':f,'w':x[0],'r':x[1]})
print(json.dumps({'rows':rows,'ref':ref}))
`], { encoding: 'utf8', env: { ...process.env, D } }))
const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length
const T = tone.rows

let md = `# 12a 第二轮 · 翻车记录(Code 初判 · 店主终判)

**只跑 B**(A 第一轮已淘汰)· 口令按 11z §二 的「相机质感」重写 · 41 张 + L5 稳定性 9 次 = 50 次调用
**出图 46/50,花 ¥${L.花费元}**。

---

## 一、结论先说:这一轮没达到目的

11z 的目标是解决「没有相机质感、一片死白、没有光影层次」。**按能量到的两个数,第二轮比第一轮更远。**

| | 原片 | 第一轮 | 第二轮 | 你的参考图 |
|---|---|---|---|---|
| **死白区**(亮度>225 的像素占比) | ${avg(T, 'w0').toFixed(2)}% | ${avg(T, 'w1').toFixed(2)}% | **${avg(T, 'w2').toFixed(2)}%** ↑ | **${Math.min(...tone.ref.map((x) => x.w)).toFixed(2)}–${Math.max(...tone.ref.map((x) => x.w)).toFixed(2)}%** |
| **冷暖 R/B**(>1 偏暖) | ${avg(T, 'r0').toFixed(3)} | ${avg(T, 'r1').toFixed(3)} | **${avg(T, 'r2').toFixed(3)}** ↓ | **${Math.min(...tone.ref.map((x) => x.r)).toFixed(2)}–${Math.max(...tone.ref.map((x) => x.r)).toFixed(2)}** |
| 死白达标(≤0.5%)张数 | — | ${c(T, (x) => x.w1 <= 0.5)}/${T.length} | **${c(T, (x) => x.w2 <= 0.5)}/${T.length}** | — |
| 冷暖达标(≥1.10)张数 | — | ${c(T, (x) => x.r1 >= 1.10)}/${T.length} | **${c(T, (x) => x.r2 >= 1.10)}/${T.length}** | — |

**两条都退步了。**

### 这两个指标是怎么来的(我换过两次,前两次都是废指标)

- 先用**暗部占比** —— 废。你的**参考01 暗部只有 6.5%**(比模型出图还少)照样高级,参考04 暗部 65.2% 也高级,毫无规律。
- 再用**最亮值 p95** —— 方向对了。
- 最后落到**死白区**(亮度>225 占比),这条最直接:**原片 ${avg(T, 'w0').toFixed(2)}%、你的参考图 ${Math.min(...tone.ref.map((x) => x.w)).toFixed(2)}–${Math.max(...tone.ref.map((x) => x.w)).toFixed(2)}%、模型出图 ${avg(T, 'w2').toFixed(2)}%。**
  **原片没有死白,你的参考图也没有(最高一张 ${Math.max(...tone.ref.map((x) => x.w)).toFixed(2)}%)—— 死白是模型自己造出来的。**

---

## 二、①a 翻车率(最高优先级)

**第二轮全量 ${R2.length} 张:**

| | 明确 | 轻度 | 合计 |
|---|---|---|---|
| ①a 改甲面 | **${c(R2, (x) => x.a === 2)}**(${pc(c(R2, (x) => x.a === 2), R2.length)}) | ${c(R2, (x) => x.a === 1)} | **${c(R2, (x) => x.a > 0)}**(${pc(c(R2, (x) => x.a > 0), R2.length)}) |

**两轮都有出图的 ${both.length} 张,同一批样本对比:**

| | 第一轮 | 第二轮 |
|---|---|---|
| ①a 明确 | ${c(r1b, (x) => x.a === 2)} | **${c(both, (x) => x.a === 2)}** ↓ |
| ①a 轻度 | ${c(r1b, (x) => x.a === 1)} | **${c(both, (x) => x.a === 1)}** ↑ |
| **①a 合计** | ${c(r1b, (x) => x.a > 0)} | **${c(both, (x) => x.a > 0)}** ↑ |
| ①b 构图/背景 | ${c(r1b, (x) => x.b)} | ${c(both, (x) => x.b)} |
| ③ 肤色 | ${c(r1b, (x) => x.d)} | ${c(both, (x) => x.d)} |

逐张:**变好 ${both.filter((x) => x.a < R1.get(x.n).a).map((x) => x.n).join('、')}** · **变差 ${both.filter((x) => x.a > R1.get(x.n).a).map((x) => x.n).join('、')}** · 其余 ${both.filter((x) => x.a === R1.get(x.n).a).length} 张没变。

> **净效果基本持平、略差** —— 严重的少了几张,轻度的多了几张。
> 我中途报过一句「①a 明显改善」,**那是只看了 4 张得出的,不成立**,这里以全量为准。

---

## 三、一句一因:哪句起了作用,哪句没有

| 改动 | 预期 | 实际 |
|---|---|---|
| **删 p4**「每片甲面只保留一条水光反射带」 | 不再凭空加高光 | **部分有效** —— 09 号那几道假高光条确实没了(✅);但 **39 号甲面高光仍被加粗**,22 号变轻但仍在 |
| **删 p1**「冷白皮」 | 肤色不再被改白 | **无效** —— ③ 肤色仍是 **${c(R2, (x) => x.d)}/${R2.length} 全中**。删掉这句,模型照样把手改白 |
| **删 p3**「阴影提亮不发灰」+ 加「不整体提亮」 | 暗片不再被一味提亮 | **无效** —— 18 号(原图亮度 32,正是你说的"偏暗但高级")背景被从近全黑提到能看清牛仔布纹;03 号均亮 88.6→175.7 |
| **保留**「白平衡轻微偏冷,让白色回到中性白」 | (11z 要求保留) | 🔴 **这句是主凶** —— R/B 从第一轮 ${avg(T, 'r1').toFixed(3)} 进一步降到 ${avg(T, 'r2').toFixed(3)};金闪→银白(08/15/23)、墨绿→天蓝(28,比第一轮更糟)、暖珠光→冷蓝白(12/26,都比第一轮更冷) |
| 加「不新增任何高光」 | 高光不冲顶 | **无效** —— 死白区反而从 ${avg(T, 'w1').toFixed(2)}% 升到 ${avg(T, 'w2').toFixed(2)}%。**只禁止动作不给上限,拦不住** |

---

## 四、L5 稳定性(11z §三 要的)

**同一张图、同一条口令,连跑 3 次,出图不一样。**

| 样片 | 两两像素平均差 | 相关系数 | 各次均亮 | 各次暗部占比 |
|---|---|---|---|---|
${L5.map((r) => r.备注 ? `| ${r.f.slice(0, 2)} ${r.说明} | — | — | — | ${r.备注} |` :
  `| **${r.f.slice(0, 2)}** ${r.说明} | ${r.两两比.map((p) => p.像素平均差).join(' / ')} | ${r.两两比.map((p) => p.相关系数).join(' / ')} | ${r.各次色调.map((t) => t.均亮).join(' / ')} | ${r.各次色调.map((t) => t.暗部占比 + '%').join(' / ')} |`).join('\n')}

- **18 号第三次跟前两次的相关系数掉到 0.746–0.786**,暗部占比从 63% 掉到 **46.8%** —— 明显是另一个调子。
- **35 号三次均亮跨度 26.5**(124.5 – 151)。
- 02 号只跑成 2 次(第 1 次超时失败)。

**这对店里的实际意义**:同一张照片修两次,效果会明显不同,商家会觉得「怎么这次修得不一样」。
**对验证方法的意义**:单张单次的结果不能代表口令效果 —— 第三轮如果只跑一次就比较,可能把随机波动当成口令改进。

---

## 五、逐格明细

| # | ①a | ①b | ② | ③ | 第一轮 ①a | 看哪里、怎么变 |
|---|:-:|:-:|:-:|:-:|:-:|---|
${R2.map((x) => {
  const sev = (v) => (v === 2 ? '🔴' : v === 1 ? '⚠️' : '·')
  const y = R1.get(x.n)
  return `| ${x.n} | ${sev(x.a)} | ${x.b ? '🔴' : '·'} | ${x.c ? '🔴' : '·'} | ${x.d ? '🔴' : '·'} | ${y ? sev(y.a) : '无'} | ${x.why} |`
}).join('\n')}

①a 列:🔴=明确 · ⚠️=轻度 · ·=没有

---

## 六、没出图的 4 张

${L.明细.filter((r) => r.状态 !== '✅').map((r) => `- **${r.文件}${r.轮次 === '主' ? '' : ' ' + r.轮次}** — ${r.状态}:\`${(r.错误 || '').slice(0, 120)}\``).join('\n')}

**这一轮 4 条失败全是网络超时,没有版权拒稿。** 10 号(Hello Kitty)第一轮是被版权拒的(HTTP 400),
这一轮是超时 —— 所以**不能据此说版权问题消失了,只是这次没走到那一步**。12b 仍要按版权拒稿处理。

服务这一轮明显更慢:平均 ${(L.明细.filter((r) => r.状态 === '✅' && r.耗时ms).reduce((s, r) => s + r.耗时ms, 0) / c(L.明细, (r) => r.状态 === '✅' && r.耗时ms) / 1000).toFixed(1)} 秒/张(第一轮约 25 秒)。

---

## 七、第三轮建议改哪句(候选口令已备好,未跑,等你批)

文件:\`tools/ai-retouch-eval/round3-candidate.mjs\`。**只动两处**,其余逐字不变 —— 一次只动该动的,才知道是哪句起的作用:

1. **删**「白平衡轻微偏冷,让白色回到中性白,但不发灰不发青」
   **换成**「色温以原图为准,保留原图本来的暖调,不做冷暖校正,不要把画面调冷调灰」
   → 依据:你的参考图 R/B 全在 1.17 以上,原片 ${avg(T, 'r0').toFixed(2)},模型出图被拉到 ${avg(T, 'r2').toFixed(2)}。

2. **加**「画面里不允许出现成片的纯白或接近纯白的区域,最亮处必须保留细节和层次」
   → 依据:「不新增任何高光」这轮已经有了却没拦住,死白区反而升到 ${avg(T, 'w2').toFixed(2)}%。**要给上限,不能只禁止动作。**

**验收判据**(跑完直接算,不靠感觉):死白区 ≤1% · R/B ≥1.10 · ①a/①b 不得比第二轮差。
**并且按 L5 的结论,第三轮每张至少跑 2 次取平均**,否则分不清是口令改进还是随机波动。

### 一句实话

你那四张参考图都是**原生拍得好**的 —— 景深是光学的、光是窗边自然光。
后期用 AI 追这种质感天然有上限,加出来的虚化和大光圈不是一回事。
第三轮值得试,但如果「相机质感」这条一直追不到,**把钱花在拍摄端(窗边位置 + 一块反光板 + 不用直射光)可能比修图更划算** —— 这是你那张参考05 自己说的。
`
writeFileSync(join(D, '第二轮翻车记录.md'), md)

const ok = L.明细.filter((r) => r.状态 === '✅')
const t = ok.map((r) => r.耗时ms).filter(Boolean)
writeFileSync(join(D, '第二轮成本耗时.md'), `# 12a 第二轮 · 成本与耗时

| | 值 |
|---|---|
| 模型 | B \`doubao-seedream-5-0-pro-260628\`(只跑 B,A 已淘汰) |
| 调用 | 50 次(主批 41 + L5 稳定性 9) |
| 成功 / 失败 | ${ok.length} / ${L.明细.length - ok.length} |
| 平均耗时 | **${(t.reduce((s, v) => s + v, 0) / t.length / 1000).toFixed(1)} 秒**(第一轮约 25 秒,这轮服务明显更慢) |
| 最慢 | ${(Math.max(...t) / 1000).toFixed(1)} 秒 |
| 单价 | ¥0.32 |
| **本轮花费** | **¥${L.花费元}** |

## 12a 累计

第一轮 ¥22.73 + 试跑与 PoC ≈ ¥8 + 第二轮 ¥${L.花费元} ≈ **¥${(22.73 + 8 + L.花费元).toFixed(0)}**,**上限 ¥60 未触及**。

## 按这个价推算实际用量

一张 ¥0.32,一天 20 张 ≈ ¥6.4,一个月 ≈ **¥190**。单价不是拦路虎。

🔴 **但仍然不是能上线的价** —— ①a 合计仍有 50%,死白和偏冷两条都没解决。

## 耗时对商家端的要求

单张 25–90 秒,且**同图两次结果会明显不同**(见 L5)。商家端必须:
1. 异步 —— 提交后先出原图,修好再替换,不能让技师干等;
2. 保留原图 —— 技师可能想重修一次或退回原图。
`)
console.log('  第二轮翻车记录.md / 第二轮成本耗时.md 已写')
