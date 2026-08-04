// 企微出站连通性探针(只读,不发任何消息)
//
// 用途:在回调链路被 ICP 备案阻塞期间,先验证"我们主动调企微 API"这个方向是否通。
// 依次做两件事:
//   1) gettoken —— 用 CorpID + Secret 换 access_token(验证凭据与出口 IP 白名单)
//   2) kf/account/list —— 列出微信客服账号,打印 open_kfid 与名称(供写入 WECOM_OPEN_KFID)
//
// 用法(本机):
//   node --env-file-if-exists=apps/api/.env apps/api/tools/wecom-probe.mjs
//
// 安全:凭据只从环境变量读,脚本内不含任何密钥;输出对 secret/token 一律打码。
// 只调用 GET 类只读接口,不会发送任何客服消息。

const API = 'https://qyapi.weixin.qq.com/cgi-bin'
const CORP_ID = process.env.WECOM_CORP_ID || ''
const SECRET = process.env.WECOM_CUSTOMER_SERVICE_SECRET || ''
const AGENT_ID = process.env.WECOM_AGENT_ID || ''

const mask = (v) => (v ? `<len=${String(v).length}>` : '<未配置>')

// 企微常见错误码 → 人话
const HINTS = {
  60020: 'IP 白名单:当前出口 IP 不在企业可信 IP 列表 → 必须走境内固定 IP 中转(等 ICP 那台服务器)',
  40001: 'Secret 不正确,或该 Secret 与 CorpID 不匹配',
  40013: 'CorpID 不正确',
  48002: 'API 无权限:该 Secret 对应的应用没有此接口权限(如用自建应用 Secret 调微信客服接口)',
  60011: '无权限操作指定资源(常见于自建应用 Secret 访问微信客服资源)',
  301005: '无权限访问该客服账号',
}

async function callApi(path, label) {
  const started = Date.now()
  try {
    const res = await fetch(`${API}/${path}`)
    const data = await res.json()
    return { ok: true, ms: Date.now() - started, http: res.status, data }
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error?.message || String(error) }
  }
}

function report(label, r) {
  if (!r.ok) {
    console.log(`✗ ${label}:网络层失败 —— ${r.error}(${r.ms}ms)`)
    return null
  }
  const { errcode, errmsg } = r.data || {}
  if (errcode && errcode !== 0) {
    console.log(`✗ ${label}:errcode=${errcode} errmsg="${errmsg}"(${r.ms}ms)`)
    const hint = HINTS[errcode]
    if (hint) console.log(`   ↳ ${hint}`)
    if (String(errmsg || '').includes('not allow to access from your ip')) {
      console.log('   ↳ 明确是 IP 白名单拦截,不要尝试绕过,等境内固定 IP 中转。')
    }
    return null
  }
  console.log(`✓ ${label}:成功(${r.ms}ms)`)
  return r.data
}

async function main() {
  console.log('=== 企微出站探针(只读)===')
  console.log(`CorpID=${mask(CORP_ID)}  Secret=${mask(SECRET)}  AgentId=${AGENT_ID || '<未配置>'}`)
  if (!CORP_ID || !SECRET) {
    console.log('✗ 缺少 WECOM_CORP_ID 或 WECOM_CUSTOMER_SERVICE_SECRET,无法继续。')
    process.exitCode = 1
    return
  }

  // 1) gettoken
  const tokenRes = await callApi(
    `gettoken?corpid=${encodeURIComponent(CORP_ID)}&corpsecret=${encodeURIComponent(SECRET)}`,
    'gettoken'
  )
  const tokenData = report('gettoken', tokenRes)
  if (!tokenData) {
    console.log('\n结论:出站方向未打通,后续接口跳过。')
    process.exitCode = 1
    return
  }
  const token = tokenData.access_token
  console.log(`   access_token=${mask(token)}  expires_in=${tokenData.expires_in}s`)

  // 2) kf/account/list —— 注意:这是"微信客服"接口,需微信客服 Secret;
  //    若此处 Secret 属于普通自建应用,预期会收到 48002/60011 类权限错误。
  const kfRes = await callApi(`kf/account/list?access_token=${encodeURIComponent(token)}`, 'kf/account/list')
  const kfData = report('kf/account/list', kfRes)
  if (!kfData) {
    console.log('\n结论:gettoken 通,但客服账号列表取不到(见上方错误码提示)。')
    return
  }

  const list = kfData.account_list || []
  console.log(`   客服账号数量:${list.length}`)
  list.forEach((a, i) => {
    console.log(`   [${i + 1}] name="${a.name}"  open_kfid=${a.open_kfid}`)
  })
  if (list.length) {
    console.log('\n把上面的 open_kfid 写进 .env 的 WECOM_OPEN_KFID(值不要贴进聊天/结果文件)。')
  }
}

main().catch((e) => {
  console.error('探针异常:', e?.message || e)
  process.exitCode = 1
})
