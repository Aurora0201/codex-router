# Codex Gateway

Codex Gateway 是一个只监听本机的透明代理。它为每个已授权 ChatGPT/Codex 账号维护独立 `CODEX_HOME`，按 thread/session 固定账号，并原样转发 Codex HTTP/SSE、WebSocket、remote compact 与 model catalog 请求。Gateway 不执行工具、不重写 Responses JSON，也不实现 OAuth refresh。

## 快速开始

要求 Node.js 24+。

```powershell
npm install
npm run build
npm start
```

打开 `http://127.0.0.1:8317/admin/`，点击“添加账号”，在 OpenAI 官方 OAuth 页面完成登录。官方 Codex CLI `0.147.0` 已作为服务端依赖锁定，Gateway 会用它启动隔离的 app-server。

将要通过 Gateway 使用的 Codex 配置为：

```toml
chatgpt_base_url = "http://127.0.0.1:8317/backend-api/codex"
```

然后正常运行 Codex。**添加账号后不会自动选中当前账号**：授权完成后在 Admin UI 手动选择 Current Account，新 thread 才会使用它。已有 thread、WebSocket 与 compact 请求继续使用最初绑定的账号；切换当前账号不会迁移已有会话。

开发模式同时启动 Gateway 与 Vite：

```powershell
npm run dev
```

## 管理功能

- Accounts：官方 Browser OAuth（无标签输入，以 ChatGPT Account ID 标记账号）、手动选择当前账号、认证刷新、额度刷新、启用/禁用和安全移除。
- Sessions：查看 routing key 哈希、Account ID、transport、账号与活跃状态；仅空闲会话可释放。
- Settings：metadata 日志开关与主题；Prompt/工具内容日志永久关闭。当前账号不在 Settings 中，属于运行状态，位于 Accounts 页面顶部与全局 Header。
- Dashboard：运行时间、活跃 session/WS、请求与错误统计。

账号认证只写入 `data/accounts/<id>/codex-home/`。登录过程中的临时工作区位于 `data/login-staging/`，成功后移入 accounts，失败则清理且不写数据库。SQLite 只保存 Account ID、状态、额度和路由 metadata，不包含 access/refresh/id token。FedRAMP 账号在本版本会被识别、禁用并显示“不支持”，不会静默忽略路由要求。

## 主账号隔离核验

添加 Gateway 账号前后分别运行：

```powershell
npm run hash:main-auth
```

两次 SHA-256 应完全一致。该命令只读主 Codex auth 文件，不输出任何 token。Gateway 的 app-server 子进程始终显式设置账号专属 `CODEX_HOME`。

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `GATEWAY_HOST` | `127.0.0.1` | 只接受 `127.0.0.1` 或 `::1` |
| `GATEWAY_PORT` | `8317` | 本地 Gateway/Admin 端口 |
| `GATEWAY_DATA_DIR` | `<repo>/data` | DB、隔离账号与登录暂存目录 |
| `CODEX_GATEWAY_CLI` | 锁定的官方 npm CLI | 可显式指定 Codex 可执行文件 |
| `GATEWAY_LOG_LEVEL` | `info` | Fastify/Pino 日志级别 |

自定义 upstream 默认被拒绝；只可在明确设置 `GATEWAY_DEVELOPER_MODE=true` 时使用，避免把认证发送到不可信服务。

## 验证

```powershell
npm test
npm run lint
npm run build
npm run test:e2e
```

测试完全在独立进程中运行：本地 mock upstream 验证原始 body、SSE 分段、取消、401 单次同账号刷新、429/compact 错误、models、WS Upgrade 头、首帧、ping/pong、close reason、重连和账号不可变；伪 Codex client 完成 shell/file/tool-output 多轮循环；另有真实的锁定版官方 app-server stdio 握手。测试不使用正在运行的 ChatGPT 客户端，也不访问真实账号。

当前锁定兼容基线：Node `24.x`、Codex CLI `0.147.0`，其 app-server schema 已核对 `account/login/start`、`account/login/completed`、`account/read` 和 `account/rateLimits/read`。

## 安全边界

- 数据面严格白名单：`POST /responses`、WS `GET /responses`、`POST /responses/compact`、`GET /models`；其他路径返回 501。
- 数据面拒绝浏览器 `Origin`/`Referer`；Admin mutation 要求同源 Origin、SameSite cookie 和 CSRF token。
- 客户端认证、Cookie 和 hop-by-hop headers 会被移除，再注入所选账号认证。
- Prompt、响应正文、工具参数和工具输出不进入日志或 SQLite。
- 不自动跨账号绕过 rate/usage limit；401 仅刷新并重试同一个账号一次，429 原样返回。
- 默认不对公网开放，不提供 CORS wildcard 或通用 open proxy。
