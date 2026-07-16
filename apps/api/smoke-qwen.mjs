#!/usr/bin/env node
// Lucky Luxe — 真实 Qwen 冒烟测试(十几条对话验措辞)
//
// 为什么单独一个脚本:回归套件(test-*.mjs)跑在 mock 模式,锁的是"行为/结构";
// 这个脚本走真实 AI 通道,验的是"措辞是否正常、有没有幻觉、静默转人工对不对"。
//
// 用法:
//   本地(Mac,有 .env + 外网,最真实):
//     cd apps/api
//     set -a && . ./.env && set +a           # 载入真实 AI_API_KEY / AI_PROVIDER
//     PORT=4000 node local-server.mjs &       # 起服务器(真实 Qwen)
//     SMOKE_BASE_URL=http://127.0.0.1:4000 node smoke-qwen.mjs
//
//   直接打生产(www.luckyluxeatelier.com,验证云端 Qwen 是否真的在线):
//     SMOKE_BASE_URL=https://www.luckyluxeatelier.com node smoke-qwen.mjs
//
// 判读:
//   - reply.provider 必须是 "openai-compatible"(= 真实 Qwen)。若是 "mock",
//     说明真实通道没生效(key 缺失/网络不通/AI_REQUIRE_REAL 未开)——冒烟不算过。
//   - 每条对话下方的自动检查是"软提示"(LLM 措辞会变),最终仍需人眼扫一遍中文回复。

const BASE_URL = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '')
const ENDPOINT = `${BASE_URL}/ai/customer-service`

const C = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m' }
const tally = { turns: 0, provider_real: 0, provider_mock: 0, warns: 0, errors: 0 }

async function ask({ message, history, customerType }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, lang: 'zh', history, customerType })
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`)
  const body = await res.json()
  return body.reply || body
}

// 每个场景:一串顾客消息 + 若干"看点"检查函数。检查函数返回 null=通过,或字符串=警告。
const scenarios = [
  {
    name: '① 新客美甲询单 — 不能瞎报最终价,要引导技师报价',
    customerType: 'new',
    turns: [
      { msg: '你好，我想做美甲' },
      {
        msg: '想做延长做个法式，下周六下午两点可以吗',
        checks: [
          (d) => /技师|报价|人工/.test(d.answerZh) || d.handoffRequired ? null : '未提到技师报价/未转人工(自定义美甲应交技师报价)',
          (d) => /(总共|一共|合计)\s*\$?\s*\d/.test(d.answerZh) ? '疑似给出了 AI 最终总价(应只给基础价+技师报价,不给最终价)' : null
        ]
      }
    ]
  },
  {
    name: '② 营业时间问询 — 回归 7/4 贪婪意图 bug:不能回美甲询单模板',
    customerType: 'new',
    turns: [
      {
        msg: '你们几点关门？周一开门吗',
        checks: [
          (d) => /是否需要卸甲|是否需要延长|参考图|项目类型/.test(d.answerZh) ? '❌ 触发了美甲询单模板(应直接回营业时间)' : null,
          (d) => /\d{1,2}[:：]\d{2}|营业|周[一二三四五六日]|休息|开门|关门/.test(d.answerZh) ? null : '回复里没看到营业时间信息'
        ]
      }
    ]
  },
  {
    name: '③ 售后翘边 — 温和 + 转人工,不承诺退款/免费重做',
    customerType: 'returning',
    turns: [
      {
        msg: '我上周在你们家做的美甲，有一个甲片翘边了',
        checks: [
          (d) => /免费(重做|补做)|全额退款|一定退|包退/.test(d.answerZh) ? '❌ 承诺了退款/免费重做(应只收集信息并转人工)' : null,
          (d) => d.handoffRequired || /人工|门店|同事|安排/.test(d.answerZh) ? null : '未转人工/未安排跟进'
        ]
      }
    ]
  },
  {
    name: '④ 超知识库(招聘) — 静默转人工,不编造',
    customerType: 'new',
    turns: [
      {
        msg: '你们店招人吗？我想来应聘美甲师',
        checks: [
          (d) => /时薪|底薪|薪资|工资\s*\$?\d|每周排班要求/.test(d.answerZh) ? '❌ 疑似编造了招聘细节(应转人工,不编造)' : null,
          (d) => d.handoffRequired ? null : '未标记需人工(超知识库应静默转人工)'
        ]
      }
    ]
  },
  {
    name: '⑤ 多轮上下文记忆 — "那延长呢" 要接住美甲语境',
    customerType: 'new',
    turns: [
      { msg: '美甲怎么收费的' },
      {
        msg: '那延长呢',
        checks: [
          (d) => /美甲|延长|技师|报价|款式/.test(d.answerZh) ? null : '未接住上文美甲语境(可能把跟进问题当成新会话)'
        ]
      }
    ]
  },
  {
    name: '⑥ 首次美睫 — 问下睫毛 + 眼部健康,不跳过安全询问',
    customerType: 'new',
    turns: [
      {
        msg: '我第一次做美睫，想做自然款',
        checks: [
          (d) => /下睫毛|下睫|眼睛|眼部|术后|不适|过敏/.test(d.answerZh) ? null : '未问下睫毛/眼部健康(美睫安全询问缺失)'
        ]
      }
    ]
  }
]

function short(s, n = 220) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s }

async function run() {
  console.log(`${C.bold}Lucky Luxe 真实 Qwen 冒烟测试${C.reset}`)
  console.log(`${C.dim}endpoint: ${ENDPOINT}${C.reset}\n`)
  // 连通性
  try {
    const h = await fetch(`${BASE_URL}/health`, { method: 'GET' })
    console.log(`${C.dim}health: ${h.status} ${short(await h.text(), 120)}${C.reset}\n`)
  } catch (e) {
    console.log(`${C.red}无法连接 ${BASE_URL}/health:${C.reset} ${e.message}`)
    console.log('先确认服务器已启动(本地)或域名可达(生产)。\n')
    process.exit(2)
  }

  for (const sc of scenarios) {
    console.log(`${C.bold}${C.cyan}${sc.name}${C.reset}`)
    const history = []
    for (const turn of sc.turns) {
      tally.turns++
      let d, provider, model
      try {
        const reply = await ask({ message: turn.msg, history, customerType: sc.customerType })
        provider = reply.provider
        model = reply.model
        d = reply.data || {}
      } catch (e) {
        tally.errors++
        console.log(`  ${C.red}✗ 请求失败:${C.reset} ${e.message}`)
        continue
      }
      const real = provider === 'openai-compatible'
      real ? tally.provider_real++ : tally.provider_mock++
      const provTag = real ? `${C.green}${provider}${C.reset}` : `${C.yellow}${provider}(非真实!)${C.reset}`
      console.log(`  ${C.dim}顾客:${C.reset} ${turn.msg}`)
      console.log(`  ${C.dim}AI  :${C.reset} ${short(d.answerZh)}`)
      console.log(`  ${C.dim}meta:${C.reset} provider=${provTag} model=${model || '-'} intent=${d.intent || '-'} handoff=${d.handoffRequired ? 'Y' : 'N'}`)
      for (const check of (turn.checks || [])) {
        const warn = check(d)
        if (warn) { tally.warns++; console.log(`  ${C.yellow}⚠ ${warn}${C.reset}`) }
      }
      history.push({ role: 'customer', content: turn.msg })
      history.push({ role: 'assistant', content: d.answerZh || '' })
    }
    console.log('')
  }

  console.log(`${C.bold}=== 汇总 ===${C.reset}`)
  console.log(`对话轮次: ${tally.turns}`)
  console.log(`真实 Qwen 回复: ${tally.provider_real}   ${tally.provider_mock ? C.yellow : C.dim}mock 回退: ${tally.provider_mock}${C.reset}`)
  console.log(`软警告: ${tally.warns}   请求错误: ${tally.errors}`)
  if (tally.provider_mock > 0) {
    console.log(`\n${C.yellow}冒烟未通过:出现 mock 回退,真实 Qwen 通道未全程生效。${C.reset}`)
    console.log('排查:AI_API_KEY 是否载入 / AI_REQUIRE_REAL=true / 服务器所在环境能否访问 AI_BASE_URL。')
    process.exit(1)
  }
  if (tally.errors > 0) { console.log(`\n${C.red}存在请求错误,请检查服务器日志。${C.reset}`); process.exit(1) }
  console.log(`\n${C.green}真实 Qwen 全程生效。请再人眼扫一遍上面每条中文回复的措辞。${C.reset}`)
}

run().catch((e) => { console.error(e); process.exit(2) })
