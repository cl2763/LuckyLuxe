/* 商家自助知识库的**匹配**(公约② 边改边拆:D145 后半要用知识库答体验类问题,
   就把「怎么在知识库里找到那一条」这件事从 `local-server.mjs` 搬出来)。

   两个匹配口,故意分开 —— 它们的**把关方向相反**:

   ① `matchTenantKbEntry`(原样搬出,一个字没改)
      用在**还没进任何采集流程**的时候:所以它带一道「像是服务/报价/预约的话就不接」的闸,
      免得抢了询单流程。原注释照录:「仅当消息不含服务/报价/预约意图时直答,避免抢占询单流程」。

   ② `matchKbForAnswer`(新)
      用在**已经在采集态、而且 `classifyTurn` 已经判定这一句是 `question`** 的时候。
      这时候「抢流程」的顾虑已经由分类器解决了 —— 顾客确实在问事,不是在给槽。
      如果这里还套那道闸,「睫毛会不会掉」这种句子会因为含「睫毛」被挡在门外,
      结果就是 D145 通二那个现象:顾客问效果,机器回「是否需要下睫毛?」。

   **两个口不合并**:合并就得在里面加一个「要不要过闸」的开关,
   而带开关的匹配器下一次一定有人传错 —— 分成两个函数,调用点自己说清用的是哪一种。 */

export function createKbMatch({ db, currentTenantId, compactIntentText }) {
  const rowsOf = (tenantId) => db
    .prepare('SELECT * FROM tenant_kb_entries WHERE tenant_id = ? AND enabled = 1 ORDER BY updated_at DESC')
    .all(tenantId || currentTenantId())

  const hit = (rows, text) => {
    const compact = compactIntentText(text)
    if (!compact) return null
    for (const row of rows) {
      const keywords = String(row.keywords || '').split(/[,，、/\s]+/).map((keyword) => keyword.trim()).filter(Boolean)
      if (keywords.some((keyword) => compact.includes(compactIntentText(keyword)))) return row
    }
    return null
  }

  // 商家自助 FAQ 匹配：仅当消息不含服务/报价/预约意图时直答，避免抢占询单流程。
  function matchTenantKbEntry(text = '') {
    const compact = compactIntentText(text)
    if (!compact) return null
    if (/美甲|美睫|睫毛|指甲|款式|参考图|报价|价格|多少钱|卸甲|延长|断甲|修补|预约|想约|要约|确认预约|nail|lash|quote|price|book/.test(compact)) return null
    return hit(rowsOf(), text)
  }

  /* 采集态里「先答再问」用的匹配:**不过那道意图闸**(理由见文件抬头)。
     取不到就回 null —— 调用方必须处理 null(说「我帮您问技师」),不许自己编一句。 */
  function matchKbForAnswer(tenantId, text = '') {
    return hit(rowsOf(tenantId), text)
  }

  return { matchTenantKbEntry, matchKbForAnswer }
}

/** D160 · 合并了就得**答全**(店主 05s §四,v4 通五现场)。
 *
 *  病因:FAQ 直答那条路拿**整段**去匹配,顾客一口气问了三件事,
 *  命中最后一句「停车」就直接 return —— 前两句一个字没答,而 05q 原文写的是「三问都答」。
 *
 *  三档,顺序不许调:
 *  ① 合并且**每句都有 FAQ** → 并起来一条条答;
 *  ② 合并但只答得上一部分 → **回 null 不许短路**,交给模型(那边有逐句指令兜着);
 *  ③ 没合并 → 照旧整句匹配。
 *  @returns {{answer_zh: string, answer_en: string}|null} */
export function mergedKbAnswer(parts, matchOne, whole) {
  const list = (parts || []).filter((x) => String(x || '').trim())
  if (list.length < 2) return matchOne(whole || '')
  const hits = list.map((p) => matchOne(p)).filter(Boolean)
  if (hits.length !== list.length) return null
  return {
    answer_zh: hits.map((e) => e.answer_zh).join('\n'),
    answer_en: hits.map((e) => e.answer_en || e.answer_zh).join('\n'),
  }
}
