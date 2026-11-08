// dsh-baihua 宿主半桩测试：假的 systemPrompt / webServer，真跑一遍开关接口。
// 用法: node test/host.test.mjs
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// 开关写进临时目录，绝不碰真实的 <DSH_HOME>
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-baihua-test-'))
process.env.DSH_HOME = tempHome
const stateFile = path.join(tempHome, 'baihua', 'sessions.json')
const mod = await import(pathToFileURL(fileURLToPath(new URL('../lib/index.js', import.meta.url))).href)

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

function mount() {
  const sections = []
  const routes = new Map()
  mod.apply({
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
    effect: (fn) => fn(),
    inject: (_names, callback) => callback({
      webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
      effect: (fn) => fn()
    })
  })
  return { section: sections[0], route: routes.get('/api/baihua/state') }
}

const top = (id) => ({ agent: { id, session: { id, header: {} } } })
const live = mount()
const rules = live.section ? live.section.text(top('s1')) : ''

check('注册一段提示词，排在策略之后、工具说明之前、靠近提示词末尾', Boolean(live.section) && live.section.name === 'baihua' && live.section.order === 900)
check('新会话默认开：顶层会话拿到大白话规则', rules.includes('大白话模式'))
check('规则要点齐全：先给结论、术语保留原词加括号解释、代码命令原样、做法不变',
  rules.includes('第一句直接给结论') && rules.includes('保留原词') && rules.includes('原样保留') && rules.includes('只改说法，不改做法'))
check('规则压得住常见的冲突说法：专业话题照样用大白话、不顺着之前的腔调、「技术精度」不等于术语腔',
  rules.includes('专业话题全都包括在内') && rules.includes('别顺着之前的腔调继续') && rules.includes('不是要你改用术语腔'))
check('规则管住格式：不用表格，内部实现细节用户要了才展开', rules.includes('不用表格') && rules.includes('只在用户明确要细节时才展开'))
check('子代理（DSH 标 origin: subagent，含 fork 方式的子代理、旁问）不加规则：输出是给父代理看的',
  live.section.text({ agent: { id: 'c1', session: { id: 'c1', header: { parentSession: 's1', isSeeded: true, origin: 'subagent' } } } }) === '')
check('用户自己「分叉会话」分出来的会话（有 parentSession、没有 origin）是普通会话，照常拿到规则',
  live.section.text({ agent: { id: 'f1', session: { id: 'f1', header: { parentSession: 's1', isSeeded: true } } } }).includes('大白话模式'))
check('拿不到会话时不加规则', live.section.text({}) === '' && live.section.text(undefined) === '')
check('只有 agent.id 没有 session 对象时按 id 判断', live.section.text({ agent: { id: 's9' } }).includes('大白话模式'))

// requireHostHeader: false —— 与 DSH 宿主一致，才能收下桌面版代理去掉 Host 后转发的请求
const server = http.createServer({ requireHostHeader: false }, (req, res) => live.route(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

function request(method, pathname, options = {}) {
  const headers = Object.assign(options.body !== undefined ? { 'content-type': 'application/json' } : {}, options.headers || {})
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers, setHost: options.setHost !== false }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(data) } catch { json = null }
        resolve({ status: res.statusCode, json })
      })
    })
    req.setTimeout(3000, () => req.destroy(new Error('timeout')))
    req.on('error', (error) => resolve({ status: 0, json: { error: String(error) } }))
    if (options.body !== undefined) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
    req.end()
  })
}

const fresh = await request('GET', '/api/baihua/state?sessionId=s1')
check('GET：没设过的会话报告为开', fresh.status === 200 && fresh.json.enabled === true, `HTTP ${fresh.status}`)

const off = await request('POST', '/api/baihua/state', { body: { sessionId: 's1', enabled: false } })
check('POST：关掉 s1', off.status === 200 && off.json.enabled === false, `HTTP ${off.status}`)
check('关掉后 s1 不再加规则，别的会话不受影响',
  live.section.text(top('s1')) === '' && live.section.text(top('s2')).includes('大白话模式'))
check('开关写盘', JSON.parse(fs.readFileSync(stateFile, 'utf8')).sessions.s1 === false)
const afterRestart = mount()
check('重启后读回开关：s1 仍是关，新会话仍默认开',
  afterRestart.section.text(top('s1')) === '' && afterRestart.section.text(top('s3')).includes('大白话模式'))

const badId = await request('GET', '/api/baihua/state?sessionId=' + encodeURIComponent('../x'))
const badEnabled = await request('POST', '/api/baihua/state', { body: { sessionId: 's1', enabled: 'yes' } })
const badJson = await request('POST', '/api/baihua/state', { body: '{not json' })
const tooBig = await request('POST', '/api/baihua/state', { body: { sessionId: 's1', enabled: true, pad: 'x'.repeat(5000) } })
const wrongMethod = await request('PUT', '/api/baihua/state', { body: { sessionId: 's1', enabled: true } })
check('非法会话 id、非布尔开关、坏 JSON、超大请求体都拒绝，且不改开关',
  badId.status === 400 && badEnabled.status === 400 && badJson.status === 400 && tooBig.status === 400 &&
  wrongMethod.status === 405 && JSON.parse(fs.readFileSync(stateFile, 'utf8')).sessions.s1 === false,
  `${badId.status}/${badEnabled.status}/${badJson.status}/${tooBig.status}/${wrongMethod.status}`)

const turnOn = { sessionId: 's1', enabled: true }
const rebind = await request('POST', '/api/baihua/state', { headers: { Host: `evil.example:${port}`, Origin: `http://evil.example:${port}` }, body: turnOn })
const crossSite = await request('POST', '/api/baihua/state', { headers: { Origin: 'https://evil.example', 'content-type': 'text/plain' }, body: turnOn })
const fetchSite = await request('POST', '/api/baihua/state', { headers: { 'sec-fetch-site': 'cross-site' }, body: turnOn })
const nullOrigin = await request('POST', '/api/baihua/state', { headers: { Origin: 'null' }, body: turnOn })
const originNoHost = await request('POST', '/api/baihua/state', { headers: { Origin: `http://127.0.0.1:${port}` }, body: turnOn, setHost: false })
check('重绑定、跨站、Sec-Fetch-Site 跨站、Origin 为 null、有 Origin 却没有 Host：一律 403，开关不变',
  [rebind, crossSite, fetchSite, nullOrigin, originNoHost].every((r) => r.status === 403) &&
  JSON.parse(fs.readFileSync(stateFile, 'utf8')).sessions.s1 === false,
  [rebind, crossSite, fetchSite, nullOrigin, originNoHost].map((r) => r.status).join('/'))

const desktop = await request('GET', '/api/baihua/state?sessionId=s1', { setHost: false })
const sameOrigin = await request('POST', '/api/baihua/state', { headers: { Origin: `http://127.0.0.1:${port}` }, body: { sessionId: 's4', enabled: false } })
const portless = await request('POST', '/api/baihua/state', { headers: { Origin: 'http://127.0.0.1' }, body: { sessionId: 's5', enabled: false } })
check('桌面版代理形态（无 Host、无 Origin）、同源页面、新版 Chrome 省掉端口的本机 Origin：都放行',
  desktop.status === 200 && desktop.json.enabled === false && sameOrigin.status === 200 && portless.status === 200,
  `${desktop.status}/${sameOrigin.status}/${portless.status}`)

server.close()
fs.rmSync(tempHome, { recursive: true, force: true })

const failed = results.filter((item) => !item.ok)
console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项`)
process.exit(failed.length === 0 ? 0 : 1)
