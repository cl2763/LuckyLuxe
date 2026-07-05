# Lucky Luxe AI Customer Service Rulebook

Last updated: 2026-07-03

This file is the engineering rulebook for the Lucky Luxe AI customer-service workflow. It is stricter than the general knowledge base: the knowledge base explains content; this rulebook defines state, routing, handoff, and regression locks.

## 中文版

本文件是 Lucky Luxe AI 客服工作流的工程规则手册。知识库负责解释“内容是什么”，本文件负责规定“系统如何判断、如何记忆、何时转人工、何时禁止回复、以及哪些测试必须锁住”。

### 1. 规则优先级

当规则冲突时，按以下顺序执行：

1. 安全、隐私、支付、医疗、退款、转人工边界。
2. Lucky Luxe 单店私有规则。
3. 当前对话的 working memory。
4. 顾客当前这句话。
5. 模型生成的话术风格。

模型不能覆盖结构化状态。例如状态已经是 `quoted`，就不能因为顾客又说一句时间而重新回到报价信息表，除非顾客明确发起了一个新的服务需求。

### 2. 平台知识与单店知识边界

平台预置知识可以包含通用美业流程、美甲/美睫基础知识、常见售后处理、常见客服语气和通用转人工规则。

Lucky Luxe 私有知识包括品牌语气、Ontario 门店信息、CAD 货币、服务价格、技师、排班、Silver/Gold/Platinum/Diamond 会员等级、定金规则、客户历史、订单、报价和作品图库。

会员规则不是平台预置知识，而是 Lucky Luxe 的单店私有知识。

### 3. 顾客身份与会员等级归一

新客永远先按 `Silver Member` 处理。

满足以下任一条件时，顾客是新客：

- 顾客上下文写明 新客、guest、visitor、new 或 游客；
- 积分、到店次数、累计消费为 0 或缺失，并且没有可信老客标记。

只有以下情况才算老客：

- 已持久化客户档案写明 returning/old member/老客；
- 积分、到店次数或累计消费大于 0；
- 可信账号档案里已有消费/预约历史。

如果 UI 发来冲突数据，例如 `新客 + Gold Member`，后端必须归一为：

- `customerType = new`
- `memberTier = silver`
- 不免定金
- 不显示指定技师等高级会员选项。

有效会员等级只有：Silver、Gold、Platinum、Diamond。

### 4. 服务类型与阶段判断

不要相信旧的模拟器阶段筛选作为对话真相。当前消息、working memory 和结构化客户资料共同决定阶段。

结构化服务字段优先级最高：

- `项目类型：美甲` => nail
- `项目类型：美睫` => lash

表单字段名不是事实。例如以下字段不能被当作顾客真实回答：

- `是否有断甲需要修补`
- `是否需要下睫毛`
- `是否需要卸甲`
- `是否指定技师`

只有顾客填写的值才是事实。空白字段必须保持 unknown，不能脑补。

### 5. 禁止瞎编

顾客没有回答的信息不能编造。

例子：

- 顾客没回答断甲修补，就不能说有断甲修补。
- 顾客没回答下睫毛，就不能说需要下睫毛。
- 顾客没给时间，就不能创建预约草稿。
- 技师没给价格，就不能编价格。
- 技师给了多个选项，AI 必须保留所有选项。

未知信息保持 unknown，直到顾客、技师或数据库提供。

### 6. 新客欢迎语

新客第一条 AI 回复必须走新客欢迎路径，不能用老客欢迎语。

默认中文欢迎语：

> 您好欢迎来到 Lucky Luxe，我是您的预约助手。您可以咨询美甲/美睫服务、价格规则、预约时间、定金和护理说明；如果是复杂美甲款式，也可以先发参考图，我会先帮您整理需求。

老客应该收到两条消息：

1. 固定欢迎语：`欢迎回来宝，有什么可以帮到您~`
2. 针对顾客刚刚那句话的上下文回复。

### 7. 报价工作流

美甲/复杂参考图使用结构化信息表。顾客不需要每项都填满；如果关键字段超过一半可判断，就可以交给技师报价。

美甲信息表：

1. 项目类型：美甲
2. 想做日期和时间：
3. 是否需要卸甲：
4. 是否需要延长：
5. 是否有断甲需要修补：
6. 是否有参考图：有的话请直接发图；没有也可以写“无图”
7. 其他备注：

贴钻、珍珠、复杂饰品等不作为必须前置问题。

美睫价格在服务和加项明确后可以固定报价，但仍需要确认款式、是否卸睫、是否下睫毛、预约日期时间，以及必要时的眼部敏感/不适情况。

如果顾客明确表示是第一次做美睫/第一次接睫毛，技师回价后 AI 需要紧接着追加一条“第一次做美睫须知”。须知应提醒：近期眼部手术、结膜炎/红肿/发炎/过敏或眼部不适需提前告知；第一次建议自然/轻盈款；到店当天避免睫毛膏或浓眼妆；操作中不适要立刻告诉技师；做完 6 小时内避免水汽、揉眼和油性卸妆、24 小时内避免桑拿汗蒸。不要额外加入用户未要求的佩戴用品提醒。

顾客之前在同一对话里发过图片时，任何报价任务都必须带上历史图片。顾客等待报价期间又发新图，也要追加到同一报价上下文。

技师回价后，AI 只能润色，不能漏掉关键信息；价格、时长、能否做、注意事项、多方案差异都要保留。

报价后统一出口：

> 如您需要预约，请回复“确认预约 + 想预约的日期和时间”，我会帮您查找可预约时间。

没有日期和时间，不能创建预约草稿。

### 8. 预约草稿工作流

创建预约草稿必须有：

- 服务类型；
- 已报价或固定服务信息；
- 日期；
- 时间；
- 技师或可预约排班。

只有日期不够。只有时间也不够，除非 working memory 已经有日期。

如果顾客要求的时间不可用：

- 必须在聊天框回复，不只是后台 toast；
- 如果超出营业时间，要说明营业时间；
- 给出当天最接近的可预约时间；
- 如果不合适，再询问是否接受附近日期。

这套预约逻辑同时适用于美甲和美睫。

### 9. 转人工规则

以下情况转人工：

- 取消/改期特殊情况；
- 退款/定金争议；
- 健康、过敏、不适；
- 投诉或售后质量问题；
- 顾客提出特殊安排，例如朋友一起做；
- 顾客问到知识库外的问题；
- AI 无法自信理解顾客意思。

如果是知识库外问题或 AI 不确定，不要瞎回，也不要告诉顾客“我帮您转人工”。后台静默标记为待人工即可。

人工在 Admin 回复后，AI 不得继续介入，直到人工明确交回 AI，或 10 分钟交回窗口到期后顾客又发新消息。

人工回复可以作为学习样本，但不能自动变成全局规则，必须经过 owner 审核。

### 10. 售后工作流

售后关键词包括：开胶、起翘、掉甲、断裂、掉钻、饰品脱落、掉色、色差、不满意、返修、掉睫、红肿、刺痛、过敏、投诉等。

已知售后场景：

- 先安抚和确认；
- 必要时询问服务日期和当前照片；
- 转给人工/店主判断；
- 不承诺退款、免费重做、赔偿或责任归属。

如果顾客只是表达喜欢、感谢、返图，没有明确需求，不要强行进入预约或报价。如果无法判断，静默转人工。

### 11. 对话记忆

每个对话必须维护 working memory：

- 顾客类型；
- 会员等级；
- 服务类型；
- 来源渠道；
- 语言；
- 当前工作流阶段；
- 已收集的表单字段；
- 历史图片；
- 报价状态；
- 技师报价内容；
- 日期/时间候选；
- 草稿链接状态；
- 人工接管状态；
- 未解决信息。

顾客分多句话回答时，系统要合并理解，不能要求所有信息必须出现在同一句里。

### 12. 测试锁

任何规则改完后，必须运行：

```bash
node apps/api/test-customer-service-matrix.mjs
```

矩阵至少要覆盖：

- 旧售后阶段 + 普通问候不误判；
- 新客欢迎语；
- 新客 + Gold/Plus 冲突归一为 Silver；
- 美甲表单空白断甲字段不误判；
- 美睫正常咨询不误判为售后；
- 已知售后转人工；
- 未知问题静默转人工；
- 特殊安排转人工；
- 报价任务带历史图片；
- 技师回价保留所有价格和时长；
- 只有日期不能创建草稿；
- 不可用时间返回最近可约时间；
- 人工接管时 AI 冻结；
- 人工交回后 AI 才能继续。

任何一条回归失败，都不能说完成。

## English Version

## 1. Rule Priority

When rules conflict, apply them in this order:

1. Safety, privacy, payment, medical, refund, and human-handoff boundaries.
2. Lucky Luxe tenant/private rules.
3. Current conversation working memory.
4. Current customer message.
5. Model-generated style or wording.

The model must not override structured state. If structured state says `quoted`, the assistant must not go back to the quote-intake form unless the customer sends a new unrelated service request.

## 2. Tenant Boundary

Platform preset knowledge can contain generic beauty-service workflows, common nail/lash concepts, general after-sales handling, and reusable customer-service style.

Lucky Luxe private knowledge includes:

- Lucky Luxe brand and tone.
- Ontario store placeholder and future real store data.
- CAD currency.
- Lucky Luxe service catalog and price table.
- Lucky Luxe technician list and schedules.
- Lucky Luxe membership names, thresholds, deposit rules, and benefits.
- Lucky Luxe customer history, order records, quote records, and gallery records.

Membership rules are not platform preset knowledge. They are Lucky Luxe private tenant knowledge.

## 3. Customer and Membership Normalization

New customers are always treated as `Silver Member`.

A customer is `new` when:

- simulator/customer context says 新客, guest, visitor, new, or 游客; or
- points/visit/spend data is zero or absent and no trusted returning-customer marker exists.

A customer is `returning` only when:

- persisted profile says returning/old member/老客; or
- points, visit count, or cumulative spend is greater than zero; or
- a trusted account profile has an existing customer history.

If the UI sends conflicting data such as `新客 + Gold Member`, backend normalization must resolve it to:

- `customerType = new`
- `memberTier = silver`
- no deposit waiver
- no advanced-member options such as designated technician.

Valid member tiers:

- Silver
- Gold
- Platinum
- Diamond

## 4. Service and Stage Inference

Do not trust stale simulator stage selectors as conversation truth. The current message, conversation memory, and structured customer profile decide the stage.

Explicit structured service fields win:

- `项目类型：美甲` => nail
- `项目类型：美睫` => lash

Form labels are not facts. Examples that must not be treated as customer facts:

- `是否有断甲需要修补`
- `是否需要下睫毛`
- `是否需要卸甲`
- `是否指定技师`

Only values provided by the customer are facts. Blank fields remain unknown.

## 5. No Hallucination

Never invent fields the customer did not answer.

Examples:

- If customer did not answer broken-nail repair, do not say 有断甲修补.
- If customer did not answer lower lashes, do not say 需要下睫毛.
- If customer did not provide time, do not create a booking draft.
- If staff reply does not include exact price, do not invent a price.
- If staff reply includes multiple options, preserve every option.

Unknown should stay unknown until the customer, staff, or database provides the value.

## 6. New-Customer Welcome

For a new customer, the first assistant response should use the new-customer welcome path. It must not use returning-member language.

Default Chinese welcome:

> 您好欢迎来到 Lucky Luxe，我是您的预约助手。您可以咨询美甲/美睫服务、价格规则、预约时间、定金和护理说明；如果是复杂美甲款式，也可以先发参考图，我会先帮您整理需求。

Returning customers should receive two messages:

1. Fixed welcome: `欢迎回来宝，有什么可以帮到您~`
2. Contextual response to the customer's actual message.

## 7. Quote Workflow

### 7.1 Nail Quote Intake

For nail/custom reference-image cases, use the structured intake template. The customer does not need to complete every field. If more than half of the key information is available, create a staff quote task.

Nail intake fields:

1. 项目类型：美甲
2. 想做日期和时间：
3. 是否需要卸甲：
4. 是否需要延长：
5. 是否有断甲需要修补：
6. 是否有参考图：有的话请直接发图；没有也可以写“无图”
7. 其他备注：

Do not ask about rhinestones/pearls/complex decorations as a required precondition.

### 7.2 Lash Quote/Booking Intake

Lash prices are fixed when service and add-ons are known, but AI still needs to ask:

- style/type,
- upper lashes,
- whether lower lashes are needed,
- whether removal is needed,
- date/time if the customer wants to book,
- eye discomfort/allergy/sensitivity only when relevant.

If the customer clearly says this is their first lash appointment, after the technician quote the AI must send a separate first-time lash notice. The notice should cover recent eye surgery, conjunctivitis/redness/inflammation/allergy or current eye discomfort, choosing a natural/lightweight first set, avoiding mascara/heavy eye makeup on appointment day, telling the technician immediately if there is stinging/fumes/tearing/discomfort, and aftercare for the first 6 and 24 hours. Do not add unrelated accessory-wearing advice unless the customer asks.

### 7.3 Historical Images

If a customer sent images earlier in the same conversation, every quote task must include those historical images even if the final triggering message has no image.

If the customer sends more images while a quote is waiting, append the new images to the same quote context or create an updated quote task that includes the full image history.

### 7.4 Staff Quote Reply

When staff sends a quote back to AI:

- AI should polish the reply.
- AI must preserve every key detail from staff.
- AI must not output the raw staff note separately.
- AI must not drop price, time, feasibility, warnings, or option differences.

Example staff note:

> 可以做，本甲120，延长200，大概3小时以内

Customer-facing reply must include all of:

- can do,
- natural nail option CAD 120,
- extension option CAD 200,
- about 3 hours.

### 7.5 Post-Quote Appointment Exit

After quote is returned, add a clear exit:

> 如您需要预约，请回复“确认预约 + 想预约的日期和时间”，我会帮您查找可预约时间。

Do not create a booking draft until date and time are both known.

## 8. Booking and Appointment Draft Workflow

Booking draft creation requires:

- service type,
- quoted or fixed service information,
- date,
- time,
- technician or available schedule slot.

Date-only is not enough. Time-only is not enough unless a date is already stored in working memory.

If requested time is unavailable:

- reply in chat, not only as a backend toast;
- mention business hours if the requested time is outside hours;
- offer the nearest available time on that date;
- if the nearest time does not work, ask whether nearby dates are acceptable.

This appointment logic applies to both nail and lash.

After a successful draft/payment in production, the system should be able to send a confirmation message containing service, date, time, store name, address, deposit/payment state, and reminder notes.

## 9. Human Handoff

### 9.1 Explicit Human Handoff

Route to human when:

- cancellation or reschedule exception,
- refund/deposit dispute,
- health/allergy/discomfort,
- complaint or after-sales quality issue,
- customer wants special arrangement such as bringing a friend together,
- customer asks something outside the knowledge base,
- AI cannot confidently understand the message.

### 9.2 Silent Handoff

If the message is outside the knowledge base and AI does not know how to answer, do not make up a reply and do not tell the customer "I will transfer you". Mark the conversation as needing human attention silently.

### 9.3 Manual Takeover

When staff manually replies in Admin, AI must not reply again until:

- staff explicitly returns control to AI; or
- a configured 10-minute handback window expires and the next customer message arrives.

The "instant transfer to human but let AI continue" simulator option must not trigger delayed AI aggregation during manual-takeover mode.

### 9.4 Learning from Manual Replies

Manual replies are valuable training data, but they are not automatically trusted global knowledge.

Flow:

1. Save the manual reply and linked conversation state.
2. Mark it as a candidate correction.
3. Owner reviews and approves.
4. Only then convert it to tenant rule, tone sample, FAQ, or workflow rule.

## 10. After-Sales Workflow

Known after-sales examples:

- 开胶, 起翘, 掉甲, 断裂 after service,
- 掉钻, 饰品脱落,
- 掉色, 色差,
- 不满意, 想返修,
- 掉睫, 红肿, 刺痛, 过敏,
- service complaint.

For known after-sales:

- acknowledge,
- ask for service date/order context and current photos if needed,
- route to human/staff,
- do not promise refund, free redo, compensation, or fault assignment.

If the customer only says thanks, likes the result, or sends a post-service photo without a clear request, do not force booking or quote logic. If unsure, silent handoff.

## 11. Conversation Memory

Every conversation must maintain working memory:

- customer type,
- member tier,
- service type,
- channel,
- language,
- current workflow stage,
- collected intake fields,
- image history,
- quote status,
- staff quote details,
- date/time candidates,
- draft link status,
- human takeover status,
- unresolved unknowns.

Working memory is updated after every customer, AI, and staff message.

When the customer answers across multiple messages, combine them. Do not require all information in one sentence.

## 12. Regression Lock

Before saying the rule work is complete, run the customer-service matrix:

```bash
node apps/api/test-customer-service-matrix.mjs
```

The matrix must cover at least:

- stale aftercare/stage selector with normal greeting,
- new customer welcome,
- new customer plus/gold conflict normalized to Silver,
- nail intake with blank repair field,
- lash normal inquiry not misclassified as after-sales,
- known after-sales routing,
- silent unknown handoff,
- special-arrangement human handoff,
- quote task with historical image,
- staff quote preserving all price and duration details,
- date-only blocking draft creation,
- unavailable time returning nearest available slot,
- human takeover freezing AI,
- manual release back to AI.

If any of these regress, do not hand off the build as complete.
