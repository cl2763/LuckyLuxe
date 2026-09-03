import json, sys, io
def load(p):
    return json.load(io.open(p, encoding='utf-8'))
kw = load(sys.argv[1]); md = load(sys.argv[2])
KINDS = ['答', '反问', '转人工', '静默']
NAMES = {'A': 'A 含关键词(80)', 'B': 'B 同义不含关键词(80)', 'C': 'C 无关(40)'}
def row(d, b):
    g = d.get(b, {})
    return [g.get(k, 0) for k in KINDS]
print('| 组 | 门 | 答 | 反问 | 转人工 | **静默** |')
print('|---|---|---:|---:|---:|---:|')
for b in ['A', 'B', 'C']:
    for tag, d in [('关键词门(现状)', kw), ('**模型门(新)**', md)]:
        a, q, h, s = row(d, b)
        print(f'| {NAMES[b] if tag.startswith("关键") else ""} | {tag} | {a} | {q} | {h} | {"**" + str(s) + "**" if s else s} |')
ka = sum(row(kw, b)[0] for b in ['A', 'B']); kq = sum(row(kw, b)[1] for b in ['A', 'B'])
ma = sum(row(md, b)[0] for b in ['A', 'B']); mq = sum(row(md, b)[1] for b in ['A', 'B'])
ks = sum(row(kw, b)[3] for b in ['A', 'B']); ms = sum(row(md, b)[3] for b in ['A', 'B'])
kc = row(kw, 'C')[0] + row(kw, 'C')[1]; mc = row(md, 'C')[0] + row(md, 'C')[1]
print()
print('| 尺子(图 §五) | 门槛 | 关键词门 | **模型门** | 达标? |')
print('|---|---|---:|---:|:---:|')
print(f'| 范围内(A+B 共 160)被答或被反问 | ≥ 90% | {(ka+kq)/160:.1%} | **{(ma+mq)/160:.1%}** | {"✅" if (ma+mq)/160 >= 0.9 else "❌"} |')
print(f'| 范围内被**静默** | 越低越好 | {ks} 句 | **{ms} 句** | {"✅" if ms < ks else "❌"} |')
print(f'| 无关句(C 共 40)误答 | ≤ 2% | {kc/40:.1%} | **{mc/40:.1%}** | {"✅" if mc/40 <= 0.02 else "❌"} |')
