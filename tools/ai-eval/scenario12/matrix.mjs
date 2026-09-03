/* 12 场景矩阵 —— 店主 04d §三 定稿,一字不改地照抄成数据。
   `want` = **事先写好的预期 source**:'模型' / 'quote_intake_*' / '静默' / 'tenant_kb' / '规则' */
export const INTAKE_NAIL = '1. 项目类型:美甲\n2. 想做日期和时间:明天下午三点\n3. 是否需要卸甲:需要\n4. 是否需要延长:不需要\n5. 是否有断甲需要修补:没有\n6. 是否有参考图:无图\n7. 其他备注:无'
export const INTAKE_LASH = '1. 项目类型:美睫\n2. 想做日期和时间:明天下午三点\n3. 是否第一次做美睫:是\n4. 是否需要下睫毛:否\n5. 眼部是否有不适:否\n6. 是否有参考图:无图\n7. 其他备注:无'

export const MATRIX = [
  { id: 'A1', group: 'A · 模型答、带历史', shop: 'flagship', lang: 'zh', turns: [
    { say: '你们几点关门?', want: '模型' },
    { say: '周日开吗?', want: '模型', note: '要记住上一轮说的是营业时间' },
    { say: '定金多少?能退吗?', want: '模型', note: '定金规则注入' },
    { say: '那我改天再来', want: '模型或静默', assert: '不建报价单、状态不变' },
  ] },
  { id: 'A2', group: 'A · 模型答、带历史', shop: 'mirror', lang: 'en', turns: [
    { say: 'What time do you close?', want: '模型' },
    { say: 'Are you open on Sunday?', want: '模型' },
    { say: 'How much is the deposit? Is it refundable?', want: '模型' },
    { say: "I'll come another day then", want: '模型或静默', assert: '不建报价单;回复语言=en' },
  ] },
  { id: 'A3', group: 'A · 模型答、带历史', shop: 'mirror', lang: 'zh', fixture: 'doneBooking', turns: [
    { say: '你好', want: '规则或模型', note: '老顾客回访欢迎' },
    { say: '上次那款还能做吗?', want: '模型', note: '要引用 working memory 里的历史订单' },
    { say: '地址发我一下', want: '模型' },
  ] },
  { id: 'A4', group: 'A · 模型答、带历史', shop: 'flagship', lang: 'zh', fixture: 'kb2', turns: [
    { say: '你们那儿好停车吗?', want: 'tenant_kb 或模型' },
    { say: '地下几层?', want: '模型或 kb', assert: '不瞎编,答不了就转人工' },
    { say: '你觉得今天天气怎么样', want: '静默', assert: 'reply=null、status→needs_human' },
  ] },

  { id: 'B1', group: 'B · 模型意图喂状态机', shop: 'mirror', lang: 'zh', turns: [
    { say: '想弄一下手,不知道做什么', want: '模型', note: '判据锚 intent,mock 与真模型可能不同' },
    { say: '想做渐变猫眼,有参考图的感觉', want: '规则(采集)', assert: 'handoffRequired' },
    { say: INTAKE_NAIL, want: 'quote_intake_state', assert: '状态 needs_human、报价单落小婕店' },
  ] },
  { id: 'B2', group: 'B · 模型意图喂状态机', shop: 'flagship', lang: 'zh', turns: [
    { say: '明天下午三点有空吗?', want: '模型' },
    { say: '要定金吗?', want: '模型' },
    { say: '那先约着', want: '模型或规则', assert: '不建报价单' },
  ] },
  { id: 'B3', group: 'B · 模型意图喂状态机', shop: 'mirror', lang: 'zh', turns: [
    { say: '上次做的掉了一片', want: '规则(售后)', assert: '转人工' },
    { say: '大概多久有人回我?', want: '静默', assert: '不再触发模型' },
  ] },
  { id: 'B4', group: 'B · 模型意图喂状态机', shop: 'flagship', lang: 'zh', turns: [
    { say: '你们太贵了服务也差', want: '模型或静默', assert: 'handoffRequired' },
    { say: '算了我不来了', want: '静默', assert: 'status 不回退到 ai_replied' },
  ] },

  { id: 'C1', group: 'C · 规则层带历史、跨段', shop: 'mirror', lang: 'zh', turns: [
    { say: '想做美甲多少钱', want: 'quote_intake_template' },
    { say: INTAKE_NAIL, want: 'quote_intake_state' },
    { staffQuote: '这个款式 198,大概两小时', want: 'staff_quote_polished(模型润色)' },
    { say: '好的,周六可以吗?', want: '规则或静默', assert: 'quoted 段:不重新采集' },
  ] },
  { id: 'C2', group: 'C · 规则层带历史、跨段', shop: 'flagship', lang: 'zh', turns: [
    { say: '想做美甲多少钱', want: 'quote_intake_template' },
    { say: INTAKE_NAIL, want: 'quote_intake_state' },
    { staffQuote: '这个款 198', want: 'staff_quote_polished(模型润色)' },
    { ageQuote: 50, want: '(造态:把报价推过 48h)' },
    { say: '同款现在多少钱?', want: '规则或模型', assert: '不复用旧价' },
  ] },
  { id: 'C3', group: 'C · 规则层带历史、跨段', shop: 'mirror', lang: 'zh', turns: [
    { say: '你好', want: '规则或模型' },
    { takeOver: true, want: '(人工接管)' },
    { say: '你们几点关门?', want: '静默', assert: '人工中不答' },
    { releaseToAi: true, want: '(归还 AI)' },
    { say: '你们几点关门?', want: '模型' },
  ] },
  { id: 'C4', group: 'C · 规则层带历史、跨段', shop: 'flagship', lang: 'zh', turns: [
    { say: '想做美甲多少钱', want: 'quote_intake_template' },
    { say: INTAKE_NAIL, want: 'quote_intake_state' },
    { staffQuote: '这个款 198', want: 'staff_quote_polished(模型润色)' },
    { ageQuote: 20, want: '(造态:隔天)' },
    { say: '你们店地址在哪?', want: '模型' },
    { say: '上次那个报价还算数吗?', want: '规则或模型', assert: '引用旧报价单号/状态,不新建' },
  ] },
]
