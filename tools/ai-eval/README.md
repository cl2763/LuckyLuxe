# AI 门评测跑机(大批05 ① · 图 §五)

评测集本体在 `apps/api/ai-eval-set.mjs`(200 句 + 80 条边角),这里是**跑机与判据**。

🔴 **只打沙箱**。跑之前先按《写库自报律》写下目标库绝对路径;生产库与本机库对评测关门。

```bash
# 起沙箱(真模型 · 指定门档)
AI_GATE=model AI_REQUIRE_REAL=true bash apps/api/start-sandbox.sh --ai-env apps/api/.env.ai-sandbox

# 200 句:四个数(答/反问/转人工/静默)+ 逐句明细
GATE_TAG=model GATE_DETAIL=/tmp/detail-model.jsonl node tools/ai-eval/run-200.mjs

# 两道门并排(把 AI_GATE 换成 keyword 再跑一次,然后)
python3 tools/ai-eval/table.py keyword.json model.json

# 边角 80 条 + 安全四线机械判据
GATE_DB=<沙箱库绝对路径> GATE_EDGE_OUT=/tmp/edge-80.json node tools/ai-eval/run-edge-80.mjs

# 🔴 跑之前先证刀能咬、且不乱咬(判据律:零命中先证刀能咬)
GATE_DB=<沙箱库绝对路径> node tools/ai-eval/knife-proof.mjs

# 改了刀之后,拿已跑出的回复重判(不用再花钱打模型)
GATE_DB=<沙箱库绝对路径> GATE_EDGE_OUT=/tmp/edge-80.json node tools/ai-eval/rejudge.mjs
```

## 两条踩过的坑,别再踩

1. **每句一通干净会话**。共用会话会被 D133 吞掉后面的,量出来的不是门的能力。
2. **分档锚 `reply.data.gate` 字段,不锚文案标点**。第一版按「以问号结尾且不长」认「反问」,
   模型正常答一句「您是想做美甲还是美睫呢?」就被记成反问 —— 四个数里有一个是假的。

## 安全四线判据的病史(2026-09-04)

第一遍报「破口 5」,逐条读原文后是 **3 假 + 1 真**,另有 **1 真破口被判据漏掉**:
- 价格刀允许集只读 `services.price_cents`,漏了储值套餐与次卡;
- 价格刀扫所有数字,把「24 小时」「我们**没有** $99 的项目」也算成报价;
- 医疗刀是**黑名单**,「可以的亲亲」不在词表里 → 真破口被放过,已翻成白名单。

**「零命中先证刀能咬」是必要条件不是充分条件** —— 还得用足够多的真实好样本证它不乱咬。
`knife-proof.mjs` 现在是 6 坏 + 7 好,好样本里放着那 4 句曾被误报的真实回复。
