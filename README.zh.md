# dsh-baihua（大白话模式）

让 DeepSeek 在对话里直接用大白话回答：先给结论，术语保留原词并在括号里用一句大白话解释，能打比方就打比方，顺带说清它在实际工作的哪一步用到；代码、命令、路径、报错原文原样保留。只改说法，不改做法。

## 怎么用

- 输入框左侧的「大白话」按钮：蓝色是开，灰色是关。每个会话单独记，新会话默认开。
- 写代码、跑任务时想要原本的专业表述，点一下就关掉这个会话的大白话。
- 子代理（含 fork 方式的子代理、旁问）不受影响，按钮也不显示：它们的输出是给父代理看的。你自己用「分叉会话」分出来的会话是普通会话，照常按开关，默认开。

## 它做了什么

- 往系统提示词里加一段规则（排在人设之后、工具说明之前），只在开关开着的会话里出现，子代理除外。
- 开关存在 `<DSH_HOME>/baihua/sessions.json`，最多记 500 个会话；超出时先忘掉最久没动过的，忘掉的会话回到默认开。
- 按钮通过本机接口 `/api/baihua/state` 读写开关：只接受本机请求，拒绝 DNS 重绑定和跨站请求。
- 不注册工具，不读、不存聊天内容，不联网。

## 测试

```sh
node test/host.test.mjs
node test/client.test.mjs
```

## 卸载

最好在插件市场里卸载（没有 agent 在跑时）：它会顺带清掉启用时写进 `profiles\desktop\cordis.patch.yml` 末尾的两行 `- id: baihua` / `disabled: false`。

改用命令行时：`DSH_HOME` 指向 ASA 的 `data\home`，在 `profiles\desktop` 目录里运行 `dsh plugin --profile desktop remove dsh-baihua`，再手动删掉上面那两行（留着会变成指向不存在插件的补丁行），重启 DSH。最后删掉 `<DSH_HOME>\baihua\`。
