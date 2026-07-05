import http from 'node:http'
import { URL } from 'node:url'

const PORT = Number(process.env.PORT || 8787)
const UPSTREAM_BASE_URL = (process.env.UPSTREAM_BASE_URL || 'https://www.luckyluxeatelier.com').replace(/\/$/, '')
const GATEWAY_NAME = process.env.GATEWAY_NAME || 'lucky-luxe-wecom-gateway'
const WECOM_CORP_ID = process.env.WECOM_CORP_ID || ''
const WECOM_CUSTOMER_SERVICE_SECRET = process.env.WECOM_CUSTOMER_SERVICE_SECRET || ''
const WECOM_OPEN_KFID = process.env.WECOM_OPEN_KFID || ''
const GATEWAY_SHARED_SECRET = process.env.WECOM_GATEWAY_SHARED_SECRET || ''

let wecomAccessToken = ''
let wecomAccessTokenExpiresAt = 0

function sendJson(res, status, data) {
  const payload = JSON.stringify(data)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function apiError(status, code, message, detail = null) {
  const error = new Error(message)
  error.status = status
  error.code = code
  error.detail = detail
  return error
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJsonBody(req) {
  const rawBody = await readRawBody(req)
  if (!rawBody.length) return {}
  try {
    return JSON.parse(rawBody.toString('utf8'))
  } catch {
    throw apiError(400, 'BAD_JSON', 'Request body must be valid JSON.')
  }
}

function assertGatewayAuth(req) {
  if (!GATEWAY_SHARED_SECRET) throw apiError(503, 'GATEWAY_SECRET_MISSING', 'Gateway shared secret is not configured.')
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (token !== GATEWAY_SHARED_SECRET) throw apiError(401, 'UNAUTHORIZED', 'Gateway shared secret is invalid.')
}

async function proxyToUpstream(req, res, path, rawBody = Buffer.alloc(0)) {
  const incoming = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const target = new URL(path, UPSTREAM_BASE_URL)
  target.search = incoming.search

  const headers = {
    'content-type': req.headers['content-type'] || 'application/octet-stream',
    'x-lucky-gateway': GATEWAY_NAME,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-proto': 'https'
  }

  const response = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : rawBody
  })

  const text = await response.text()
  res.writeHead(response.status, {
    'content-type': response.headers.get('content-type') || 'text/plain; charset=utf-8'
  })
  res.end(text)
}

async function getWecomAccessToken() {
  if (!WECOM_CORP_ID || !WECOM_CUSTOMER_SERVICE_SECRET) {
    throw apiError(503, 'WECOM_CREDENTIALS_MISSING', 'WeCom CorpID or customer service secret is missing.')
  }
  if (wecomAccessToken && Date.now() < wecomAccessTokenExpiresAt - 60_000) return wecomAccessToken
  const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken')
  url.searchParams.set('corpid', WECOM_CORP_ID)
  url.searchParams.set('corpsecret', WECOM_CUSTOMER_SERVICE_SECRET)
  const response = await fetch(url)
  const data = await response.json()
  if (data.errcode !== 0 || !data.access_token) {
    throw apiError(502, 'WECOM_TOKEN_FAILED', 'Failed to get WeCom access token.', data)
  }
  wecomAccessToken = data.access_token
  wecomAccessTokenExpiresAt = Date.now() + Number(data.expires_in || 7200) * 1000
  return wecomAccessToken
}

async function wecomPost(path, body) {
  const accessToken = await getWecomAccessToken()
  const url = new URL(`https://qyapi.weixin.qq.com${path}`)
  url.searchParams.set('access_token', accessToken)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json()
  if (data.errcode !== 0) {
    throw apiError(502, 'WECOM_API_FAILED', `WeCom API failed: ${path}`, data)
  }
  return data
}

async function syncWecomMessages(body = {}) {
  if (!body.token) throw apiError(400, 'SYNC_TOKEN_MISSING', 'WeCom sync token is required.')
  const messages = []
  let cursor = body.cursor || ''
  let latest = null
  let guard = 0
  do {
    latest = await wecomPost('/cgi-bin/kf/sync_msg', {
      cursor,
      token: body.token,
      open_kfid: body.openKfid || body.open_kfid || WECOM_OPEN_KFID,
      limit: Number(body.limit || 100),
      voice_format: 0
    })
    messages.push(...(latest.msg_list || []))
    cursor = latest.next_cursor || ''
    guard += 1
  } while (latest.has_more && cursor && guard < 5)
  return { nextCursor: cursor, hasMore: Boolean(latest?.has_more), messages }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

    if (url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: GATEWAY_NAME,
        upstream: UPSTREAM_BASE_URL,
        wecomConfigured: Boolean(WECOM_CORP_ID && WECOM_CUSTOMER_SERVICE_SECRET && WECOM_OPEN_KFID),
        time: new Date().toISOString()
      })
    }

    if (url.pathname === '/wecom/account-list' && req.method === 'GET') {
      assertGatewayAuth(req)
      const data = await wecomPost('/cgi-bin/kf/account/list', { offset: 0, limit: 100 })
      return sendJson(res, 200, { ok: true, accountList: data.account_list || [] })
    }

    if (url.pathname === '/wecom/sync-messages' && req.method === 'POST') {
      assertGatewayAuth(req)
      const body = await readJsonBody(req)
      return sendJson(res, 200, { ok: true, ...(await syncWecomMessages(body)) })
    }

    if (url.pathname === '/wecom/send-text' && req.method === 'POST') {
      assertGatewayAuth(req)
      const body = await readJsonBody(req)
      const content = String(body.content || '').slice(0, 1900)
      if (!body.toUser && !body.touser && !body.externalUserId) throw apiError(400, 'TOUSER_MISSING', 'WeCom touser is required.')
      if (!content) throw apiError(400, 'CONTENT_MISSING', 'Text content is required.')
      const data = await wecomPost('/cgi-bin/kf/send_msg', {
        touser: body.toUser || body.touser || body.externalUserId,
        open_kfid: body.openKfid || body.open_kfid || WECOM_OPEN_KFID,
        msgid: body.msgid || body.messageId || `ll-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        msgtype: 'text',
        text: { content }
      })
      return sendJson(res, 200, { ok: true, result: data })
    }

    if (url.pathname === '/wechat/customer-service/webhook') {
      const rawBody = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readRawBody(req)
      return proxyToUpstream(req, res, '/wechat/customer-service/webhook', rawBody)
    }

    return sendJson(res, 404, {
      error: 'NOT_FOUND',
      message: 'Lucky Luxe WeCom Gateway route not found.'
    })
  } catch (error) {
    console.error('[gateway:error]', error)
    return sendJson(res, error.status || 502, {
      error: error.code || 'GATEWAY_ERROR',
      message: error?.message || 'Gateway request failed.'
    })
  }
})

server.listen(PORT, () => {
  console.log(`${GATEWAY_NAME} listening on :${PORT}, upstream=${UPSTREAM_BASE_URL}`)
})
