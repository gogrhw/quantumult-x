# Quantumult X 规则与脚本

这里存放个人使用的 Quantumult X（以下简称 QX）重写规则和脚本。目前包含两个功能：

| 功能 | 用途 |
| --- | --- |
| Kelee Loon → QX | 将 [Kelee 插件中心](https://hub.kelee.one) 中的 Loon 插件导入链接转换成 QX 资源导入链接 |
| Plex Fast Connect | 探测 Plex Media Server 的可用连接，把官方返回的连接列表优化为更快的连接 |

## 快速安装

在 QX 中打开下面的链接，导入对应的 snippet：

- [Kelee Loon → QX](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/kelee-loon-to-qx.snippet)
- [Plex Fast Connect](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/plex-fast-connect.snippet)

导入后确认 QX 的“重写”功能已开启。两个 snippet 都引用了本仓库 `main` 分支上的远程脚本，因此正常情况下不需要手动复制 JavaScript 文件。

## 前置配置

这两个功能都需要 QX 的 MITM。根据实际使用的功能，把域名加入现有的 `[mitm]` 配置中：

```ini
[mitm]
hostname = hub.kelee.one, plex.tv
```

如果 `[mitm]` 已经存在，只需把域名合并进去，不要重复创建配置段。只使用其中一个功能时，可以只添加对应域名：

- Kelee：`hub.kelee.one`
- Plex：`plex.tv`

## Kelee Loon → QX

### 作用

Kelee 插件中心主要提供 Loon 插件链接，例如：

```text
loon://import?plugin=https%3A%2F%2Fexample.com%2Fexample.lpx
```

这个规则会把它转换成 QX 可以识别的：

```text
quantumult-x:///add-resource?remote-resource=...
```

转换后的资源会作为 `rewrite_remote` 导入，并自动设置名称、48 小时更新周期、解析器和启用状态。

### 使用

1. 导入 [Kelee snippet](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/kelee-loon-to-qx.snippet)。
2. 确认 `hub.kelee.one` 已加入 MITM，并开启 QX 重写。
3. 在 QX 的网络环境中打开或刷新 [Kelee 插件中心](https://hub.kelee.one)。
4. 点击插件的导入链接，系统会唤起 QX 添加资源。

页面是 SPA 时，插件列表可能在页面加载后才通过 `fetch()` 获取。脚本同时处理接口响应和页面中的 `fetch()`，所以首次导入后建议刷新页面。

### 匹配范围

规则只处理以下请求：

- `https://hub.kelee.one/list.json`：改写插件列表中的 `url` 字段。
- `https://hub.kelee.one/` 或 `index.html`：注入客户端转换脚本。

只有指向 HTTP(S) `.lpx` 文件的 Loon 插件链接会被转换；其他链接保持原样。资源标签优先使用条目的 `name` 或 `title`，没有名称时使用文件名。

## Plex Fast Connect

### 作用

Plex 客户端会从 `plex.tv/api/resources` 获取 Plex Media Server 的多个连接地址。这个脚本会：

1. 在请求阶段移除缓存校验头，避免只收到 `304 Not Modified` 而没有可处理的资源正文。
2. 优先尝试 QX 偏好设置中缓存的官方 Plex `Device`，探测其直连地址。
3. 缓存失效时，从 Plex 官方响应中识别服务器并并发探测可用连接。
4. 把选中的连接写回响应；探测失败时保留官方原始响应，不阻断 Plex 登录或发现流程。

默认配置 `bypass_official=true` 会优先使用缓存或配置的直连地址。若设置为 `false`，脚本会针对官方返回的每个服务器筛选可用连接，并按配置决定是否保留 Relay 连接。

### 使用

1. 导入 [Plex Fast Connect snippet](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/plex-fast-connect.snippet)。
2. 确认 `plex.tv` 已加入 MITM，并开启 QX 重写。
3. 打开 Plex 客户端或触发一次服务器发现。
4. 如需自定义连接地址，修改 snippet 中两条规则 URL 里 `#` 后的参数；请求阶段和响应阶段必须保持一致。

脚本会在 QX 的 `$prefs` 中缓存已识别的官方 Device。修改 `lan_url`、`remote_url` 后，缓存签名会自动变化，不会误用旧配置；服务器返回 `401/403` 时也会自动清除失效缓存。

### 参数

两条 Plex 规则使用同一组参数。`phase` 只用于区分请求阶段和响应阶段，不要手动改成其他值。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `phase` | `request` / `response` | 请求规则使用 `request`，响应规则使用 `response` |
| `bypass_official` | `true` | 是否优先走缓存或自定义直连；设为 `false` 可改为筛选官方连接列表 |
| `lan_url` | `auto` | 局域网 Plex 地址，例如 `http://192.168.1.20:32400`；`auto` 表示自动发现 |
| `remote_url` | `auto` | 外网 Plex 地址，例如 `https://plex.example.com:32400`；`auto` 表示自动发现 |
| `bypass_timeout` | `3` | 缓存/自定义地址探测超时，范围 `0.5–4` 秒 |
| `probe_timeout` | `2` | 筛选官方连接时的探测超时，范围 `0.5–3` 秒 |
| `allow_relay` | `true` | `bypass_official=false` 时，直连失败后是否尝试 Plex Relay |
| `debug` | `false` | 是否输出详细探测日志 |

例如，使用固定的局域网和外网地址时，把两条规则的参数分别改成类似下面的形式：

```text
lan_url=http://192.168.1.20:32400&remote_url=https://plex.example.com:32400
```

地址支持 `http`、`https`、域名、IPv4 和带方括号的 IPv6。若不确定地址是否正确，先保留 `auto`。

### 版本要求

Plex snippet 通过脚本 URL `#` 后的参数传值。snippet 注释标注需要 QX `1.0.25+`；QX `1.5.6+` 才通过 `$environment.variables` 提供参数，脚本对旧版本保留了回退读取方式，仍建议使用较新的 QX 版本。

## 常见问题

### Kelee 页面仍显示 `loon://`

检查以下项目：

- `kelee-loon-to-qx.snippet` 是否已导入且处于启用状态。
- `hub.kelee.one` 是否加入 MITM，证书是否已被系统信任。
- 导入规则后是否重新加载了 Kelee 页面。
- QX 是否能访问 GitHub Raw 脚本地址；脚本无法下载时，规则仍会命中但不会转换内容。

### 点击后没有唤起 QX

先确认设备已安装 QX，并允许浏览器打开 `quantumult-x://` 自定义 URL。也可以复制转换后的链接，在 QX 中手动打开。

### Plex 没有切换到预期地址

开启 `debug=true` 后查看 QX 日志，重点检查：

- 请求阶段和响应阶段两条规则是否都存在，且参数一致。
- `plex.tv` MITM 是否生效。
- 固定地址是否能在设备上直接访问 Plex 的 `/identity` 或 `/library/sections`。
- Plex 官方返回的访问令牌是否仍有效。

探测不到可用连接时脚本会保留官方响应，这是预期的安全回退行为。

## 文件结构

```text
.
├── Rewrites/
│   ├── kelee-loon-to-qx.snippet
│   └── plex-fast-connect.snippet
├── Scripts/
│   ├── kelee-loon-to-qx.js
│   └── plex-fast-connect.js
└── README.md
```

`.snippet` 是 QX 的导入入口，`.js` 是被 snippet 远程调用的脚本。项目不需要构建步骤，也没有第三方依赖；修改脚本后可在 QX 中通过远程 URL 验证实际行为。

## 安全提示

这些脚本运行在 QX MITM 环境中，请只从自己信任的地址导入。Plex 脚本会读取 Plex 官方 `Device` 中的访问令牌，并把令牌用于探测官方返回或你配置的服务器地址；不要填写不信任的目标地址，也不要公开 QX 日志或带令牌的资源响应。

仓库地址：[github.com/gogrhw/quantumult-x](https://github.com/gogrhw/quantumult-x)
