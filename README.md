# Quantumult X 规则与脚本

这里存放个人使用的 Quantumult X（以下简称 QX）重写规则和脚本。目前包含三个功能：

| 功能 | 用途 |
| --- | --- |
| Kelee Loon → QX | 将 [Kelee 插件中心](https://hub.kelee.one) 中的 Loon 插件导入链接转换成 QX 资源导入链接 |
| Plexamp Qwen | 将 Plexamp 发往 OpenAI 接口的文本和图片请求转换成阿里云 Model Studio 的 Qwen 请求 |
| Plex Fast Connect | 探测 Plex Media Server 的可用连接，把官方返回的连接列表优化为更快的连接 |

## 快速安装

在 QX 中打开下面的链接，导入对应的 snippet：

- [Kelee Loon → QX](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/kelee-loon-to-qx.snippet)
- [Plexamp Qwen](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/plexamp-qwen.snippet)
- [Plex Fast Connect](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/plex-fast-connect.snippet)

导入后确认 QX 的“重写”功能已开启。三个 snippet 都引用了本仓库 `main` 分支上的远程脚本，因此正常情况下不需要手动复制 JavaScript 文件。

## 前置配置

三个功能都需要 QX 的 MITM。根据实际使用的功能，把域名加入现有的 `[mitm]` 配置中：

```ini
[mitm]
hostname = hub.kelee.one, api.openai.com, plex.tv
```

如果 `[mitm]` 已经存在，只需把域名合并进去，不要重复创建配置段。只使用其中一个功能时，可以只添加对应域名：

- Kelee：`hub.kelee.one`
- Plexamp Qwen：`api.openai.com`
- Plex Fast Connect：`plex.tv`

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

## Plexamp Qwen

### 作用

Plexamp 使用固定的 OpenAI 接口完成 Sonic Sage 文本生成和 AI 播放列表封面生成。这个规则会：

1. 为 `/v1/models` 返回 Plexamp 可识别的兼容模型列表。
2. 把 `/v1/chat/completions` 请求代理到 Model Studio 的 OpenAI 兼容接口，并把模型名改成 `text_model`。
3. 把 `/v1/images/generations` 请求转换成 Qwen-Image 原生请求，再把结果转换回 OpenAI Images 响应格式。

API Key 保留在 Plexamp 的 OpenAI API Key 字段中。脚本不会把 API Key 写入仓库或 `$prefs`，但会从请求的 `Authorization` 标头读取它，并发送到 `api_host`。

### 使用

1. 导入 [Plexamp Qwen snippet](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/plexamp-qwen.snippet)。
2. 把 `api.openai.com` 加入 MITM，信任 QX 证书，并开启重写。
3. 在 Plexamp 的 OpenAI API Key 字段中填写 Model Studio API Key。
4. 在 Plexamp 中触发 Sonic Sage 或 AI 播放列表封面生成。

这三条规则必须同时存在，并且必须使用相同的 URL 片段参数。规则只匹配以下 HTTPS 路径：

- `/v1/models` 及单个模型详情路径。
- `/v1/chat/completions`。
- `/v1/images/generations`。

匹配范围不受 Plexamp 进程限制。启用 snippet 后，同一设备上其他应用发往这些 OpenAI 路径的请求也会被改写。

### 参数

在三条规则的脚本 URL 末尾修改参数。每条规则必须使用相同的参数值。

| 参数 | 默认值 | 合法值和行为 |
| --- | --- | --- |
| `api_host` | `dashscope.aliyuncs.com` | Model Studio API 主机名。输入完整 URL 时，脚本只使用其中的主机名 |
| `text_model` | `qwen3.8-max` | 非空的文本模型 ID |
| `image_model` | `qwen-image-3.0` | 非空的图片模型 ID |
| `image_size` | `auto` | `auto` 或 `宽x高`。宽和高必须在 512 到 2048 之间；无效值回退为 `1024*1024` |
| `prompt_extend` | `true` | `true` 或 `false`，控制图片提示词扩写 |
| `watermark` | `false` | `true` 或 `false`，控制图片水印 |
| `image_timeout` | `180` | 图片生成超时秒数。脚本把数值限制在 30 到 210 之间 |
| `debug` | `false` | `true` 或 `false`。启用后输出不含 API Key 的调试日志 |

下面的 URL 片段使用默认值：

```text
#api_host=dashscope.aliyuncs.com&text_model=qwen3.8-max&image_model=qwen-image-3.0&image_size=auto&prompt_extend=true&watermark=false&image_timeout=180&debug=false
```

### 失败行为和版本要求

请求缺少 API Key、请求正文不是 JSON 或图片提示词为空时，脚本返回 OpenAI 格式的错误响应。Model Studio 请求失败、响应无效或图片下载失败时，脚本返回上游错误，不把请求回退到 OpenAI。

Plexamp Qwen snippet 需要 QX 支持 `script-echo-response`、`script-analyze-echo-response`、`$task.fetch`、`$environment` 和二进制响应体。官方文档没有标注这些能力的最低版本，建议使用最新版本的 QX。

## Plex Fast Connect

### 作用

Plex 客户端会从 `plex.tv/api/resources` 获取 Plex Media Server 的多个连接地址。这个脚本会：

1. 在请求阶段移除缓存校验头，避免只收到 `304 Not Modified` 而没有可处理的资源正文。
2. 优先尝试 QX 偏好设置中缓存的官方 Plex `Device`，探测其直连地址。
3. 缓存失效时，从 Plex 官方响应中识别服务器并并发探测可用连接。
4. 把选中的连接写回响应；探测失败时保留官方原始响应，不阻断 Plex 登录或发现流程。

脚本只使用 Plex 官方返回的非 Relay 连接。它会并发探测这些连接，并使用第一个通过令牌验证的地址。

### 使用

1. 导入 [Plex Fast Connect snippet](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/plex-fast-connect.snippet)。
2. 确认 `plex.tv` 已加入 MITM，并开启 QX 重写。
3. 打开 Plex 客户端或触发一次服务器发现。

脚本会在 QX 的 `$prefs` 中缓存已识别的官方 Device。服务器返回 `401` 或 `403` 时，脚本会清除失效缓存，并重新使用 Plex 官方响应发现服务器。

### 固定行为

Plex snippet 不传递脚本参数，脚本也不读取 `$environment`。请求和响应规则直接引用同一个脚本 URL，脚本根据运行上下文区分阶段。

- 自动从 `plex.tv/api/resources` 发现服务器。
- 优先探测缓存 Device 中的非 Relay 连接。
- 每轮探测的超时时间固定为 3 秒。
- 不使用自定义地址，不回退到 Plex Relay，也不输出详细调试日志。
- 没有验证到可用连接时保留 Plex 官方原始响应。

### 版本要求

Plex snippet 需要 QX 支持 `script-request-header`、`script-response-body`、`$task.fetch` 和 `$prefs`。脚本不依赖 `$environment.sourcePath` 或 `$environment.variables`。官方文档没有标注这些脚本能力的最低版本，建议使用最新版本的 QX。

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

查看 QX 日志，并检查以下项目：

- 请求阶段和响应阶段两条规则是否都存在，且引用同一个脚本 URL。
- `plex.tv` MITM 是否生效。
- Plex 官方返回的非 Relay 地址是否能在设备上访问 `/library/sections`。
- Plex 官方返回的访问令牌是否仍有效。

探测不到可用连接时脚本会保留官方响应，这是预期的安全回退行为。

### Plexamp 没有生成文本或图片

查看 QX 日志，并检查以下项目：

- 三条 Plexamp Qwen 规则是否都已启用，且参数完全相同。
- `api.openai.com` MITM 是否生效，证书是否已被系统信任。
- Plexamp 中的 Model Studio API Key 是否有效。
- QX 是否能访问 GitHub Raw 脚本地址和 `api_host`。
- 自定义的模型 ID 是否可用于当前 Model Studio 账号。

把 `debug` 临时改为 `true` 可以查看路由和模型信息。日志不会主动输出 API Key 或完整请求正文。

## 文件结构

```text
.
├── Rewrites/
│   ├── kelee-loon-to-qx.snippet
│   ├── plex-fast-connect.snippet
│   └── plexamp-qwen.snippet
├── Scripts/
│   ├── kelee-loon-to-qx.js
│   ├── plex-fast-connect.js
│   └── plexamp-qwen.js
└── README.md
```

`.snippet` 是 QX 的导入入口，`.js` 是被 snippet 远程调用的脚本。项目不需要构建步骤，也没有第三方依赖；修改脚本后可在 QX 中通过远程 URL 验证实际行为。

## 安全提示

这些脚本运行在 QX MITM 环境中，请只从自己信任的地址导入。Plex Fast Connect 会读取 Plex 官方 `Device` 中的访问令牌，并把令牌用于探测官方返回的服务器地址。Plexamp Qwen 会读取请求中的 Model Studio API Key，并把它发送到 `api_host`。不要把 `api_host` 改成不信任的地址，也不要公开 QX 日志、带令牌的资源响应或 API Key。

仓库地址：[github.com/gogrhw/quantumult-x](https://github.com/gogrhw/quantumult-x)
