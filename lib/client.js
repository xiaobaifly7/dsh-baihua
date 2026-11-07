window.__ModuleLoader__.load({ id: "dsh-baihua", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var React = require("react");

/**
 * dsh-baihua —— 浏览器半：输入框左侧一个「大白话」开关，按会话记。
 * 开关状态存在宿主那边（由它决定提示词里有没有这一段），这里只读写；
 * 宿主够不着时不显示按钮，免得界面说开着、模型却没收到。
 */

var ROUTE = '/api/baihua/state';

function readState(sessionId) {
  return fetch(ROUTE + '?sessionId=' + encodeURIComponent(sessionId), { headers: { accept: 'application/json' } })
    .then(function (response) { return response.ok ? response.json() : null; });
}

function writeState(sessionId, enabled) {
  return fetch(ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sessionId: sessionId, enabled: enabled })
  }).then(function (response) {
    return response.json().then(function (data) {
      if (!response.ok || !data || data.ok !== true) throw new Error((data && data.error) || 'HTTP ' + response.status);
      return data;
    });
  });
}

function BaihuaButton(props) {
  var sessionId = props.sessionId;
  var onState = React.useState(null);
  var on = onState[0];
  var setOn = onState[1];
  var busyState = React.useState(false);
  var busy = busyState[0];
  var setBusy = busyState[1];

  React.useEffect(function () {
    if (!sessionId) return undefined;
    var alive = true;
    readState(sessionId)
      .then(function (data) { if (alive && data && data.ok) setOn(data.enabled === true); })
      .catch(function () { /* 宿主够不着：不显示按钮 */ });
    return function () { alive = false; };
  }, [sessionId]);

  if (!sessionId || on === null) return null;

  function toggle() {
    if (busy) return;
    var next = !on;
    setBusy(true);
    setOn(next);
    writeState(sessionId, next)
      .then(function (data) { setOn(data.enabled === true); })
      .catch(function () { setOn(!next); })
      .then(function () { setBusy(false); });
  }

  var label = on ? '大白话：开' : '大白话：关';
  return React.createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': on,
    'aria-label': label,
    title: on ? '这个会话的回复会用大白话讲，点一下关掉' : '点一下，让这个会话的回复用大白话讲',
    onClick: toggle,
    disabled: busy,
    style: {
      flex: 'none',
      height: '24px',
      padding: '0 8px',
      border: '1px solid ' + (on ? 'rgba(59, 130, 246, 0.6)' : 'rgba(128, 128, 128, 0.4)'),
      borderRadius: '12px',
      background: on ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
      color: on ? '#3b82f6' : 'inherit',
      opacity: on ? 1 : 0.7,
      fontSize: '12px',
      lineHeight: '22px',
      cursor: busy ? 'default' : 'pointer',
      whiteSpace: 'nowrap'
    }
  }, '大白话');
}

/** 插槽给的上下文：可能直接是会话 id，也可能是带 sessionId 的对象 */
function sessionProps(value) {
  if (typeof value === 'string') return { sessionId: value };
  if (value && typeof value.sessionId === 'string') return { sessionId: value.sessionId };
  return {};
}

exports.name = 'dsh-baihua';
exports.inject = ['slots'];
exports.apply = function apply(ctx) {
  ctx.slots.inject('conversation.input.left', function () {
    return ctx.slots.register({
      name: 'conversation.input.left',
      id: 'dsh-baihua',
      order: 45,
      inject: sessionProps
    }, function (props) {
      return React.createElement(BaihuaButton, props);
    });
  });
};

return module.exports; } });
