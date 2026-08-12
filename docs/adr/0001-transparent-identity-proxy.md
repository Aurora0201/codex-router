# ADR-0001：透明身份代理架构（HTTP / WebSocket）

- 状态：已接受（2026-08-09）
- 关联：`docs/research/codex-router-mvp-design.md`（设计基线）
- 影响范围：`server/src/proxy/http-proxy.ts`、`server/src/proxy/ws-proxy.ts`、`server/src/proxy/headers.ts`

## Context

网关的目标是在 **Codex 与 ChatGPT Codex 后端之间**增加一层本地代理，用于多账号管理与账号动态切换，同时**不修改 Codex 核心代码、不重新实现 Responses API、不重写工具运行时**。

关键设计意图：

- **锚定 Codex 登录账号，后端动态切换请求账号。** Codex 桌面端保持登录一个账号；网关在转发时用另一个（用户手动选中的 active）账号的凭证替换 `Authorization` 与 `chatgpt-account-id`，从而实现"不切换 Codex 登录即可换后端账号"。账号不匹配是设计常态，而非错误。
- **数据面透明。** 网关不重写 Responses 工具 payload，数据面字节保持不透明；唯一只读例外是从 WebSocket JSON 包络提取 Codex 官方定义的请求类型、生命周期事件和规范化错误码，用于安全诊断。
- **无会话绑定。** HTTP 请求独立使用当前 active 账号；WebSocket 身份固定于握手，因此切换 active 时，空闲旧连接立即正常退役，存在进行中响应的旧连接在协议终态转发完成后退役。Codex 随后的连接使用新账号重新握手，不建立会话/线程粘滞（session binding 机制已移除）。
- **多账号隔离。** 每个账号有独立 `CODEX_HOME`（`data/accounts/<id>/codex-home`）与 `auth.json`，凭证不落 SQLite、不进日志。
- **接入方式。** 网关注入全局 `~/.codex/config.toml` 的 `openai_base_url` 指向自身，使 Codex 内置 `openai` provider 的流量全部经过网关。

## Decision

### 通用

- 路由白名单仅限：`POST /responses`、`POST /responses/compact`、`GET /models`、`POST /alpha/search`（Codex `web.run` 工具的独立网页搜索端点，见 `codex-rs/ext/web-search`），以及 `GET /responses` 的 WebSocket Upgrade。其余 `backend-api/codex/*` 一律 `501`。
- 每个请求优先从 `active_account` 解析账号，经 `auth.getCredential()` 取得其 access token。仅当账号数据库完全为空时，网关进入 `client_passthrough`：保留 Codex 客户端自带的 `Authorization` 与 `chatgpt-account-id`，不替换身份。账号池非空但未选择、禁用或失效时仍拒绝请求，不自动回退。
- 认证替换由 `buildUpstreamHeaders` 完成：设置 `Authorization: Bearer <token>` 与 `chatgpt-account-id`；剥离 `cookie`、`host`、`connection`、`content-length` 等请求头（由网关重建）。
- 响应头经 `copyResponseHeaders` 转发，剥离 `set-cookie`、`connection` 等传输层头。
- 浏览器 Origin 请求（`hasBrowserOrigin`）一律拒绝（数据面仅服务本地 Codex 客户端）。
- 网关使用服务端生成的 UUID 作为请求诊断 ID，且不接受客户端请求头覆盖；因此 HTTP、WebSocket 连接以及连接内派生请求在网关重启后仍可唯一关联。

### HTTP / SSE

- 请求体以**原始字节**转发（`rawBody` Buffer），不解析、不重写。
- 上游响应体经 `pipeline(upstream.body, counter, reply.raw)` **流式透传**，不完整缓冲到内存；SSE 事件原样流回。
- 上游 URL 由 `upstreamUrl(request, path)` 构造：`upstreamBaseUrl + path`，并**透传客户端 query string**（例如 `/models?client_version=<ver>`），保证路由元数据不丢失。
- 下游断开（`aborted` / `close`）时通过 `AbortController` 中止上游请求。
- `client_passthrough` 不执行账号 refresh，也不因 429 修改账号池状态；上游状态原样返回并按正常请求统计。
- 上游返回 `401` 且尚未产生有效流：对**同一账号**执行一次认证刷新并重试一次。
- 上游返回 `429`：将该账号标记为 `rate_limited`，并异步刷新额度展示。
- 大请求体与长连接不受网关限制（`bodyTimeout: 0`）。
- HTTP 请求成功获得上游响应时，日志 `status_code` 表示上游返回的 HTTP 状态；若请求在到达上游前被网关拒绝，则表示网关返回给本地客户端的 HTTP 状态。WebSocket 请求级记录不复用握手码：收到 `response.completed` 后使用合成的 `200` 表示协议终态成功，握手 `101` 仅存在于连接级记录。`outcome` 是统计和筛选的权威字段，不能把 2xx 请求归为上游故障。

### WebSocket

- 握手阶段注入所选账号认证（`websocketUpgradeHeaders`，保留 codex 依赖的 `x-codex-turn-state`、session/thread 头、`OpenAI-Beta` 等）。
- active 账号变化时，不在既有连接内热换认证或上游。绑定旧账号的空闲连接以正常关闭码退役；进行中的 `response.create` 可完成并转发终态，随后连接退役，使 Codex 在下一请求重新握手并取得新账号认证。账号切换导致的正常退役属于连接级成功诊断，不计作上游故障。
- 空账号池建立的 `client_passthrough` 连接使用客户端握手认证，不加入托管账号连接注册表，也不执行认证刷新。
- 升级成功后**双向透明转发**文本/二进制帧，诊断提取不得改变帧字节；解析失败必须继续转发。
- 文本帧使用流式 JSON 路径筛选器且 `keepStack: false`，客户端仅读取顶层 `type`、`generate` 和 `client_metadata.x-codex-turn-metadata`，上游仅读取顶层 `type`、`response.error.code` 和 `response.incomplete_details.reason`。不组装完整 payload，不读取或记录 input、instructions、prompt、工具参数、工具结果和响应正文。
- 每个非 prewarm `response.create` 独立记录请求生命周期；复用连接中的 `request_kind = "compaction"` 记录为 `compact`。握手和连接关闭属于连接级诊断，不参与 API 可用性。
- 客户端早于上游连接就绪的消息进入**有界缓冲区**（`MAX_PENDING_FRAMES` / `MAX_PENDING_BYTES`），上游 `open` 后按序补发。
- ping / pong 双向转发；close code / reason 按合法范围桥接（非法码直接 `terminate`）。
- 保留上游 Upgrade 响应头（`x-codex-turn-state`、`x-models-etag`、`x-reasoning-included`、`openai-model`）。

## Consequences

### 正面

- 最大化复用官方能力：工具调用、推理、远端压缩、模型发现均不破坏。
- 转发数据面不透明，诊断元数据提取失败时自动降级为仅透传，不影响上游协议兼容性。
- 账号切换对 Codex 客户端透明，无需重新登录。

### 代价

- 网关不做 payload 内容处理，因此无法在数据面做模型路由或内容改写；只读诊断例外不得扩展为业务路由依据。多 provider 路由只能依赖未来在 `openai_base_url` 之上的代理层（见 `docs/research/multi-provider-routing.md`）。
- 依赖全局 `~/.codex/config.toml` 注入，与桌面端共享配置，需注意注入的幂等与备份恢复。

### 已知修正记录

- `?client_version` query 曾被转发丢弃导致 `/models` 返回 400，已通过 `upstreamUrl()` 透传修复（见分支 `fix/models-query-loss`）。
