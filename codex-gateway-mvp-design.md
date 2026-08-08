# Codex Gateway MVP 架构与设计指导文档

> 文档状态：MVP v1 设计基线  
> 核验日期：2026-08-08  
> 目标平台：优先 Windows / macOS / Linux 本地运行  
> 核心原则：轻量、透明代理、最大程度复用 Codex 官方能力、尽量不解释/改写 Responses 协议正文

---

> ## 修订记录（2026-08-08）：移除 Session 绑定
>
> 本基线早期章节中的 **会话粘性绑定（Session Sticky Routing / session_bindings）** 机制已移除。
> 新路由语义以本节为准，与下文冲突时以本节为准：
>
> - 不存在"会话 → 账号"绑定；每个请求一律使用当前手动选中的 active 账号。
> - 切换 active 账号在下一个请求立即生效，不迁移、不粘滞、不自动路由。
> - 未选中 active 账号时，所有数据面请求失败并返回 `no_active_account_selected`。
> - 网关不再解析请求正文中的 thread_id/session_id，数据面 payload 保持完全不透明。
> - `session_bindings` 表、Sessions API/页面、会话活动统计、`routing_key_hash` 均已删除。
>
> 下文中残留的 "Session Binding"、"sticky"、"默认账号只影响新会话" 等表述均为过期设计，
> 一律以上述新语义为准。

---

## 0. 文档目的

本文用于指导第一版 **Codex Gateway** 的实际开发。

目标不是重新实现 Codex，也不是重新实现 OpenAI Responses API，而是在 Codex 与 ChatGPT Codex 后端之间增加一层本地 Gateway：

1. 接管 Codex 的 HTTP/SSE 与 WebSocket 请求；
2. 在 Gateway 层替换请求认证信息；
3. 管理多个经用户本人授权的 ChatGPT/Codex 账号；
4. 保持 Codex 工具调用、Reasoning、流式输出、远端上下文压缩等能力不被破坏；
5. 提供 React 管理页面；
6. 尽可能使用官方现成组件与成熟库，不重复造轮子；
7. 将账号认证、请求转发、账号选择、管理 UI 明确分层。

本文特别区分：

- **[官方确认]**：能够从 OpenAI/Codex 官方文档或官方源码确认；
- **[架构决策]**：本项目为了可靠性、轻量化作出的实现选择；
- **[内部实现依赖]**：依赖 Codex 当前内部文件/行为，不属于稳定公共 API；
- **[非 MVP]**：第一版明确不做。

---

# 1. 第一版 MVP 的任务目标

## 1.1 MVP 的一句话目标

> 在不修改 Codex 核心代码、不重新实现 Responses API、不重新实现工具运行时的前提下，构建一个本地透明 Gateway，使 Codex 的 HTTP/SSE、WebSocket、工具调用、远端上下文压缩和模型发现能够正常通过 Gateway，并允许用户通过官方 ChatGPT OAuth 登录多个独立账号，由 Gateway 使用用户手动选中的当前账号处理所有请求。

---

## 1.2 第一版必须达成的 P0 能力

### P0-1：Codex 可以通过 Gateway 正常工作

必须支持：

- `POST /backend-api/codex/responses`
- `GET /backend-api/codex/responses` + `Upgrade: websocket`
- `POST /backend-api/codex/responses/compact`
- `GET /backend-api/codex/models`

Codex 客户端不需要理解账号池。

Gateway 对 Codex 来说应尽可能表现为一个兼容的 ChatGPT Codex backend。

---

### P0-2：HTTP/SSE 透明代理

必须做到：

- 请求正文原样发送到上游；
- 不把流式响应完整缓冲到内存；
- SSE 内容原样流回 Codex；
- 下游断开时及时中止上游请求；
- 正确转发 HTTP 状态码和必要响应头；
- 不解析、重写工具调用；
- 允许大请求体和长时间流式连接；
- 不把认证信息写入日志。

---

### P0-3：WebSocket Responses

必须做到：

- 正确处理 WebSocket Upgrade；
- 在握手阶段注入所选账号认证；
- 同一 WS 连接生命周期固定使用同一账号；
- 双向透明转发文本帧；
- 正确桥接 close code / close reason；
- 正确处理 ping / pong；
- 连接上游前，客户端早到的消息必须有**有界缓冲区**；
- 不因异步初始化而丢失第一批消息；
- 保留 Codex 依赖的上游 Upgrade 响应头。

---

### P0-4：Codex 工具调用完整可用

必须验证至少：

- Shell / command execution；
- 文件修改类工具；
- Function-call / tool-call 循环；
- 工具结果继续提交给模型；
- 多轮工具调用；
- Reasoning 输出；
- Responses 新增 item 类型不会因 Gateway JSON 重写而损坏。

**Gateway 不执行工具。**

工具仍然由 Codex 自己负责。

---

### P0-5：服务端上下文压缩

必须正确代理：

```text
POST /backend-api/codex/responses/compact
```

Gateway：

- 不自行计算上下文窗口；
- 不自行总结历史；
- 不自行裁剪会话；
- 不替代 Codex 的 remote compaction；
- 只确保压缩请求使用与该会话一致的账号认证并透明转发。

---

### P0-6：多账号浏览器登录

必须能够：

1. 在 React 管理页面点击“添加账号”；
2. 创建该账号独立的 `CODEX_HOME`；
3. 启动官方 `codex app-server`；
4. 调用官方 ChatGPT 登录流程；
5. 浏览器打开官方 OAuth 页面；
6. 用户完成登录；
7. Codex 官方组件持久化认证；
8. Gateway 将该账号加入账号列表。

**禁止从浏览器抓 Cookie 作为正式实现方式。**

---

### P0-7：认证替换

对 ChatGPT Codex 请求，Gateway 必须替换：

```http
Authorization: Bearer <selected access token>
ChatGPT-Account-ID: <selected account id>
```

若账号属于 Codex 当前实现识别的 FedRAMP 路径，则还必须正确处理：

```http
X-OpenAI-Fedramp: true
```

第一版若不准备完整测试 FedRAMP，应明确：

> 检测到 FedRAMP 账号时拒绝启用数据面代理，并在 UI 中显示“不支持的账号类型”。

不能默默忽略该标记。

---

### P0-8：Token 官方刷新

Gateway 不直接实现 OpenAI OAuth refresh HTTP。

应复用：

```text
codex app-server
```

并通过官方账号接口触发刷新。

当上游返回 401 且请求尚未产生有效流式输出时：

1. 对**同一账号**执行一次认证刷新；
2. 重新加载 access token；
3. 最多重试一次；
4. 若仍失败，原样返回认证错误。

---

### P0-9：账号状态与额度状态

管理页面至少展示：

- 账号标签；
- 登录邮箱（若官方账号信息提供）；
- Plan；
- Auth 状态；
- Primary rate-limit `usedPercent`；
- Primary `resetsAt`；
- Secondary rate-limit；
- 最后一次刷新时间；
- Enabled / Disabled；
- 是否默认账号。

Gateway 所谓“刷新额度”是：

> 重新读取官方返回的 rate-limit 状态。

不是人为改变或重置服务端额度。

---

### P0-10：账号选择路由（原"会话粘性路由"）

不引入会话/线程粘性绑定。所有请求使用当前 active 账号：

```text
Active = Account 2

请求 1 -> Account 2
请求 2 -> Account 2
WS     -> Account 2
Compact-> Account 2
```

切换 active 后：

```text
Active = Account 3
请求 3 -> Account 3
```

第一版明确不做：

```text
同一 Thread 的账号粘滞 / 会话级路由
```

---

### P0-11：React 管理页面

前端技术栈固定为：

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Google Fonts

第一版至少包含：

1. Dashboard / Accounts
2. Sessions
3. Settings

---

### P0-12：安全基线

必须做到：

- 默认仅监听 `127.0.0.1`；
- 不允许默认绑定 `0.0.0.0`；
- 数据面不启用 CORS；
- 数据面拒绝普通浏览器 Origin；
- Admin API 只允许同源管理 UI；
- Token 不进 SQLite；
- Token 不进日志；
- Prompt / Tool Output 默认不进日志；
- 每个账号独立 `CODEX_HOME`；
- 不修改用户主账号默认 `$CODEX_HOME`；
- 严格路由白名单。

---

# 2. 官方事实核验

## 2.1 Codex ChatGPT backend 地址

**[官方确认]**

Codex 当前官方源码定义：

```text
CHATGPT_CODEX_BASE_URL =
https://chatgpt.com/backend-api/codex
```

来源：

- OpenAI Codex 官方仓库  
  https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs

因此 ChatGPT 登录模式的 Codex 数据面应理解为：

```text
https://chatgpt.com/backend-api/codex/<path>
```

而不是简单认为所有请求都发送到：

```text
https://api.openai.com/v1
```

---

## 2.2 Codex Responses 使用 Responses wire API

**[官方确认]**

Codex 官方内置 OpenAI provider 当前使用 Responses wire API，并声明支持 WebSocket。

来源：

- https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs

因此 Gateway 第一版必须把 HTTP Responses 与 Responses WebSocket 视为同等级能力，而不是只代理传统 HTTP。

---

## 2.3 ChatGPT Codex 请求如何携带认证

**[官方确认]**

Codex 官方 `BearerAuthProvider` 当前会添加：

```http
Authorization: Bearer <access_token>
ChatGPT-Account-ID: <account_id>
```

对特定 FedRAMP 账号还会添加：

```http
X-OpenAI-Fedramp: true
```

来源：

- https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/bearer_auth_provider.rs

因此本项目不能把账号凭据抽象成单一字符串 Token。

建议数据结构：

```ts
interface CredentialSnapshot {
  accessToken: string
  accountId: string
  fedRamp: boolean
  loadedAt: number
}
```

---

## 2.4 官方已经验证“替换 Authorization 的代理模式”

**[官方确认]**

Codex 官方仓库中的：

```text
codex-responses-api-proxy
```

明确采用：

```text
删除客户端 Authorization
        ↓
注入代理服务器持有的 Authorization
        ↓
转发 /v1/responses
```

来源：

- https://github.com/openai/codex/blob/main/codex-rs/responses-api-proxy/README.md

所以：

> Gateway 在网络代理层删除客户端认证，再注入服务端选择的认证

本身不是一个臆测式设计，而是与官方现有代理实现同类的网络模式。

区别仅在于本项目的 Credential Provider 是账号池，而官方示例是一个 API Key。

---

## 2.5 Codex WebSocket

**[官方确认]**

Codex 官方 WebSocket Responses 实现中可以确认：

- WebSocket path 为 `responses`；
- WebSocket 认证通过同一认证 Provider 添加；
- 请求支持 `previous_response_id`；
- client metadata 包含：
  - `session_id`
  - `thread_id`
  - `turn_id`
- 客户端处理 `previous_response_not_found`；
- WebSocket 连接存在复用与恢复逻辑。

来源：

- https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/responses_websocket.rs

因此：

> 同一会话随意切换账号存在服务端状态不连续风险。

这也是 Session Sticky Routing 的直接技术依据。

---

## 2.6 Remote Compaction

**[官方确认]**

Codex 当前存在独立 Compact API 调用。

相关官方实现：

- https://github.com/openai/codex/blob/main/codex-rs/codex-api/README.md
- https://github.com/openai/codex/blob/main/codex-rs/core/src/compact_remote_request.rs

Gateway 的职责应是透明代理，而不是自己重新实现上下文摘要算法。

---

## 2.7 `/models`

**[官方确认]**

Codex 官方 Model Provider 代码中存在 provider-owned：

```text
/models
```

Endpoint。

来源：

- https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/models_endpoint.rs

因此如果 Codex 的 ChatGPT provider base URL 被整体指向 Gateway，只实现 `/responses` 是不完整的。

MVP 应同时支持：

```text
GET /backend-api/codex/models
```

---

## 2.8 Codex 官方 ChatGPT OAuth / 账号接口

**[官方确认]**

`codex app-server` 官方接口包含：

- `account/login/start`
- `account/login/completed`
- `account/read`
- `account/rateLimits/read`
- `account/rateLimits/updated`

以及 ChatGPT Browser OAuth。

来源：

- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

官方 App Server 负责：

- OAuth login；
- refresh token；
- token 持久化；
- token refresh。

因此 MVP 不应该重新实现 OAuth 协议。

---

## 2.9 Codex Token 数据结构

**[官方确认]**

当前 Codex 源码中的 TokenData 包括：

```text
id_token
access_token
refresh_token
account_id
```

来源：

- https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs

调用模型时真正需要的数据面信息主要是：

```text
access_token
account_id
FedRAMP routing state（若适用）
```

---

## 2.10 `chatgpt_base_url`

**[官方确认]**

Codex 当前配置中存在 `chatgpt_base_url`。

来源：

- https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs

因此本项目可以利用 Codex 官方现有配置入口把 ChatGPT 请求指向本地 Gateway，而不是 patch Codex 源码。

---

# 3. 合规与产品边界

## 3.1 必须明确的边界

OpenAI 当前公开条款禁止规避 Rate Limit / Usage Limit / protective measures。

官方来源：

- https://openai.com/policies/terms-of-use/

因此本项目第一版的账号池目标应定义为：

- 管理用户本人有权使用的多个账号或工作区；
- 明确选择新会话使用哪个账号；
- 登录隔离；
- Session binding；
- Token refresh；
- 额度状态展示；
- 管理测试账号、个人账号、工作账号等不同授权身份。

**不能把下面行为写成 MVP 目标：**

```text
账号 A 达到额度
        ↓
Gateway 自动切 A -> B
        ↓
继续请求以规避 A 的 Usage Limit
```

第一版不实现“额度耗尽自动轮换继续跑”。

---

## 3.2 动态切换的定义

本项目允许的“动态切换”应定义为：

### 新会话

允许：

```text
Default Account = A

用户在 UI 选择 B

下一条新的 Thread -> B
```

### 已有会话

保持：

```text
Thread X -> Account A
```

直到该 Session 结束或用户明确释放绑定。

---

# 4. 总体架构

```text
┌──────────────────────────────────────────────────────────────┐
│                        Codex Client                          │
│           CLI / IDE / future compatible clients             │
└───────────────────────────────┬──────────────────────────────┘
                                │
                         HTTP / SSE / WS
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                      Codex Gateway                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    Data Plane                          │  │
│  │                                                        │  │
│  │  Route Allowlist                                       │  │
│  │       ↓                                                │  │
│  │  Session Resolver                                      │  │
│  │       ↓                                                │  │
│  │  Session Binding                                       │  │
│  │       ↓                                                │  │
│  │  Credential Injector                                   │  │
│  │       ↓                                                │  │
│  │  HTTP/SSE Proxy │ WS Proxy │ Compact │ Models          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                   Control Plane                        │  │
│  │                                                        │  │
│  │  Account Service                                       │  │
│  │       │                                                │  │
│  │       ├── Codex App Server Adapter                     │  │
│  │       ├── Credential Snapshot Reader                   │  │
│  │       ├── Rate Limit Reader                            │  │
│  │       └── Per-Account Operation Lock                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                  Admin REST API                        │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬──────────────────────────────┘
                                │
           ┌────────────────────┴─────────────────────┐
           │                                          │
           ▼                                          ▼
┌────────────────────┐                       ┌──────────────────┐
│ SQLite Metadata DB │                       │ React Admin UI   │
│ no credentials     │                       │ Tailwind         │
└────────────────────┘                       │ shadcn/ui        │
                                             │ Google Fonts     │
                                             └──────────────────┘

                                │
                                ▼

            https://chatgpt.com/backend-api/codex
```

---

# 5. 架构原则

## 5.1 Gateway 是透明代理，不是协议解释器

Gateway 不应：

- 重新实现 Responses schema；
- 重新实现 Codex tool runtime；
- 对 Tool Calls 做业务转换；
- 把 SSE 转成自定义事件；
- 把 WS message 转成另一个协议；
- 自己做 context summarization；
- 自己构建新的模型请求。

核心原则：

```text
Inspect minimally
Mutate authentication only
Forward faithfully
```

---

## 5.2 允许“只读旁路解析”，禁止“重写”

为了 Session Resolver，Gateway 可以只读检查：

- HTTP header；
- HTTP request body 中少量 routing metadata；
- WS 第一个 `response.create` text frame。

但：

```text
原始 payload
```

必须保持原样发送上游。

例如：

```text
JSON.parse(rawBody)      ✅ 只为了读取 thread_id
undici.request(body=raw) ✅ 仍发送原始 raw bytes
```

不应该：

```text
JSON.parse()
修改对象
JSON.stringify()
```

这种做法容易改变未来 Responses item。

---

# 6. 技术栈

## 6.1 Runtime

推荐：

```text
Node.js 24 LTS
TypeScript
```

**[官方确认]**

截至文档核验日期，Node.js 24 为 LTS 线。

官方来源：

- https://nodejs.org/en/about/previous-releases

不建议 MVP 基于 Current 版本开发生产基线。

---

## 6.2 Backend

推荐：

```text
Fastify
Undici
@fastify/websocket
ws
better-sqlite3
```

### Fastify

用途：

- Admin REST API；
- 路由管理；
- 生命周期；
- HTTP Server；
- Schema validation（仅管理 API）。

官方：

- https://fastify.dev/docs/latest/

---

### Undici

用途：

- HTTP/SSE upstream request；
- Stream passthrough；
- AbortSignal；
- Connection pooling。

官方：

- https://github.com/nodejs/undici

MVP HTTP 数据面优先：

```ts
undici.request()
```

而不是完整 fetch buffer。

---

### @fastify/websocket + ws

用途：

- 接收 Codex WS；
- 建立 upstream WS；
- 双向转发。

官方：

- https://github.com/fastify/fastify-websocket

`@fastify/websocket` 建立在 `ws` 上。

注意其官方文档特别强调：

> WebSocket message handler 应同步注册，否则异步初始化期间可能丢失消息。

因此 MVP 的 WS Handler 必须：

1. 立即注册客户端 message/close/error handler；
2. 上游未连接前进入有界队列；
3. upstream ready 后按原顺序 flush。

---

### better-sqlite3

用途：

- 本地账号 metadata；
- Session bindings；
- Settings；
- 请求 metadata 日志。

官方：

- https://github.com/WiseLibs/better-sqlite3

建议：

```sql
PRAGMA journal_mode = WAL;
```

---

# 7. 前端技术栈

## 7.1 固定栈

```text
React
TypeScript
Vite
Tailwind CSS
shadcn/ui
Google Fonts
```

第一版不增加：

- Redux；
- MobX；
- Zustand；
- React Router（若单页面 tabs 足够）；
- 复杂图表库；
- 重型 Admin Framework。

---

## 7.2 Tailwind CSS

使用当前官方 Vite 方式。

官方：

- https://tailwindcss.com/docs/installation/using-vite

安装思路：

```bash
npm install tailwindcss @tailwindcss/vite
```

Vite plugin：

```ts
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
})
```

CSS：

```css
@import "tailwindcss";
```

不要按照旧教程默认生成传统 `tailwind.config.js`，除非项目后续确实需要额外配置。

---

# 8. shadcn/ui

使用 shadcn 官方 Vite 集成方式。

官方：

- https://ui.shadcn.com/docs/installation/vite

shadcn 的价值：

- 组件代码进入项目自身；
- 可以直接 Tailwind 定制；
- 没有一个笨重黑盒运行时；
- 非常适合本地工具管理后台。

建议第一版组件：

```text
Button
Card
Badge
Table
Dialog
Tabs
DropdownMenu
Tooltip
Alert
Input
Label
Switch
Skeleton
```

只安装实际用到的组件。

---

# 9. Google Fonts

官方：

- https://developers.google.com/fonts/docs/getting_started

推荐第一版：

```text
UI:
Noto Sans SC

技术字段 / ID:
Roboto Mono
```

HTML：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

<link
  href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
```

Tailwind theme：

```css
@theme inline {
  --font-sans:
    "Noto Sans SC",
    ui-sans-serif,
    system-ui,
    sans-serif;

  --font-mono:
    "Roboto Mono",
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace;
}
```

注意：

Google Fonts 属于在线字体服务。

若未来需要完全离线运行，可增加“system font mode”，但**MVP 不自行打包/分发字体文件**。

---

# 10. 推荐项目目录

保持简单：

```text
codex-gateway/
│
├── server/
│   ├── src/
│   │   ├── index.ts
│   │   │
│   │   ├── proxy/
│   │   │   ├── http-proxy.ts
│   │   │   ├── ws-proxy.ts
│   │   │   ├── compact-proxy.ts
│   │   │   ├── models-proxy.ts
│   │   │   ├── headers.ts
│   │   │   └── abort.ts
│   │   │
│   │   ├── routing/
│   │   │   ├── session-resolver.ts
│   │   │   ├── session-binding.ts
│   │   │   └── account-selector.ts
│   │   │
│   │   ├── accounts/
│   │   │   ├── account-service.ts
│   │   │   ├── app-server-client.ts
│   │   │   ├── credential-reader.ts
│   │   │   ├── rate-limit-service.ts
│   │   │   └── account-lock.ts
│   │   │
│   │   ├── db/
│   │   │   ├── database.ts
│   │   │   ├── migrations.ts
│   │   │   └── schema.sql
│   │   │
│   │   ├── api/
│   │   │   ├── health.ts
│   │   │   ├── accounts.ts
│   │   │   ├── sessions.ts
│   │   │   ├── settings.ts
│   │   │   └── stats.ts
│   │   │
│   │   ├── security/
│   │   │   ├── origin-guard.ts
│   │   │   ├── redaction.ts
│   │   │   └── admin-auth.ts
│   │   │
│   │   └── types/
│   │
│   └── package.json
│
├── web/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── AccountsPage.tsx
│   │   │   ├── SessionsPage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── components/
│   │   ├── lib/
│   │   │   └── api.ts
│   │   └── index.css
│   │
│   ├── index.html
│   └── package.json
│
├── data/
│   ├── gateway.db
│   └── accounts/
│       ├── <account-uuid>/
│       │   └── codex-home/
│       └── ...
│
├── package.json
└── README.md
```

第一版不引入：

```text
packages/domain
packages/infrastructure
packages/application
```

等企业级分层。

这个项目规模不需要为了架构形式增加复杂度。

---

# 11. Data Plane 设计

## 11.1 路由白名单

只允许：

```text
POST /backend-api/codex/responses

GET  /backend-api/codex/responses
     Upgrade: websocket

POST /backend-api/codex/responses/compact

GET  /backend-api/codex/models
```

其他 `/backend-api/codex/*`：

```http
501 Not Implemented
```

并输出明确错误：

```json
{
  "error": "unsupported_codex_gateway_route"
}
```

不能实现一个无限制的：

```text
/backend-api/*
```

Open Proxy。

---

# 12. HTTP / SSE Proxy

## 12.1 请求路径

```text
Codex
  ↓
Gateway
  ↓
Session Resolver
  ↓
Account Binding
  ↓
Credential Reader
  ↓
Header Sanitizer
  ↓
Undici
  ↓
chatgpt.com/backend-api/codex/responses
```

---

## 12.2 Request Body

原则：

```text
raw in
raw out
```

若为了 Session Resolver 需要读取 metadata：

1. 缓存原始 body bytes；
2. 尝试只读 JSON parse；
3. 提取 routing key；
4. upstream 仍发送原始 bytes。

**不得重新 stringify。**

---

## 12.3 必须替换的 Header

从客户端删除：

```text
Authorization
ChatGPT-Account-ID
X-OpenAI-Fedramp
Cookie
Host
```

然后根据选定账号重新注入：

```http
Authorization: Bearer <access token>
ChatGPT-Account-ID: <account id>
```

FedRAMP 账号：

```http
X-OpenAI-Fedramp: true
```

---

## 12.4 Hop-by-hop headers

普通 HTTP 转发应过滤：

```text
Connection
Proxy-Connection
Keep-Alive
Proxy-Authenticate
Proxy-Authorization
TE
Trailer
Transfer-Encoding
Upgrade
```

由 Node / Undici 重新构造底层连接行为。

---

## 12.5 应保留的应用 Header

除敏感/连接级 Header 外，应尽可能保留 Codex 应用层 Header，例如：

```text
OpenAI-Beta
Originator
Version
User-Agent
x-client-request-id
x-codex-*
session-id
thread-id
```

原则不是维护一份“允许列表”，而是：

> 删除明确不应透传的 hop-by-hop 和 auth/header，其他应用头尽可能透明。

---

## 12.6 Streaming

不允许：

```ts
const text = await upstream.body.text()
reply.send(text)
```

应该：

```text
upstream Readable
      ↓
downstream socket
```

并处理：

```text
downstream close
      ↓
AbortController.abort()
      ↓
cancel upstream
```

---

# 13. WebSocket Proxy

## 13.1 生命周期

```text
Codex WS
   ↓
Gateway Upgrade
   ↓
Session resolution
   ↓
Account binding
   ↓
Credential injection
   ↓
Upstream WSS
   ↓
Bidirectional bridge
```

---

## 13.2 第一原则

一个 WS Connection：

```text
Connection ID 7
        ↓
Account A
```

连接存续期间绝不切换：

```text
A -> B
```

---

## 13.3 Message handler 必须同步注册

根据 `@fastify/websocket` 官方指导：

在 WebSocket handler 一进入时立即：

```ts
socket.on("message", ...)
socket.on("close", ...)
socket.on("error", ...)
```

不要：

```ts
await loadCredential()
socket.on("message", ...)
```

因为 await 期间可能已有客户端消息抵达。

---

## 13.4 连接前缓冲

推荐：

```text
MAX_PENDING_FRAMES = 32
MAX_PENDING_BYTES  = 2 MiB
```

这是**架构建议值**，不是 Codex 官方值。

超出：

```text
close(1013, "upstream_not_ready")
```

避免恶意或异常客户端无限占内存。

---

## 13.5 Frame 转发

默认：

```text
text frame in
      ↓
text frame out
```

为了 Session Resolver，可以旁路读取首个 text frame。

但转发的必须仍是：

```text
original frame text
```

---

## 13.6 Upgrade response header

官方 Codex WS 代码会读取上游升级响应中的应用信息。

Gateway 应尽可能将上游 101 Response 中相关头传回 Codex，特别注意当前 Codex 源码出现的：

```text
x-codex-turn-state
x-models-etag
x-reasoning-included
openai-model
```

该能力必须有集成测试。

---

# 14. 工具调用设计

## 14.1 Gateway 完全不执行工具

Codex 负责：

```text
model response
   ↓
tool call
   ↓
Codex executes tool
   ↓
tool result
   ↓
next Responses request
```

Gateway 看到的只是：

```text
request body
response stream
WS frames
```

---

## 14.2 为什么必须这样

如果 Gateway 解析并重新生成：

```text
function_call
function_call_output
tool_search
program
program_output
reasoning
```

每次 Codex / Responses 新增 item 类型，都可能要求 Gateway 升级。

透明代理可以把协议兼容责任留给 Codex 官方实现。

---

# 15. Server-side Context Compaction

## 15.1 Gateway 需要支持的能力

```text
POST /backend-api/codex/responses/compact
```

---

## 15.2 账号选择一致性

所有请求（`responses`、`responses/compact`、`models`、WebSocket）使用当前
active 账号：

```text
Active = Account B

responses        -> B
responses        -> B
responses/compact-> B
responses        -> B
```

切换 active 后，后续请求立即使用新账号；不依赖任何路由 key。

---

## 15.3 Gateway 不负责的内容

**[非 MVP]**

```text
自己统计 token
自己决定何时 compact
自己调用模型总结
自己裁剪历史
自己生成 replacement context
```

这些继续由 Codex 负责。

---

# 16. `/models` 设计

## 16.1 为什么需要

如果 Codex ChatGPT base URL 指向 Gateway：

```text
chatgpt_base_url = http://127.0.0.1:8317/backend-api/codex
```

provider path 会相对于该 base URL 请求。

Codex 当前存在 `/models` endpoint。

因此 MVP 必须代理模型列表。

---

## 16.2 模型列表使用哪个账号

模型能力可能跟账号/plan有关。

第一版建议：

```text
Catalog Account
```

默认规则：

1. 如果存在 `default account`：
   - 使用 default account；
2. 否则使用第一个 enabled + authenticated account；
3. 如果无账号：
   - 返回 503。

不在第一版缓存 `/models`。

减少账号切换导致 stale model catalog 的问题。

---

# 17. Session Resolver

## 17.1 Routing Key 优先级

建议：

```text
1. 明确 thread id
2. 明确 session id
3. WS connection binding
4. previous_response_id mapping（可选增强）
5. temporary request routing key
```

---

## 17.2 HTTP

优先从应用 Header 读取。

若当前 Codex 请求没有可用 header：

只读解析 raw request body 中当前可识别 metadata：

```text
client_metadata.thread_id
client_metadata.session_id
previous_response_id
```

提取后仍发送 raw body。

---

## 17.3 WebSocket

首个 `response.create`：

```text
read-only parse
        ↓
extract thread/session
        ↓
bind account
        ↓
forward original text
```

---

# 18. Session Binding

数据库表：

```sql
CREATE TABLE session_bindings (
  routing_key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  thread_id TEXT,
  session_id TEXT,
  transport TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);
```

第一版：

```text
status:
active
closed
expired
```

---

# 19. Account Selection

## 19.1 MVP 不需要复杂 Scheduler

第一版：

```text
active account
```

为主。

UI 允许：

```text
Set as active
```

active 账号决定：

> 所有请求使用的账号；切换 active 在下一个请求立即生效。

---

## 19.2 无会话绑定

不存在"会话/线程 → 账号"的绑定。任意两个请求（无论是否携带相同
thread_id / session_id）都独立使用当前 active 账号。

若：

```text
请求 1 -> Account A
```

切换到：

```text
Active -> B
```

请求 2 直接使用：

```text
B
```

---

# 20. Rate Limit 行为

## 20.1 数据来源

使用官方：

```text
account/rateLimits/read
```

当前官方 App Server 数据中包含：

- Primary / Secondary；
- `usedPercent`；
- `windowDurationMins`；
- `resetsAt`；
- rate-limit reached status。

Gateway 只缓存该状态。

---

## 20.2 UI 显示

例如：

```text
Primary
Used        63%
Reset       01:42:18
Window      300 min
```

不是显示：

```text
Remaining requests: 37
```

除非官方接口真的提供对应数据。

不要自行把 `usedPercent` 推导成并不存在的请求次数。

---

## 20.3 自动状态刷新

可以：

```text
启动时刷新
+
每 5 分钟刷新
+
接近 resetsAt 时刷新
+
用户点击 Refresh
```

这只是重新读取状态。

---

# 21. Credential Control Plane

## 21.1 一个账号一个 CODEX_HOME

目录：

```text
data/accounts/
├── <uuid-A>/
│   └── codex-home/
├── <uuid-B>/
│   └── codex-home/
└── <uuid-C>/
    └── codex-home/
```

不能共用。

---

## 21.2 不修改用户主 Codex Home

必须做验收：

```text
用户原始 ~/.codex/auth.json
```

在使用 Gateway 添加账号前后：

```text
hash unchanged
```

除非用户主动在原始 Codex 中重新登录。

---

# 22. 浏览器 OAuth 流程

```text
React
  ↓
POST /api/accounts/login
  ↓
Gateway creates account workspace
  ↓
spawn codex app-server
with isolated CODEX_HOME
  ↓
account/login/start
type = chatgpt
  ↓
official login URL
  ↓
React opens browser
  ↓
OpenAI OAuth
  ↓
login completed
  ↓
Codex persists auth
  ↓
Gateway reads account metadata
  ↓
account appears in UI
```

---

# 23. Credential Snapshot Reader

这里需要非常明确地区分：

## 23.1 官方公开能力

App Server：

- 登录；
- 账号读取；
- rate limits；
- refresh。

## 23.2 当前缺口

Gateway 数据面最终需要：

```text
access_token
account_id
```

但当前 App Server 公共 RPC 设计重点是账号管理，并不是“把 access token 通过 RPC 导出给第三方”。

---

## 23.3 MVP 的务实方案

**[内部实现依赖]**

每个 Gateway-owned CODEX_HOME 明确配置：

```toml
cli_auth_credentials_store = "file"
```

然后：

```text
CredentialSnapshotReader
```

只读 Gateway 自己创建的该账号 Codex auth file。

Codex 当前官方源码定义了 auth file storage 和 token data structure。

来源：

- https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs
- https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs

---

## 23.4 非稳定 API 警告

`auth.json` 结构属于：

> 官方源码定义的内部持久化合同

但不能假设它等于长期稳定 Public API。

因此必须增加：

```text
CodexAuthFileAdapter
```

隔离这种依赖。

启动时：

1. 检查文件 schema；
2. 检查必要字段；
3. 无法识别则 Fail Closed；
4. UI 显示“当前 Codex 版本认证格式不兼容”。

---

## 23.5 Credential Reader 不操作 Refresh Token

Reader：

```text
只读取：
access token
account id
FedRAMP claim/state
```

Refresh：

```text
必须交给 codex app-server
```

不要自己 POST OAuth token endpoint。

---

# 24. Token Refresh

流程：

```text
Upstream 401
    ↓
Has response started?
    ├── yes -> do not retry
    └── no
         ↓
Per-account mutex
         ↓
codex app-server
         ↓
account/read { refreshToken: true }
         ↓
reload auth snapshot
         ↓
retry once
```

---

## 24.1 为什么需要 per-account mutex

同一个账号不能同时：

```text
Refresh 1
Refresh 2
Refresh 3
```

MVP：

```ts
Map<AccountId, Promise<void>>
```

或简单 async mutex。

不必增加 Redis。

---

# 25. SQLite 数据设计

## 25.1 accounts

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  email TEXT,
  plan_type TEXT,

  codex_home TEXT NOT NULL,

  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,

  auth_status TEXT NOT NULL,
  fedramp INTEGER NOT NULL DEFAULT 0,

  primary_used_percent REAL,
  primary_resets_at INTEGER,

  secondary_used_percent REAL,
  secondary_resets_at INTEGER,

  last_auth_refresh_at INTEGER,
  last_limits_refresh_at INTEGER,
  last_used_at INTEGER,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

---

## 25.2 不允许出现的字段

不能存在：

```text
access_token
refresh_token
id_token
password
browser_cookie
```

---

## 25.3 settings

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
```

---

## 25.4 request_log

默认仅 metadata：

```sql
CREATE TABLE request_log (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  route TEXT NOT NULL,
  transport TEXT NOT NULL,
  account_id TEXT,
  routing_key_hash TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  bytes_in INTEGER,
  bytes_out INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL
);
```

默认不存：

```text
prompt
response text
tool arguments
tool output
Authorization
ChatGPT-Account-ID
```

---

# 26. Admin REST API

## 26.1 Health

```http
GET /api/health
```

返回：

```json
{
  "status": "ok",
  "upstream": "configured",
  "accounts": 3
}
```

---

## 26.2 Accounts

```text
GET    /api/accounts
POST   /api/accounts/login
GET    /api/accounts/login/:loginId/status

PATCH  /api/accounts/:id
DELETE /api/accounts/:id

POST   /api/accounts/:id/set-default
POST   /api/accounts/:id/refresh-auth
POST   /api/accounts/:id/refresh-limits
```

---

## 26.3 Sessions

```text
GET  /api/sessions
POST /api/sessions/:id/release
```

只有没有活动 WS / in-flight request 的 Session 才允许 release。

---

## 26.4 Settings

```text
GET   /api/settings
PATCH /api/settings
```

---

## 26.5 Stats

```text
GET /api/stats
```

仅提供 metadata statistics。

---

# 27. React 管理页面

## 27.1 整体 UI

目标风格：

- 极简；
- 本地开发工具；
- 信息密度中高；
- 不做大面积渐变；
- 不做营销 Landing Page；
- 账号状态必须一眼可见。

布局：

```text
┌────────────────────────────────────────────────────────────┐
│ Codex Gateway                            ● Gateway Online   │
├────────────────────────────────────────────────────────────┤
│ Accounts     Sessions     Settings                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│                       Page Content                         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

# 28. Accounts Page

主要表格：

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Account      Plan     Primary       Reset      Auth       Default       │
├─────────────────────────────────────────────────────────────────────────┤
│ Personal     Plus     63% used      1h 42m     Ready        ●           │
│ Work         Pro      21% used      3h 12m     Ready                    │
│ Test         Plus     --            --         Re-login                 │
└─────────────────────────────────────────────────────────────────────────┘
```

Actions：

```text
Add Account
Refresh Limits
Refresh Auth
Set Default
Disable
Remove
```

---

## 28.1 Add Account Dialog

状态：

```text
Idle
Launching OAuth
Waiting for browser login
Completing
Success
Failed
```

显示：

```text
Open login page
Copy login URL
Cancel
```

但真正授权必须发生在 OpenAI 官方页面。

---

# 29. Sessions Page

```text
Thread / Session
Account
Transport
Status
Started
Last activity
```

例如：

```text
019e...     Personal     WS      Active     00:31:02
019f...     Work         HTTP    Idle       00:12:11
```

Debug 展开项可以显示：

```text
routing key hash
WS connection id
request count
last status
```

不显示完整 Prompt。

---

# 30. Settings Page

第一版：

```text
Gateway Address
127.0.0.1

Gateway Port
8317

Upstream
https://chatgpt.com/backend-api/codex

Default Account
[ Personal ▼ ]

Request Metadata Logging
[ ON ]

Prompt Logging
[ OFF / locked ]

Theme
System / Light / Dark
```

上游 URL MVP 可以显示但默认不可随便改。

若允许开发模式修改，需要单独启用：

```text
Developer Mode
```

避免误将认证发送到不可信站点。

---

# 31. 前端状态管理

第一版不引入全局状态框架。

使用：

```text
React state
+
fetch()
+
small API client
```

Accounts / Sessions：

```text
5 秒轮询
```

即可。

后续如果后台数据复杂，再评估 TanStack Query。

第一版不要为了“规范”先引入依赖。

---

# 32. HTTP Retry 规则

## 32.1 401

允许：

```text
same-account credential refresh
+
retry once
```

前提：

```text
response has not started
```

---

## 32.2 429

不自动切其他账号。

行为：

```text
mark account status
refresh rate limits
return upstream error
```

---

## 32.3 5xx

第一版：

```text
do not account failover
```

透明返回。

避免把真正的模型端问题误判为账号问题。

---

# 33. WebSocket Retry

握手阶段 401：

```text
refresh same account
reconnect once
```

已经有业务 frame 成功交互后：

```text
不自动重建到另一个账号
```

Codex 自身的 Responses WS 恢复逻辑继续负责上层行为。

---

# 34. 安全设计

## 34.1 Loopback only

默认：

```text
127.0.0.1
```

不允许：

```text
0.0.0.0
```

除非未来显式启用高级远程模式。

---

## 34.2 Browser Origin Guard

推理数据面：

如果请求包含普通网页：

```text
Origin
Referer
```

默认拒绝。

管理 UI 自身请求只访问 `/api/*`。

这样可以减少浏览器页面诱导 localhost 请求的风险。

---

## 34.3 Admin API

Admin UI 与 Admin API：

```text
same origin
```

不要：

```text
Access-Control-Allow-Origin: *
```

State-changing API：

- 校验 Origin；
- SameSite Cookie；
- CSRF protection。

---

## 34.4 Token Redaction

日志 middleware 统一删除：

```text
Authorization
ChatGPT-Account-ID
Cookie
Set-Cookie
refresh_token
access_token
id_token
```

---

## 34.5 Request Body Logging

默认：

```text
OFF
```

不能为了调试默认记录：

- Prompt；
- Tool arguments；
- Tool output；
- Source code。

---

# 35. 可观测性

第一版不接 Prometheus。

内存 + SQLite metadata 足够。

Dashboard 可以显示：

```text
Gateway uptime
Active sessions
Active WS
Requests today
Error rate
Accounts ready
```

---

# 36. Codex 配置接入

当前 Codex 官方配置存在：

```toml
chatgpt_base_url = "..."
```

MVP 推荐验证：

```toml
chatgpt_base_url = "http://127.0.0.1:8317/backend-api/codex"
```

**注意：**

`chatgpt_base_url` 是全局 ChatGPT 请求基础地址。

因此 Gateway 必须对未知 endpoint：

```text
Fail Closed
```

而不是把所有路径无条件转发。

集成测试必须确认当前目标 Codex 版本启动和运行实际访问了哪些路径。

---

# 37. 版本兼容策略

Codex 正在快速演进。

不要在代码里假定：

```text
Codex 永远只有某几个 JSON 字段
```

应该：

```text
Transport stable
Body opaque
Auth adapter isolated
```

---

## 37.1 必须锁定测试版本

开发开始时记录：

```text
codex --version
node --version
npm lockfile
```

CI 中保留该版本作为最低已验证版本。

本文不虚构一个 Codex 版本号。

---

## 37.2 Compatibility Smoke Test

每次升级 Codex：

```text
/models
HTTP/SSE
Tool Call
WS
Compact
OAuth Add Account
Token Refresh
```

全部跑一次。

---

# 38. 第一版开发阶段

## Milestone 0：工程基线

目标：

- Node 24 LTS；
- TypeScript；
- server/web workspace；
- ESLint/TypeScript build；
- SQLite WAL；
- React + Vite；
- Tailwind；
- shadcn；
- Google Fonts；
- `/api/health`。

完成标准：

```text
npm install
npm run dev
```

可以同时启动：

```text
Gateway
React Admin
```

---

# 39. Milestone 1：账号控制面

实现：

- Gateway-owned CODEX_HOME；
- `codex app-server` adapter；
- Browser OAuth；
- Account read；
- Auth file adapter；
- Rate-limit read；
- Token refresh；
- Accounts UI。

完成标准：

1. 添加两个账号；
2. 两个账号存储目录完全隔离；
3. 原主 `$CODEX_HOME` 未修改；
4. UI 能看到 plan / auth status；
5. UI 能读取官方 rate limit；
6. Refresh Auth 可以正常完成；
7. DB 中没有 Token。

---

# 40. Milestone 2：HTTP/SSE + Models + Compact

实现：

- `/responses`
- `/responses/compact`
- `/models`
- raw body passthrough；
- auth replacement；
- streaming；
- abort；
- same-account 401 refresh once。

完成标准：

```text
Codex 使用 Gateway 能完成普通问答
```

并确认：

- 第一段 stream 在请求结束前到达；
- Gateway 不会完整缓存响应；
- `/models` 可用；
- Compact route 可触发。

---

# 41. Milestone 3：工具调用

完成测试：

1. 让 Codex读取项目文件；
2. 执行 shell command；
3. 修改一个测试文件；
4. 将工具结果返回模型；
5. 模型继续下一轮；
6. Gateway 无需理解工具类型。

验收重点：

```text
Gateway request/response body mutation = 0
```

除认证 header。

---

# 42. Milestone 4：WebSocket

实现：

- WS Upgrade；
- upstream WS；
- auth injection；
- sync listeners；
- bounded queue；
- close bridge；
- ping/pong；
- Upgrade response headers；
- connection sticky account。

验收：

- Codex WS 模式正常；
- 连续多轮；
- 工具调用；
- reconnect；
- 同一 WS 全程 account id 不变。

---

# 43. Milestone 5：Session Routing

实现：

- thread/session resolver；
- binding persistence；
- Sessions UI；
- default account；
- manual release。

验收：

```text
新 Thread -> Current Default

已有 Thread -> Original Account
```

切 Default 不影响已有 Thread。

---

# 44. Milestone 6：安全与稳定性

必须完成：

- Loopback binding；
- Route allowlist；
- Origin guard；
- Header redaction；
- No prompt logs；
- Admin CSRF；
- request body size protection；
- WS pending buffer limit；
- graceful shutdown；
- SQLite migrations；
- account auth mutex。

---

# 45. MVP 最终验收清单

## A. 主账号隔离

- [ ] 记录原 `$CODEX_HOME` auth 文件 hash
- [ ] Gateway 添加账号
- [ ] Gateway 完成请求
- [ ] 原 auth 文件 hash 未变化

---

## B. HTTP/SSE

- [ ] Codex 请求成功
- [ ] SSE 流式输出
- [ ] 没有完整 buffer
- [ ] Client cancel 会 abort upstream
- [ ] Status/header 正常

---

## C. `/models`

- [ ] Codex 能正常加载模型列表
- [ ] Gateway 使用明确 Catalog Account
- [ ] 无账号时返回明确 503

---

## D. Tool Calls

- [ ] Shell
- [ ] File read
- [ ] File modification
- [ ] Multi-turn tool call
- [ ] Tool output continuation
- [ ] Gateway 不解析重写工具 schema

---

## E. Compact

- [ ] `/responses/compact` 被正确代理
- [ ] Compact 使用 Session 原账号
- [ ] 上游 compact 错误透明返回
- [ ] Gateway 不自行 summarization

---

## F. WebSocket

- [ ] Upgrade 成功
- [ ] WS authentication 被替换
- [ ] 早到 message 不丢失
- [ ] 双向 text frames 正常
- [ ] ping/pong
- [ ] close code/reason
- [ ] 重要 Upgrade header
- [ ] connection lifetime account immutable

---

## G. OAuth

- [ ] UI Add Account
- [ ] 官方 Browser OAuth
- [ ] Account isolated CODEX_HOME
- [ ] Login completion
- [ ] Account metadata
- [ ] Logout/remove

---

## H. Auth Refresh

- [ ] Token 不由 Gateway 自己 refresh HTTP
- [ ] 401 -> same account refresh
- [ ] retry <= 1
- [ ] partial stream 后不 replay

---

## I. Rate Limits

- [ ] 官方 `account/rateLimits/read`
- [ ] usedPercent
- [ ] resetsAt
- [ ] refresh timestamp
- [ ] 不伪造 remaining request count

---

## J. Session Sticky

> **已废弃**：会话粘性绑定已移除，本清单作废。

- [x] ~~Thread -> stable account~~
- [x] ~~Compact -> same account~~
- [x] ~~WS -> same account~~
- [x] ~~Default switch 不迁移已有 thread~~

---

## K. Security

- [ ] 127.0.0.1 only
- [ ] No wildcard CORS
- [ ] Browser Origin guard
- [ ] DB no secrets
- [ ] Logs no secrets
- [ ] Prompt logs OFF
- [ ] Strict data-plane path allowlist

---

# 46. 第一版明确不做

为了保持轻量：

```text
❌ Redis
❌ PostgreSQL
❌ Docker 强依赖
❌ Kubernetes
❌ 多机器
❌ SaaS 多租户
❌ 用户注册系统
❌ RBAC
❌ 自己实现 OAuth
❌ 自己实现 Refresh Token 协议
❌ 自己实现 Responses API
❌ 自己实现 Tool Runtime
❌ 自己实现 Context Summarizer
❌ 自动跨账号绕过 Usage Limit
❌ Prompt 全量日志
❌ 对公网开放
```

---

# 47. 后续版本可以考虑

## V1.1

- request metadata diagnostics；
- Models cache；
- Account health；
- session expiration；
- version compatibility detector；
- better WS reconnect diagnostics。

## V1.2

- system tray；
- Windows auto-start；
- packaged desktop shell；
- export diagnostic bundle（自动脱敏）。

## V2

如果确实存在合理业务需求，再评估：

- authorized workspace routing；
- remote control plane；
- local IPC；
- encrypted credential bridge；
- multi-machine gateway。

---

# 48. 关键风险

## 风险 1：Codex 内部 auth 文件格式变化

影响：

```text
CredentialSnapshotReader
```

解决：

- Adapter 独立；
- schema validation；
- fail closed；
- pin Codex version；
- upgrade smoke test。

---

## 风险 2：Codex 新增 backend endpoints

解决：

- 未知 path 记录；
- 返回 501；
- 升级时通过 smoke test 决定是否加入 allowlist。

---

## 风险 3：WebSocket 行为变化

解决：

- 不解析/转换业务 frame；
- 只做代理；
- Upgrade header tests；
- connection-level integration test。

---

## 风险 4：账号状态与 Session state 不一致

> **已废弃**：会话绑定机制已移除，本风险不适用。

```text
Active account is authoritative
```

所有请求使用当前 active 账号，无会话状态需要与账号对齐。

---

## 风险 5：本地代理泄露 Token

解决：

- Loopback only；
- Origin Guard；
- strict routes；
- no logging；
- no DB secrets；
- auth file ACL；
- future IPC。

---

# 49. 推荐核心接口

```ts
interface AccountService {
  startBrowserLogin(label: string): Promise<LoginSession>
  getAccount(id: string): Promise<AccountView>
  refreshAuth(id: string): Promise<void>
  refreshRateLimits(id: string): Promise<RateLimitSnapshot>
  removeAccount(id: string): Promise<void>
}
```

```ts
interface CredentialProvider {
  getSnapshot(accountId: string): Promise<CredentialSnapshot>
  refresh(accountId: string): Promise<CredentialSnapshot>
}
```

```ts
interface SessionResolver {
  resolveHttp(req: IncomingMessage, rawBody: Buffer): RoutingIdentity
  resolveWs(firstFrame: string): RoutingIdentity
}
```

```ts
interface SessionBindingStore {
  get(routingKey: string): SessionBinding | null
  bind(routingKey: string, accountId: string): SessionBinding
  touch(routingKey: string): void
  release(routingKey: string): void
}
```

---

# 50. 推荐 HTTP 代理伪代码

```ts
async function proxyResponses(req, reply) {
  const rawBody = await readRawBody(req)

  const identity = sessionResolver.resolveHttp(req.raw, rawBody)

  const account = await bindingService.resolveAccount(identity)

  let credential = await credentials.getSnapshot(account.id)

  const upstreamHeaders = buildUpstreamHeaders(
    req.headers,
    credential
  )

  let upstream = await sendUpstream({
    path: "/responses",
    method: "POST",
    headers: upstreamHeaders,
    body: rawBody,
  })

  if (upstream.statusCode === 401 && !reply.raw.headersSent) {
    credential = await credentials.refresh(account.id)

    upstream = await sendUpstream({
      path: "/responses",
      method: "POST",
      headers: buildUpstreamHeaders(req.headers, credential),
      body: rawBody,
    })
  }

  copyResponseHeaders(upstream, reply)

  reply.raw.writeHead(upstream.statusCode)

  await pipeline(
    upstream.body,
    reply.raw
  )
}
```

真实实现需要补充：

- AbortSignal；
- content length；
- stream error；
- timeout；
- connection close；
- metrics；
- redaction。

---

# 51. 推荐 WebSocket 伪代码

```ts
function handleClientSocket(clientSocket) {
  const pendingFrames = []
  let upstreamSocket = null
  let bindingPromise = null

  clientSocket.on("message", (data, isBinary) => {
    if (!bindingPromise) {
      bindingPromise = resolveAndConnectUpstream(data)
    }

    if (!upstreamSocket) {
      enqueueBounded(pendingFrames, data, isBinary)
      return
    }

    upstreamSocket.send(data, { binary: isBinary })
  })

  clientSocket.on("close", (code, reason) => {
    upstreamSocket?.close(code, reason)
  })

  clientSocket.on("error", () => {
    upstreamSocket?.terminate()
  })

  async function resolveAndConnectUpstream(firstFrame) {
    const identity = inspectFirstFrameReadOnly(firstFrame)

    const account = await bindingService.resolveAccount(identity)

    const credential = await credentials.getSnapshot(account.id)

    upstreamSocket = await connectUpstreamWs(credential)

    bridgeUpstreamEvents(upstreamSocket, clientSocket)

    flushPendingFrames(pendingFrames, upstreamSocket)
  }
}
```

重点不是代码形式，而是：

> handler 必须在 await 之前安装。

---

# 52. UI 设计 Token 建议

使用 shadcn 默认 CSS Variables。

不要建立一套复杂品牌色。

建议：

```text
Background
Card
Muted
Border
Primary
Destructive
```

账号状态：

```text
Ready        Badge default/secondary
Refreshing   Badge outline + spinner
Rate Limited Badge destructive
Re-login     Badge destructive
Disabled     Badge outline
```

不要只依赖颜色表达状态，必须同时显示文字。

---

# 53. 关于“轻量级”的最终约束

MVP 的进程模型建议：

```text
1 × Node Gateway process

0-N × temporary codex app-server process
     only when login/refresh/status operations need it

1 × SQLite DB

1 × React static frontend
served by Gateway in production
```

正式发布时：

React：

```text
vite build
```

然后让 Fastify 直接托管：

```text
web/dist
```

不需要单独的前端生产进程。

---

# 54. 最终产品行为

用户启动：

```text
codex-gateway
```

看到：

```text
Gateway:
http://127.0.0.1:8317

Admin:
http://127.0.0.1:8317/admin
```

添加账号：

```text
Admin
  ↓
Add Account
  ↓
OpenAI OAuth
  ↓
Ready
```

Codex：

```text
Codex
   ↓
Local Gateway
   ↓
Session Binding
   ↓
Credential Replacement
   ↓
ChatGPT Codex Backend
```

而：

```text
tools
reasoning
streaming
websocket
compact
models
```

仍由官方 Codex / upstream 协议自然工作。

---

# 55. 最重要的实现准则

如果开发过程中出现：

> “为了支持某个工具，我们是不是需要 Gateway 理解它？”

默认答案应是：

```text
不需要。
```

如果出现：

> “为了支持 compact，我们是不是自己总结上下文？”

答案：

```text
不需要。
```

如果出现：

> “为了刷新 token，我们是不是自己写 OAuth refresh？”

答案：

```text
不需要。
```

如果出现：

> “为了账号池，我们是不是每个请求都随机换账号？”

答案：

```text
不应该。
```

整个 Gateway 的核心价值应该一直保持：

```text
Transport
+
Identity Routing
+
Credential Injection
+
Account Control Plane
```

而不是逐渐长成第二个 Codex。

---

# 56. 官方资料索引

以下是本文设计直接依赖的官方资料。

## OpenAI / Codex

1. Codex repository  
   https://github.com/openai/codex

2. ChatGPT Codex base URL / provider capabilities  
   https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs

3. Bearer auth headers  
   https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/bearer_auth_provider.rs

4. Codex Responses API Proxy  
   https://github.com/openai/codex/blob/main/codex-rs/responses-api-proxy/README.md

5. Responses WebSocket implementation  
   https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/responses_websocket.rs

6. Codex API / Compact  
   https://github.com/openai/codex/blob/main/codex-rs/codex-api/README.md

7. Remote compact request  
   https://github.com/openai/codex/blob/main/codex-rs/core/src/compact_remote_request.rs

8. Models endpoint  
   https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/models_endpoint.rs

9. App Server account/login/rate limits  
   https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

10. TokenData  
    https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs

11. Auth Manager  
    https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs

12. Auth Storage  
    https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs

13. Codex config including ChatGPT base URL  
    https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs

14. OpenAI Terms of Use  
    https://openai.com/policies/terms-of-use/

---

## Backend Libraries

15. Fastify  
    https://fastify.dev/docs/latest/

16. Undici  
    https://github.com/nodejs/undici

17. @fastify/websocket  
    https://github.com/fastify/fastify-websocket

18. better-sqlite3  
    https://github.com/WiseLibs/better-sqlite3

19. Node release lines  
    https://nodejs.org/en/about/previous-releases

---

## Frontend

20. Tailwind CSS + Vite  
    https://tailwindcss.com/docs/installation/using-vite

21. shadcn/ui + Vite  
    https://ui.shadcn.com/docs/installation/vite

22. Google Fonts API  
    https://developers.google.com/fonts/docs/getting_started

---

# 57. 结论

第一版不应该追求“功能很多”。

真正应该做到的是：

```text
Codex 几乎感知不到 Gateway 的存在。
```

只要下面六件事非常稳定：

1. Transport 不破坏；
2. Auth 替换正确；
3. Session 不串账号；
4. OAuth 生命周期可靠；
5. Compact / Tools / Models 不被代理层破坏；
6. Secrets 不泄露；

这个 MVP 就已经具备继续演进的价值。

第一版应该优先追求：

```text
透明
稳定
可验证
可回滚
少依赖
少魔法
```

而不是尽早增加复杂调度策略。
