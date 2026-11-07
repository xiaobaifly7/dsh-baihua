// dsh-baihua 浏览器半桩测试：在 vm 里按 __ModuleLoader__ 约定加载 client.js，React 用桩。
// 用法: node test/client.test.mjs
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

let loaded = null
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load: (entry) => { loaded = entry } } },
  fetch: () => Promise.reject(new Error('no network in tests'))
})
check('按 __ModuleLoader__ 约定登记模块', Boolean(loaded) && loaded.id === 'dsh-baihua' && typeof loaded.factory === 'function')

/** 每次加载给一套 useState 桩值（按调用次序：0 = 开关状态，1 = 进行中） */
function load(stateValues) {
  let index = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (initial) => {
      const at = index++
      return [Object.prototype.hasOwnProperty.call(stateValues, at) ? stateValues[at] : initial, () => {}]
    },
    useEffect: () => {}
  }
  const exported = loaded.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  const registered = []
  exported.apply({
    slots: {
      inject: (_name, register) => register(),
      register: (spec, component) => { registered.push({ spec, component }); return () => {} }
    }
  })
  const slot = registered[0]
  // 会话插槽默认给一个普通会话的 useSession（DSH 普通会话的 session.subagent 是 null）
  const plainSession = (select) => select({ subagent: null })
  const render = (props) => {
    index = 0
    const element = slot.component(Object.assign({ useSession: plainSession }, props))
    return element.type(element.props)
  }
  return { slot, render }
}

const base = load({})
check('挂在输入框左侧插槽', base.slot && base.slot.spec.name === 'conversation.input.left' && base.slot.spec.id === 'dsh-baihua')
check('插槽上下文是会话 id 字符串、带 sessionId 的对象都认得，认不出就不给',
  JSON.stringify(base.slot.spec.inject('s1')) === '{"sessionId":"s1"}' &&
  JSON.stringify(base.slot.spec.inject({ sessionId: 's2' })) === '{"sessionId":"s2"}' &&
  JSON.stringify(base.slot.spec.inject(null)) === '{}')
check('没有会话 id 时不显示按钮', base.render({}) === null)
check('还没读到宿主的开关状态时不显示按钮（免得界面和模型对不上）', base.render({ sessionId: 's1' }) === null)

const onButton = load({ 0: true, 1: false }).render({ sessionId: 's1' })
check('开着：开关态、标签「大白话：开」',
  onButton && onButton.type === 'button' && onButton.props.role === 'switch' && onButton.props['aria-checked'] === true &&
  onButton.props['aria-label'] === '大白话：开' && onButton.children.includes('大白话'))
const offButton = load({ 0: false, 1: false }).render({ sessionId: 's1' })
check('关着：标签「大白话：关」', offButton && offButton.props['aria-checked'] === false && offButton.props['aria-label'] === '大白话：关')
const busyButton = load({ 0: true, 1: true }).render({ sessionId: 's1' })
check('写入中标 aria-busy 而不禁用按钮（禁用会把键盘焦点甩到页面顶上；连点由 busy 挡住）',
  busyButton && busyButton.props['aria-busy'] === true && !busyButton.props.disabled)
const subagentButton = load({ 0: true, 1: false }).render({
  sessionId: 'c1',
  useSession: (select) => select({ subagent: { address: { mode: 'continuable' } } })
})
check('子代理会话不显示按钮（宿主那边也不给子代理加规则）', subagentButton === null)
const noHookButton = load({ 0: true, 1: false }).render({ sessionId: 's1', useSession: undefined })
check('插槽没给 useSession 时当普通会话，按钮照常显示', noHookButton && noHookButton.type === 'button')

const failed = results.filter((item) => !item.ok)
console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项`)
process.exit(failed.length === 0 ? 0 : 1)
