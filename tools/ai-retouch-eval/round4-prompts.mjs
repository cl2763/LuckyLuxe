/* 12a 第四轮口令 · 曝光维 × 甲面色调维(12d补 §二 + §七)
 *
 * 结构(顺序照 §二:色温句与甲色句在前,手部句在后):
 *   通用前缀「绝对不改」 + 曝光桶句(A/B/C) + 甲面色调句(深/浅) + 手部句 + 输出句
 *
 * 🔴 §七-1:曝光桶改看**手框均亮**(皮肤),不再看全图 ——
 *    实测:02 号全图 78.9 但手框 147.3(黑甲黑裤把全图拉低),23 号全图 88.3 但手框 62.1(亮缎把全图拉高)。
 *    而且第三轮五张的「模型实际提亮幅度」与手框均亮**秩相关 −1.000**(全图均亮只有 −0.600)。
 * 🔴 §二:「冷」「白净」只许落在「手部皮肤」这个宾语上。
 *    §二 定死的手部句里**没有「冷」字**(§一-5 提过「略偏冷」,§二 句式没写)——
 *    这里**逐字用 §二 的句式,不自己补「冷」**:上两轮全局冷字把 28 号墨绿改成天蓝,代价太大。
 */
import { PREFIX, SUFFIX } from './bucket-prompts.mjs'
export { PREFIX, SUFFIX }

/* 曝光维 —— 与第三轮同,一字不动(第三轮已验:色温句有效,提亮句无效但不是这几句的错) */
export { PRESET_A as EXPO_A, PRESET_B as EXPO_B, PRESET_C as EXPO_C } from './bucket-prompts.mjs'

/* 甲面色调维(§七-3,逐字照令) */
export const TONE_DARK = `指甲是深色系,保持深色的饱和与通透,甲面不许提亮、不许发灰发雾,高光只保留原图本来的反光。`
export const TONE_LIGHT = `指甲是浅色/透明系,保持通透感,甲面不许变白变浊、不许糊成一片,蕾丝/钻/珠等细节逐一保留。`

/* 手部句(§二 句式固定,逐字照令) */
export const HAND = `手部皮肤轻度磨皮,肤色比原图略白净一点点,不许假白;甲色、甲面高光、整体色温仍以原图为准。`

/* 背景句(§三-3)—— §四:背景句里不许出现「冷」「白」「亮度」「曝光」四词 */
export const BG_KEEP = `只改背景,手与指甲的每一处细节、位置、形状、颜色都不变。`
export const BACKGROUNDS = {
  虚化: `背景换成大光圈浅景深的柔和虚化,只有层次和空气感,没有可辨认的物体。`,
  窗边: `背景换成窗边自然光下的室内环境,有柔和的光影过渡和真实的空间纵深。`,
  暗调: `背景换成深色低调的环境,沉稳厚重,保留暗部层次不死黑。`,
  道具: `背景换成杂志、干花或布料这类静物衬托,构图简洁不抢主体。`,
  影棚: `背景换成均匀的纯色影棚背景,没有杂物没有纹理。`,
}

/* ── 组装 ── */
export const bucketOfSkin = (手框均亮, p95, 全图均亮) => {
  if (手框均亮 == null) return null          /* 取不到就报 null,不许静默当 B */
  if (手框均亮 < 70) return 'A'
  if (p95 > 240 && 全图均亮 > 140) return 'C'
  return 'B'
}
const EXPO = { A: null, B: null, C: null }   /* 运行时填,见下 */
import { PRESET_A, PRESET_B, PRESET_C } from './bucket-prompts.mjs'
EXPO.A = PRESET_A; EXPO.B = PRESET_B; EXPO.C = PRESET_C

export const handPromptFor = (bucket, tone) =>
  PREFIX + EXPO[bucket] + (tone === '深' ? TONE_DARK : TONE_LIGHT) + HAND + SUFFIX

/* ── 判据(§七-5 + §四)── */
export const HAND_MUST_PRESENT = [
  '手部皮肤轻度磨皮', '肤色比原图略白净一点点', '不许假白',
  '甲色、甲面高光、整体色温仍以原图为准',
  '指甲区域的颜色、明暗、反光一律保持原样',
]
export const TONE_MUST = { 深: ['不许提亮'], 浅: ['通透'] }   /* §七-5 点名的两条 */
export const BG_MUST_GONE = ['冷', '白', '亮度', '曝光']       /* §四 点名的四词 */
export const BG_MUST_PRESENT = ['只改背景', '手与指甲的每一处细节、位置、形状、颜色都不变']

/* ═══════════ 12d 补二:改两处自相矛盾 ═══════════
 * 矛盾一(P1 手部):EXPO 里「保留真实纹理和指节褶皱,不做平涂」 vs HAND 的「轻度磨皮」——
 *   同一条口令既要保纹理又要磨皮,和第一轮「绝对不改甲色 vs 冷白皮」是同一种病。
 * 矛盾二(P2 背景):PREFIX 的「同一背景」「背景内容和构图不改」 vs BG_KEEP 的「只改背景」;
 *   而且色温句根本没进背景口令。
 *
 * 🔴 一处按补二 §一 的可推定读法处理并记入假设:
 *   令说「这一分句整句换成 HAND 句」。若原地替换**又**在末尾追加 HAND,HAND 会出现两次;
 *   若原地替换而不追加,HAND 就跑到色温句**之前**,违反 12d补 §二「手部句在色温句之后」。
 *   **取法**:把矛盾分句从 EXPO 里**删掉**,HAND 仍按原位置追加在末尾 ——
 *   结果等价(矛盾消失、HAND 出现一次)且保住了 §二 的语序。
 */

/* P1b 用:把「保留…真实纹理…不做…平涂」那一分句删掉,其余逐字不动 */
export const EXPO_A_HAND = PRESET_A.replace('清理皮肤上的杂质和指缝暗角,保留皮肤真实纹理和指节褶皱,不做平涂', '清理皮肤上的杂质和指缝暗角')
export const EXPO_B_HAND = PRESET_B.replace('皮肤干净通透,保留真实纹理和指节褶皱,不做美白平涂', '皮肤干净通透')
const EXPO_HAND = { A: EXPO_A_HAND, B: EXPO_B_HAND, C: PRESET_C }
export const handPromptForP1b = (bucket, tone) =>
  PREFIX + EXPO_HAND[bucket] + (tone === '深' ? TONE_DARK : TONE_LIGHT) + HAND + SUFFIX

/* P2 用:BG_PREFIX = PREFIX 删掉「同一背景」与「背景内容和构图不改」,「画面比例与原图一致」保留 */
export const BG_PREFIX = PREFIX
  .replace('、同一背景', '')
  .replace('背景内容和构图不改;', '')
/* 色温句 = 第三轮那句,逐字取自 PRESET_A */
export const COLORTEMP = '白平衡以原图为准,保留原图本来的暖调,不做色温校正。'

/* ── 矛盾对检查(补二 §二):同一宾语不许同时出现「不改/不变」与「换/改」 ── */
export const CONTRADICTIONS = [
  { 宾语: '背景', 不变: ['同一背景', '背景内容和构图不改'], 要改: ['只改背景', '背景换成'] },
  { 宾语: '皮肤纹理', 不变: ['保留皮肤真实纹理', '保留真实纹理', '不做平涂', '不做美白平涂'], 要改: ['磨皮'] },
  { 宾语: '甲色', 不变: ['指甲区域的颜色、明暗、反光一律保持原样', '甲色、甲面高光、整体色温仍以原图为准'], 要改: ['改变甲色', '甲色调整为', '把指甲颜色'] },
]
export const findContradictions = (text) => CONTRADICTIONS.flatMap((c) => {
  const a = c.不变.filter((x) => text.includes(x)), b = c.要改.filter((x) => text.includes(x))
  return (a.length && b.length) ? [`${c.宾语}:「${a[0]}」 vs 「${b[0]}」`] : []
})

export const bgPromptFor = (bucket, tone, bgKey) =>
  BG_PREFIX + COLORTEMP + BG_KEEP + BACKGROUNDS[bgKey] + SUFFIX
