# includes 子串盲 · 全仓扫描修正清单(31q 件2,2026-09-01)

**病根(J-族第三案)**:`includes('needle')` 的 needle 若是裸标识符/裸数字,会被**更长的串顶班** ——
'rules' 匹配 'rules-v2','48' 匹配 '148',改名 `d`→`dd` 后 'd.label' 照样绿。
判据绿着,守的东西早没了。31m 的 N4/N6 两把刀就是这么砍不红的。

## 扫描方法(两层,机械证据)

1. **粗扫**:全部 test-*.mjs 抠 `includes('…')` 裸标识符 needle → **215 个**(≤24 字符的 204 个)。
   原始输出:/tmp/includes-scan.txt(已归档 handoff/attachments 同名 txt)。
2. **阴影精扫**(本批新做):对每个 needle,到该套件读过的产物文件里数「阴影匹配」——
   needle 出现处左右任一侧紧贴 `[A-Za-z0-9_$]`(即被更长 token 包含)。
   **有阴影 = 刀砍真目标后阴影顶班,断言照绿。** 输出:/tmp/includes-shadow.txt。
   收敛到 **6 个嫌疑 needle**;逐条人工定案如下。

## 定案表

| needle | 断言处 | 定案 | 处置 |
|---|---|---|---|
| `'48'`(金额串) | test-amend-linkage:116 | **真盲**:amountText 含 '148'/'480' 也绿 | ✅ 改正则界定 `/(?:^|[^0-9])48(?:[^0-9]|$)/` |
| `'77'`(金额串) | test-deposit-audit:66 | **真盲**:同上('770'/'177' 顶班) | ✅ 同式界定(允许 '77.00' 的小数点) |
| `'d.label'` | test-noshow-aftersales:2927 | **半盲**:现在真匹配在,但改名 `dd` 后 'dd.label' 顶班 | ✅ 升为 `'label: d.label \|\|'` |
| `'goMall'` | test-noshow-aftersales:2515 | **半盲**:'goMallTimecards' 可顶班 | ✅ 升为属性界定 `bindtap="goMall"` |
| `'disabled'` | test-hours-gate:173 | **半盲**:innerHTML 里任何 disabled 类名都绿 | ✅ 升为 `/<button[^>]*\bdisabled/` |
| `'cancel'` | test-noshow-aftersales:1776 | **误报**:`acts()` 回数组,数组 `.includes` 是精确元素匹配 | ✔️ 可接受(理由:非字符串子串) |
| `'redeem'` | test-noshow-aftersales:2230 | **误报**:`G.includes` 解析的是夹具自家组合键,不是产物 | ✔️ 可接受 |
| `'order-badge badge-'` | test-noshow-aftersales:2338 | **故意前缀**:验的就是模板续写 `badge-${…}` 的发射点 | ✔️ 可接受(前缀判据是本意) |
| `'10:00'` | test-hours-gate:176 | **反向断言**:`!includes` 方向的盲=误红不误绿,fail-closed | ✔️ 可接受 |
| 其余 ~195 个 | 各处 | camelCase 长标识符/带连字符/带斜杠路径,天然界定,现无阴影 | ✔️ 可接受;新写作从此按下条规矩 |

## 编写规矩(立此为准,进回报模板)

**判据匹配必带界定。** 写 `includes` 前问一句:这个串被更长的串包含时,断言还该绿吗?不该,就上界定:
- 字符串字面量 → **引号闭合**:`includes("request('/admin/quote-settings')")` 而非 `includes('/admin/quote-settings')`
- HTML/WXML 控件 → **属性闭合**:`bindtap="goMall"`、`id="quoteSettingsBody"` 而非裸名
- 金额/数字 → **正则数字边界**:`/(?:^|[^0-9])48(?:[^0-9]|$)/` 而非 `includes('48')`
- 标识符 → 带上下文字符:`'label: d.label ||'` 而非 `'d.label'`
- 数组 `.includes` 是精确匹配,不在此列;反向 `!includes` 盲向安全,可从宽。

本批新写的 D91/裁定1 断言已全部按此规矩落笔(见 test-staff-portal.mjs 31q 块)。

## 顺手咬出的真缺陷(反例数据律的收获)

给 D91 写「畸形月份」探针时,`?month=2025-13` 直接把接口打炸 ——
**18 处** `/^\d{4}-\d{2}$/` 月份闸只验形不验域(13 月照放行,进日期构造 500)。
同类一次扫尽:local-server.mjs 全部 18 处换 `/^\d{4}-(0[1-9]|1[0-2])$/`,畸形月回落当月。
断言:staff-portal「D91 畸形月份不炸」常驻。
