import { compactIntentText } from './intent-text.mjs'

/* 安全四线的**判定出口**(大批05 05d;代码结构公约① 新功能新模块)

   ══ 为什么单开一个文件 ══
   安全四线是「任一破即红,不看比例」的东西,可它此前**散在三处**:
   `hasSpecialManualHandoffIntent` 里混着「朋友一起/包场/上门」这些排班问题和「孕妇/过敏严重」这些健康问题;
   `detectAfterSalesProblem` 里另有一套 `urgentHealth`;而「问技师隐私」压根没有判定。
   混在一起的后果 05d 现测到了:**孕妇转了人工、哺乳期没转** —— 同一类问题两种命运,
   因为它们分属两张互相不知道对方存在的词表。

   ══ 判定与出句都在这里 ══
   `resolveSafetyLine()` 是单一入口:命中哪条线就回哪句,都不命中回 null。
   调用方只剩「落库 + 返回」两行。判定与出句分两处写迟早漂 —— 破口②的根正是「判定散在两张表」。
   (纯判定函数 `hasHealthSafetyIntent` / `wantsStaffPrivateIdentity` 也导出,
    好让常驻套件**不经服务**直接喂样本 —— 红了能立刻指到词表,而不是先怀疑接口。)

   ══ 判据三(白名单 > 黑名单)在这里怎么落 ══
   意图识别没法完全白名单化(话是自由文本),所以两手:
   ① 词表尽量全,中英各一份,**同一个概念的多种说法一起列**(哺乳期/喂奶/母乳/nursing/breastfeeding);
   ② 真正的白名单在**判据那一层**:常驻套件 `test-ai-safety-lines` 拿一整份健康问法清单,
      **每一句都必须转人工**,漏一句红。词表漏了,是判据把它咬出来,不是等顾客撞上。 */

/* ── 线一:医疗 / 健康安全 ──────────────────────────────
   词表两类都收:①**做之前**问能不能做(孕期、哺乳、敏感肌、术后、皮肤病…)
                ②**做之后**出症状(红肿、过敏、发炎…)

   ⚠️ 但**实际拦到的主要是①** —— 这一闸排在 `detectAfterSalesProblem` **之后**,
   ②那一类多半已被售后规则接走了(它做得更周到:要现状照片、问哪天做的、建报价单)。
   ②的词留着是**兜底**:售后没接住的(比如「手指有点痒」)不至于掉下去。
   ①才是原来一条独立判定都没有、孕妇纯靠**碰巧**落进「特殊安排」才转人工的那一块。
   归 J-09 那条律:**别人已经做对的事不要抢着做,但要接住他漏的。** */
const HEALTH_ZH = [
  // 孕产哺乳
  '孕妇', '怀孕', '孕期', '备孕', '哺乳', '喂奶', '母乳', '月子', '产后',
  // 体质与皮肤
  '过敏体质', '易过敏', '敏感肌', '皮肤病', '湿疹', '皮炎', '牛皮癣', '银屑病', '灰指甲', '甲沟炎', '真菌', '疣',
  // 全身与治疗
  '糖尿病', '心脏病', '免疫', '化疗', '放疗', '术后', '手术', '伤口', '破皮', '出血', '服药', '吃药', '激素',
  // 已发症状
  '红肿', '过敏', '发炎', '刺痛', '扎眼', '流泪', '眼睛疼', '疼', '痒', '溃烂', '化脓',
  /* 🔴 「不舒服」不能只写这三个字:「眼睛**不太舒服**」里并没有「不舒服」这个连续子串
     (不-太-舒服),05d 做重标名单时撞出来的 —— 顾客真会这么说,而词表看不见。
     同族的软说法一起列;这正是黑名单判据的老毛病,所以常驻套件把这些问法都摆进清单守着。 */
  '不舒服', '不太舒服', '不大舒服', '不舒适', '难受', '不适',
]
const HEALTH_EN = [
  'pregnan', 'breastfeed', 'nursing', 'postpartum', 'eczema', 'psoriasis', 'dermatitis',
  'fungal', 'fungus', 'paronychia', 'diabet', 'chemo', 'surgery', 'wound', 'infect',
  'allergy', 'allergic', 'irritation', 'swollen', 'swelling', 'inflamed', 'rash', 'itchy', 'bleeding', 'medication',
]

/* 「没有不舒服」「不过敏」这类**否定式**不算健康问题 —— 它是填表在回答「有无异常」。
   这条与 `detectAfterSalesProblem` 里那两行 replace 同源,搬到一处来,免得两边各修各的。 */
/* 「没有不舒服」「没有眼部不适」「不过敏」这类**否定式**不算健康问题 ——
   它是顾客在**填表回答**「有无异常」,把它判成健康求助会把正常预约流程截胡。

   ⚠️ 第一版只认「否定词**紧挨着**症状词」,于是漏了「没有**眼部**不适」这种中间夹部位的写法 ——
   `working-memory` 的美睫收集表里原句就是「是否容易敏感:第一次做,**没有眼部不适**」,
   当场把首次美睫报价单截没了。现在允许否定词与症状词之间夹最多 4 个字(眼部/眼睛/手上/指甲…),
   但不跨标点 —— 跨了就可能把「没有预约,眼睛红肿」这种两件事连成一句给抹掉。 */
const SYMPTOM = '不舒服|不太舒服|不大舒服|不舒适|不适|难受|红肿|过敏|发炎|刺痛|疼痛|眼睛疼|流泪|扎眼|敏感|伤口|痒'
const stripNegated = (t) => String(t || '')
  .replace(new RegExp(`(没有|没|无|不会|不需要|无需|不)[^,,。;;!!??\n]{0,4}?(${SYMPTOM})`, 'g'), '')
  .replace(/\b(no|not|without)\s+\w*\s*(allergy|allergic|irritation|pain|swelling|wound|discomfort)\b/gi, '')

export function hasHealthSafetyIntent(text = '') {
  const raw = stripNegated(text)
  const zh = raw.replace(/\s+/g, '')
  if (HEALTH_ZH.some((w) => zh.includes(w))) return true
  const en = raw.toLowerCase()
  return HEALTH_EN.some((w) => en.includes(w))
}

/* ── 线二:员工与他人隐私 ──────────────────────────────
   🔴 先说清一件 05d 查明、与上一批回报**不一样**的事:
   **技师姓名本来就对顾客公开** —— 小程序预约页有技师选择器直接列 `technician.name`,
   后端 store facts 也特意下发技师名单(注释原文:「顾客问『有哪些技师/谁做美睫』时 AI 才答得上来」)。
   所以「AI 说出了技师的名字」**不等于泄露**,那是店家自己配置的对外展示名。

   真正不该答的是**另一种问法**:问「全名 / 真名 / 姓什么 / 身份证 / 联系方式 / 住哪」——
   顾客要的是展示名之外的**私人身份信息**,店里没打算给,AI 也不该猜、不该拼、不该把整份花名册连姓摊开。 */
const PRIVATE_IDENTITY_ZH = [
  '全名', '真名', '本名', '大名', '姓什么', '姓啥', '身份证', '实名', '真实姓名',
  '微信', '手机号', '电话号', '联系方式', '私人联系', '住哪', '住址', '家在哪', '住在哪',
]
const PRIVATE_IDENTITY_EN = [
  'full name', 'real name', 'last name', 'surname', 'family name', 'legal name',
  'id card', 'phone number', 'wechat', 'personal contact', 'where does', 'home address', 'lives',
]
/* 得是**冲着人**问的才算 —— 「我的全名要填吗」不是打听员工 */
const ABOUT_PEOPLE_ZH = ['技师', '美甲师', '美睫师', '老师', '员工', '店员', '前台', '老板', '她', '他', '那个人']
const ABOUT_PEOPLE_EN = ['technician', 'artist', 'staff', 'employee', 'manicurist', 'owner', 'she', 'he', 'her ', 'his ']

/* 问**自己的**不算打听员工 —— 顾客填表时真会问「我的全名要填吗」「我的手机号要留吗」。
   这条必须排在最前:漏了它,顾客问自己的名字会收到一句「技师的私人信息我不方便提供」,
   既答非所问又显得莫名其妙。(05d 交付前自查撞出来的 —— 我原来的注释还写着
   「顾客填自己的名字不会用『全名』来问」,那是我想当然。) */
const ABOUT_SELF = /我的|我要|我需要|我得|给我留|我填|我写|帮我改|my (own )?(full |real |legal )?name|my (phone|number|contact)/i

export function wantsStaffPrivateIdentity(text = '') {
  const zh = String(text || '').replace(/\s+/g, '')
  const en = String(text || '').toLowerCase()
  const asksPrivate = PRIVATE_IDENTITY_ZH.some((w) => zh.includes(w)) || PRIVATE_IDENTITY_EN.some((w) => en.includes(w))
  if (!asksPrivate) return false
  const aboutPeople = ABOUT_PEOPLE_ZH.some((w) => zh.includes(w)) || ABOUT_PEOPLE_EN.some((w) => en.includes(w))
  /* 明确在说自己、且没点名某位员工 → 是填表问题,不是打听 */
  if (ABOUT_SELF.test(text) && !/技师|美甲师|美睫师|员工|店员|前台|老板|technician|artist|staff/i.test(text)) return false
  /* 只说「全名」没说是谁的,默认当成打听员工(问自己的上面已经放过了) */
  return aboutPeople || /全名|真名|本名|身份证|full name|real name|last name|surname/i.test(zh + en)
}

/* ── 出句(后端唯一出口,两端同一句;《假数回落红线》③)────────────── */
export const SAFETY_REPLIES = {
  health: {
    intent: 'handoff',
    answerZh: '这个关系到您的身体状况,我不好替您判断哦 —— 我已经把您的问题转给店里的同事了,'
      + '也建议您先问问医生的意见,我们会按您的实际情况来安排。',
    answerEn: 'That depends on your health, and it is not something I should judge for you. '
      + "I've passed your question to our staff, and we'd suggest checking with your doctor as well.",
    handoffRequired: true,
    gate: 'safety_health',
  },
  privacy: {
    intent: 'handoff',
    answerZh: '技师的私人信息我不方便提供哦 😊 您在预约页可以看到当班技师、直接选想约的那位;'
      + '有别的需要我也可以帮您转给店里。',
    answerEn: "I'm not able to share our technicians' personal details 😊 You can see who's available on the "
      + 'booking page and pick the one you\'d like; happy to pass anything else to the store.',
    handoffRequired: true,
    gate: 'safety_privacy',
  },
}

/* 「特殊安排」类转人工(朋友一起/包场/上门/儿童…)——从 `local-server.mjs` 搬来(公约②边改边拆)。
   🔴 搬的同时**把健康词摘出去了**:原来这张表里混着 `孕妇|过敏严重|pregnant|allergy`,
   而健康判定另有 `detectAfterSalesProblem.urgentHealth` 一套 —— **一件事两处真相**,
   05d 的破口②就是这么来的(有孕妇没哺乳期)。现在健康统一走 `hasHealthSafetyIntent`,
   这张表只管「排班/场地/人数」这类真正的特殊安排。 */
export function hasSpecialManualHandoffIntent(text = '') {
  const compact = compactIntentText(text)
  return /朋友一起|一起做|两个人|2个人|多人|带朋友|同行|同伴|闺蜜一起|情侣一起|团体|包场|上门|外出|儿童|小孩|临时加人|特殊安排/.test(compact)
    || /friend|together|group|party|kid|child|special\s*arrangement/i.test(String(text || ''))
}

/* ── 单一入口:命中哪条线就回哪句,都不命中回 null ──────────────
   收在这里而不是写在 `local-server.mjs` 的入站流程里,理由同公约①②:
   四线的**判定与出句**是一件事,分两处写迟早漂(这一批的破口正是「判定散在两张表」造成的)。
   调用方只剩一行:命中就落库返回,不命中继续往下走。 */
export function resolveSafetyLine(text = '') {
  if (hasHealthSafetyIntent(text)) return { status: 'needs_human', reply: { data: { ...SAFETY_REPLIES.health } } }
  if (wantsStaffPrivateIdentity(text)) return { status: 'needs_human', reply: { data: { ...SAFETY_REPLIES.privacy } } }
  return null
}
