# Kelee Loon → Quantumult X

将 [Kelee 插件中心](https://hub.kelee.one) 的 Loon 导入链接自动转换为 Quantumult X 资源导入链接。

## 文件

```
Rewrites/kelee-loon-to-qx.snippet   # 重写规则（导入 Quantumult X）
Scripts/kelee-loon-to-qx.js         # 转换脚本
```

## 安装

Quantumult X 中导入 snippet 文件即可：

[https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/kelee-loon-to-qx.snippet](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/kelee-loon-to-qx.snippet)

## 原理

- **服务端重写**：拦截 `hub.kelee.one/list.json`，将 `loon://import?plugin=...` 替换为 `quantumult-x:///add-resource?remote-resource=...`
- **客户端重写**：拦截首页 HTML 注入脚本，hook `fetch()` 确保 SPA 动态获取的数据也被转换

## Plex Fast Connect

Surge 模块 Plex Fast Connect 的 Quantumult X 版本：自动探测 Plex Media Server 的可用连接，缓存官方 Device，并重写 plex.tv/api/resources 返回的连接列表。

Quantumult X 中导入 snippet：

[https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/plex-fast-connect.snippet](https://raw.githubusercontent.com/gogrhw/quantumult-x/refs/heads/main/Rewrites/plex-fast-connect.snippet)

参数直接修改 snippet 两条规则 URL 中 # 后的值；LAN/REMOTE 地址填 auto 即自动发现。首次使用需开启 Quantumult X MitM，并将 plex.tv 加入 hostname。

## 仓库

[github.com/gogrhw/quantumult-x](https://github.com/gogrhw/quantumult-x)
