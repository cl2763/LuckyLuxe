import json, sys, io
def load(p): return json.load(io.open(p, encoding='utf-8'))
kw, md = load(sys.argv[1]), load(sys.argv[2])
KINDS = ['答', '反问', '转人工', '礼貌拒绝', '静默']

print('| 组 | 门 | ' + ' | '.join(KINDS) + ' |')
print('|---|---|' + '---:|' * len(KINDS))
NAMES = {'A': 'A 含关键词(80)', 'B': 'B 同义不含(80)', 'C': 'C 无关(40)'}
for b in ['A', 'B', 'C']:
    for tag, d in [('关键词门', kw), ('**模型门**', md)]:
        g = d.get(b, {})
        cells = ' | '.join(str(g.get(k, 0)) for k in KINDS)
        print('| %s | %s | %s |' % (NAMES[b] if tag == '关键词门' else '', tag, cells))
