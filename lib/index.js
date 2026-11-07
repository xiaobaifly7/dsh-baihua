// dsh-baihua —— 大白话模式：开关开着的会话里，让模型直接用大白话回答。
//
// 只做三件事：
//  - 一段系统提示词，只给开关开着的会话；子代理（含 fork 方式的子代理、旁问）的输出是给父代理看的，
//    不加；用户自己「分叉会话」分出来的是普通会话，照常按开关；
//  - 每个会话一个开关，新会话默认开，存在 <DSH_HOME>/baihua/sessions.json；
//  - 输入框按钮读写开关用的本机接口 /api/baihua/state。
// 不注册工具，不读聊天内容。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-baihua'

// systemPrompt 必需；webServer 用 ctx.inject 可选地拿，headless 这类没有网页的 profile 也照样生效
export const inject = ['systemPrompt']

const RULES = [
  '# 大白话模式',
  '',
  '这个会话开了「大白话模式」：用户不熟悉专业术语。回答要让外行一读就懂，但不能讲错、不能漏掉关键事实。',
  '',
  '- 第一句直接给结论或答案，这一句不用术语。',
  '- 术语、缩写、代号第一次出现时保留原词，紧跟括号用一句大白话说明它是干嘛的，例如「CORS（服务器写明允许哪些网站读它的数据）」。不要用一个术语去解释另一个术语；能打生活里的比方就打一个。',
  '- 讲到概念或操作时，用一两句话说明它在实际工作的哪一步会用到。',
  '- 短段落、少列表；用户要求详细时再展开。',
  '- 代码、命令、路径、配置项、报错原文和数字一律原样保留，不翻译、不改写、不简化；需要时在代码块外用大白话说明它在做什么。',
  '- 只改说法，不改做法：调用工具、改文件、核实结论的方式和严谨程度照旧。',
  '- 用户用什么语言提问就用什么语言回答；用户这次明确要求别的写法时，以用户的要求为准。'
].join('\n')

const SECTION_ORDER = 55 // 人设（0）之后、各类策略与工具说明（500 起）之前
const ROUTE = '/api/baihua/state'
const MAX_SESSIONS = 500
const MAX_BODY = 4096
const VALID_SESSION_ID = /^[A-Za-z0-9_.:-]{1,200}$/
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

function stateFile() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'baihua', 'sessions.json')
}

/** 读开关；文件没有、读不了、内容坏了，都当作「还没设过」——新会话按默认开启 */
function readState() {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8'))
    const entries = raw && typeof raw.sessions === 'object' && raw.sessions !== null ? Object.entries(raw.sessions) : []
    const sessions = new Map()
    for (const [id, on] of entries) {
      if (VALID_SESSION_ID.test(id) && typeof on === 'boolean') sessions.set(id, on)
    }
    return sessions
  } catch {
    return new Map()
  }
}

/** 先写临时文件再改名：中途断电也不会留下半份 */
function writeState(sessions) {
  const file = stateFile()
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify({ version: 1, sessions: Object.fromEntries(sessions) }, null, 2) + '\n', 'utf8')
  renameSync(temp, file)
}

function hostnameOf(authority) {
  try {
    return new URL('http://' + authority).hostname
  } catch {
    return null
  }
}

/**
 * 只认本机页面：exact 路由绕开 DSH 认证、宿主也不校验 Host，所以这里自己挡。
 * 桌面版代理转发前会去掉 Host 和 Origin（两样都没有照常放行）；有 Host 就必须是本机名字（挡 DNS 重绑定）；
 * 有 Origin 就必须与 Host 同源（新版 Chrome 对本机同源请求会省掉端口，主机名相同也算）。
 */
function trusted(req) {
  const remote = req.socket ? req.socket.remoteAddress : ''
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const host = req.headers.host
  if (host !== undefined && !LOOPBACK.has(hostnameOf(host))) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  if (host === undefined) return false
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return url.host === host || (url.port === '' && url.hostname === hostnameOf(host))
}

async function readBody(req) {
  req.setEncoding('utf8')
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY) return undefined
  }
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export function apply(ctx) {
  let sessions = readState()
  const isOn = (id) => (sessions.has(id) ? sessions.get(id) : true)

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'baihua',
    order: SECTION_ORDER,
    text: (context) => {
      const agent = context ? context.agent : undefined
      const session = agent ? agent.session : undefined
      // 只认 DSH 自己的子代理标记：用户「分叉会话」也带 parentSession，但没有 origin，是普通会话
      if (session && session.header && session.header.origin === 'subagent') return ''
      const id = (session && session.id) || (agent && agent.id)
      return typeof id === 'string' && id.length > 0 && isOn(id) ? RULES : ''
    }
  }))

  ctx.inject(['webServer'], (scope) => {
    const server = scope.webServer
    if (!server || typeof server.register !== 'function') return
    scope.effect(() => server.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        try {
          if (!trusted(req)) return send(res, 403, { ok: false, error: 'origin not allowed' })
          if (req.method === 'GET') {
            const id = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('sessionId') || ''
            if (!VALID_SESSION_ID.test(id)) return send(res, 400, { ok: false, error: 'sessionId is required' })
            return send(res, 200, { ok: true, sessionId: id, enabled: isOn(id) })
          }
          if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' })
          const body = await readBody(req)
          if (!body) return send(res, 400, { ok: false, error: 'invalid JSON body' })
          const id = typeof body.sessionId === 'string' ? body.sessionId : ''
          if (!VALID_SESSION_ID.test(id)) return send(res, 400, { ok: false, error: 'sessionId is required' })
          if (typeof body.enabled !== 'boolean') return send(res, 400, { ok: false, error: 'enabled must be a boolean' })
          const next = new Map(sessions)
          next.delete(id) // 重新排到最后：超过上限时先淘汰最久没动过的会话
          next.set(id, body.enabled)
          while (next.size > MAX_SESSIONS) next.delete(next.keys().next().value)
          writeState(next)
          sessions = next
          return send(res, 200, { ok: true, sessionId: id, enabled: body.enabled })
        } catch (error) {
          return send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }))
  })
}
