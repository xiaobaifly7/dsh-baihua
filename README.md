# dsh-baihua（大白话模式）

让 DeepSeek 在对话里直接用大白话回答：先给结论，术语保留原词并在括号里用一句大白话解释，能打比方就打比方，顺带说清它在实际工作的哪一步用到；代码、命令、路径、报错原文原样保留。只改说法，不改做法。

## 安装

`<DSH_HOME>` 是 DSH 的数据目录，没设 `DSH_HOME` 时是 `~/.dsh`。下面以 `desktop` 这个 profile 为例，装在别的 profile 就把 `desktop` 换成它的名字。

1. 把仓库放进 profile 的 `local-plugins` 目录：

   ```sh
   git clone https://github.com/xiaobaifly7/dsh-baihua.git "<DSH_HOME>/profiles/desktop/local-plugins/dsh-baihua"
   ```

2. 在 `<DSH_HOME>/profiles/desktop` 目录里，让 `DSH_HOME` 指向数据目录，用 DSH 自带的命令行（桌面版在安装目录的 `resources/runtime/cli/bin` 下）把它加成链接依赖：

   ```sh
   dsh plugin --profile desktop add link:./local-plugins/dsh-baihua
   ```

3. 装了插件市场（dshmarket）就在里面把它打开；没装就重启 DSH。

## 怎么用

- 输入框左侧的「大白话」按钮：蓝色是开，灰色是关。每个会话单独记，新会话默认开。
- 写代码、跑任务时想要原本的专业表述，点一下就关掉这个会话的大白话。
- 子代理（含 fork 方式的子代理、旁问）不受影响，按钮也不显示：它们的输出是给父代理看的。你自己用「分叉会话」分出来的会话是普通会话，照常按开关，默认开。

## 它做了什么

- 往系统提示词里加一段规则（排在人设之后、工具说明之前），只在开关开着的会话里出现，子代理除外。
- 开关存在 `<DSH_HOME>/baihua/sessions.json`：只记你按过开关的会话，最多 500 个；超出时先忘掉最久没按过开关的那个，它回到默认开。
- 按钮通过本机接口 `/api/baihua/state` 读写开关：只接受本机请求，拒绝 DNS 重绑定和跨站请求。
- 不注册工具，不读、不存聊天内容，不联网。

## 测试

```sh
node test/host.test.mjs
node test/client.test.mjs
```

## 卸载

最好在插件市场里卸载（没有 agent 在跑时）：市场开关有时会在 `<DSH_HOME>/profiles/desktop/cordis.patch.yml` 末尾写一段 `- id: baihua`，卸载时它会顺带清掉。

改用命令行时：让 `DSH_HOME` 指向数据目录，在 `<DSH_HOME>/profiles/desktop` 目录里运行 `dsh plugin --profile desktop remove dsh-baihua`；`<DSH_HOME>/profiles/desktop/cordis.patch.yml`（不是本仓库里的同名文件）里如果有 `- id: baihua` 那一段，也手动删掉（留着会变成指向不存在插件的补丁行），然后重启 DSH。

两种方式卸载后，开关记录还在 `<DSH_HOME>/baihua/`，不要了就删掉。

## 许可

MIT，见 [LICENSE](LICENSE)。
