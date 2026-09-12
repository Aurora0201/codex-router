# ADR-0001：透明身份代理架构（HTTP / WebSocket）

- 状态：已接受（2026-08-09）
- 关联：`docs/research/codex-router-mvp-design.md`（设计基线）
- 影响范围：`server/src/proxy/http-proxy.ts`、`server/src/proxy/ws-proxy.ts`、`server/src/proxy/headers.ts`

## Context

网关的目标是在 **Codex 与 ChatGPT Codex 后端之间**增加一层本地代理，用于多账号管理与账号动态切换，同时**不修改 Codex 核心代码、不重新实现 Responses API、不重写工具运行时**。

关键设计意图：

- **锚定 Codex 登录账号，后端动态切换请求账号。** Codex 桌面端保持登录一个账号；网关在转发时用另一个 active 账号的凭证替换 `Authorization` 与 `chatgpt-account-id`，从而实现"不切换 Codex 登录即可换后端账号"。账号不匹配是设计常态，而非错误。active 账号默认由用户手动选定；自 v2 起可由用户显式开启的自动切换代为选定，边界见下文「自动切换」。
- **数据面透明。** 网关不重写 Responses 工具 payload，数据面字节保持不透明；唯一只读例外是从 WebSocket JSON 包络和 `/responses` SSE 事件中提取白名单生命周期元数据，用于安全诊断。
- **无会话绑定。** HTTP 请求独立使用当前 active 账号；WebSocket 身份固定于握手，因此切换 active 时，空闲旧连接立即正常退役，存在进行中响应的旧连接在协议终态转发完成后退役。Codex 随后的连接使用新账号重新握手，不建立会话/线程粘滞（session binding 机制已移除）。
- **多账号隔离。** 每个账号有独立 `CODEX_HOME`（`data/accounts/<id>/codex-home`）与 `auth.json`，凭证不落 SQLite、不进日志。
- **接入方式。** 网关注入全局 `~/.codex/config.toml` 的 `openai_base_url` 指向自身，使 Codex 内置 `openai` provider 的流量全部经过网关。

## Decision

### 通用

- 路由白名单仅限：`POST /responses`、`POST /responses/compact`、`GET /models`、`POST /alpha/search`（Codex `web.run` 工具的独立网页搜索端点，见 `codex-rs/ext/web-search`），以及 `GET /responses` 的 WebSocket Upgrade。其余 `backend-api/codex/*` 一律 `501`。
- 每个请求优先从 `active_account` 解析账号，经 `auth.getCredential()` 取得其 access token。仅当账号数据库完全为空时，网关进入 `client_passthrough`：保留 Codex 客户端自带的 `Authorization` 与 `chatgpt-account-id`，不替换身份。账号池非空但未选择、禁用或失效时仍拒绝请求，不做隐式回退：只有用户显式开启的自动切换才会改写 `active_account`，且它是在请求之外做决定，不在请求路径上兜底。
- **账号能不能被选中只看身份**：启用，且凭据就绪。额度受限是配额事实，写在 `rate_limit_reached_type` 上，不写进 `auth_status`，也不阻止手动选定。它曾经写在 `auth_status` 里，于是同样读到 0% 的两个账号一个能选一个不能，区别只在于上游有没有把「已达上限」报回来过。手动选定是这份 ADR 的前提，配额不该替用户否决它。
- 认证替换由 `buildUpstreamHeaders` 完成：设置 `Authorization: Bearer <token>` 与 `chatgpt-account-id`；剥离 `cookie`、`host`、`connection`、`content-length` 等请求头（由网关重建）。
- 响应头经 `copyResponseHeaders` 转发，剥离 `set-cookie`、`connection` 等传输层头。
- 浏览器 Origin 请求（`hasBrowserOrigin`）一律拒绝（数据面仅服务本地 Codex 客户端）。
- 网关使用服务端生成的 UUID 作为请求诊断 ID，且不接受客户端请求头覆盖；因此 HTTP、WebSocket 连接以及连接内派生请求在网关重启后仍可唯一关联。

### HTTP / SSE

- 请求体以**原始字节**转发（`rawBody` Buffer），不解析、不重写。
- 上游响应体经 Transform **流式原样透传**，不完整缓冲到内存。仅 `/responses` SSE 读取事件的 `type`、`response.error.code`、`response.incomplete_details.reason`、顶层 `status/status_code`；不保存事件或正文。
- 上游 URL 由 `upstreamUrl(request, path)` 构造：`upstreamBaseUrl + path`，并**透传客户端 query string**（例如 `/models?client_version=<ver>`），保证路由元数据不丢失。
- 下游断开（`aborted` / `close`）时通过 `AbortController` 中止上游请求。
- `client_passthrough` 不执行账号 refresh，也不因 429 修改账号池状态；上游状态原样返回并按正常请求统计。
- 上游返回 `401` 且尚未产生有效流：对**同一账号**执行一次认证刷新并重试一次。
- 上游返回 `429`：将该账号标记为 `rate_limited`，并异步刷新额度展示。
- 大请求体与长连接不受网关限制（`bodyTimeout: 0`）。
- 非 Responses 流式端点以最终 HTTP 状态和传输完成为结果依据。`/responses` 的 HTTP 2xx 只表示响应头成功；必须观察到 `response.completed` 才记为请求成功。`response.incomplete`、`response.failed`、顶层 `type:error`、终态前 EOF 或传输失败分别保留协议或传输证据。

### WebSocket

- 握手阶段注入所选账号认证（`websocketUpgradeHeaders`，保留 codex 依赖的 `x-codex-turn-state`、session/thread 头、`OpenAI-Beta` 等）。
- active 账号变化时，不在既有连接内热换认证或上游。绑定旧账号的空闲连接以正常关闭码退役；进行中的 `response.create` 可完成并转发终态，随后连接退役，使 Codex 在下一请求重新握手并取得新账号认证。账号切换导致的正常退役属于连接级成功诊断，不计作上游故障。
- 空账号池建立的 `client_passthrough` 连接使用客户端握手认证，不加入托管账号连接注册表，也不执行认证刷新。
- 升级成功后**双向透明转发**文本/二进制帧，诊断提取不得改变帧字节；解析失败必须继续转发。
- 握手头和文本帧使用同一安全白名单：握手只读取 `x-codex-turn-metadata` 与 `thread-id`，文本帧使用流式 JSON 路径筛选器且 `keepStack: false`，只读取顶层 `type`、`generate`、`client_metadata.x-codex-turn-metadata` 及兼容的直接 session/thread/turn 字段。metadata 只允许提取有长度与字符约束的 `session_id`、`thread_id`、`turn_id`、`request_kind`，用于进程内活动连接观测，原始 metadata 不保存。上游仅读取顶层 `type`、`response.error.code` 和 `response.incomplete_details.reason`。不组装完整 payload，不读取或记录 workspace、input、instructions、prompt、工具参数、工具结果和响应正文。
- 每个非 prewarm `response.create` 独立记录请求生命周期；复用连接中的 `request_kind = "compaction"` 记录为 `compact`。握手和连接关闭属于连接级诊断，不参与 API 可用性。
- 客户端早于上游连接就绪的消息进入**有界缓冲区**（`MAX_PENDING_FRAMES` / `MAX_PENDING_BYTES`），上游 `open` 后按序补发。
- ping / pong 双向转发；close code / reason 按合法范围桥接（非法码直接 `terminate`）。
- 保留上游 Upgrade 响应头（`x-codex-turn-state`、`x-models-etag`、`x-reasoning-included`、`openai-model`）。

### 自动切换（v2 新增）

原始决策是"账号只能由人手动选定"。它保护的是两件事：用户始终知道自己在消耗哪个账号，以及失败永远能归因到一个明确的账号。自动切换会削弱这两点，因此放开的边界写在这里，**没有列进来的一律仍旧禁止**。

- **默认关闭。** 开启是用户的一次显式决定，关闭后立即回到完全手动，不保留任何自动行为。
- **只改写 `active_account`，不改任何别的东西。** 自动切换调用与手动切换同一条 `ActiveAccountService.select()`，因此连接退役、身份替换、证据记录的行为完全一致。**它不在请求路径上运行**：决定发生在额度刷新、429 标记或认证状态变化之后，而不是在某个请求即将失败时临时改道。
- **不打断进行中的请求。** 沿用既有退役语义：空闲旧连接立即退役，有进行中响应的在协议终态转发完成后退役。
- **数据面仍然不透明。** 决定只使用额度窗口、认证状态和请求结果归因，**不得读取 payload**，也不得把只读诊断元数据引入路由决策。
- **仍然无会话绑定。** 自动切换不得为了"让一个会话留在同一账号"而延后或抑制切换。
- **每一次自动切换都必须留痕**：时间、来源账号、目标账号、触发原因、当时的判据。这是对"失去归因"的补偿，不是可选的日志。
- **周额度用完的账号不参与切换。** 这不是阈值问题：周额度一旦耗尽，任何切换依据都不能让它变得可用，而在 `switchOn: "short"` 下它的 5 小时窗口会一直读着正常值。曾经因此切到一个下一个请求就返回 429 的账号。
- **账号可退出。** 每个账号可以在池中但不参与自动切换。

### 账号预热（v3 新增）

额度窗口只在被消耗过一次之后才开始计时，因此一个没人用过的账号，它的 5 小时窗口是没在走的。预热就是替每个账号发出那一次。它触碰的是另一条底线：**网关自己花用户的额度**。原始决策里网关只转发别人发起的请求，从不自己发起。放开的边界写在这里，**没有列进来的一律仍旧禁止**。

- **不走数据面。** 预热用账号自己的 `CODEX_HOME` 起一个 `codex app-server`，直连上游，不经过代理链路。身份是"哪个目录"，在进程启动前就定死，因此不存在算错账号的窗口。代价是这些请求不出现在请求日志里，控制台必须说明这一点。
- **不改 `active_account`。** 预热与路由完全无关：它不选账号、不退役连接、不影响任何进行中的请求。当前路由账号在预热前后是同一个。
- **自动预热默认关闭。** 开启是用户的一次显式决定。手动预热永远可用，因为那是人自己按下的。
- **自动预热必须有上限。** 每账号冷却时间，加上每账号每日次数上限；上限从预热记录里数出来而不是存在内存里，因此重启不能绕过它。一个判断错误只能浪费有限的额度。
- **只在窗口没在走的时候发。** 窗口还在计时的账号，再发一次既不会重启也不会延长它，只会白白消耗。强制预热必须是人显式要求的。
- **每一次预热都必须留痕**：时间、账号、触发来源、结果、用的模型，以及**预热前后的窗口**。记"这一轮成功了"没有意义，要记的是"窗口有没有真的开始走"。这是对"网关自己花了钱"的补偿，不是可选的日志。
- **不记录任何正文。** 失败只存分类码，不存上游返回的文字——它可能带上提示词或响应内容。
- **账号可退出。** 每个账号可以在池中但不参与预热。

### 代价

- 用户不再总能立刻说出"这次请求用的是哪个账号"。切换记录是唯一的补偿，因此它属于功能本身而非附属日志。
- 失败的归因变难：同一段时间的失败可能分布在多个账号上。诊断视图必须能按账号聚合，否则这个功能会让排障退步。

### 预热调度与确认补充（2026-09-12）

- 启动、设置/参与账号变化、成功状态刷新与重置券结果统一进入预热调度。按已知短窗口到期时间安排只读刷新，五分钟轮询补漏；三十秒时钟检查发现休眠恢复或时间回拨后重新读取。外部/官方重置没有推送来源时通过刷新发现，不承诺即时获知。
- 仅成功刷新过的目标账号进入自动评估；未知、没有短窗口和仍在运行分别处理。到期仅触发核验，不凭旧读数直接消费。锁内再次检查启用、参与、认证、设置和新鲜度，显式空账号列表不会扩展为全池。
- 自动尝试发送前写入 `running`，重启将残留标为 `failed/gateway_process_interrupted`。日志展示上限不再删除安全计数依据。已确认重置可解除旧冷却，但不解除滚动二十四小时自动次数上限。
- Turn 成功但窗口尚未确认记为 `pending`，仅继续读取额度，不自动重发；随后确认运行中才记为 `warmed`。明确新重置使旧待确认记录结束，允许按新窗口重新评估。手动强制发送仍是用户显式消费行为。
- 调度器合并执行期间的账号事件；关闭先停止调度和新增预热，等待当前预热、模型查询和刷新收尾，再关闭数据库。记录只含结构化状态，不含正文。
- 周额度耗尽是所有自动切换分支的硬限制，包括 `highest` 兜底，不因阈值放宽而绕过。
- SSE 按事件边界而非网络 chunk 限制检查缓存；CR/LF、多行 data 及超长事件后的恢复不改变透传字节。首个完整可信终态立即结算，后续终态或断流不覆盖；HTTP 请求始终保留真实响应 HTTP 状态与已观察到的白名单响应头。

### 请求与连接证据模型

- `request_log` 只保存用户请求。HTTP 进入网关或非预热 `response.create` 到达时立即插入 `running`；首个可信终态以同一记录 ID 原位完成，重复终态或随后关闭不能覆盖它。
- `state` 只表达生命周期：`running / completed / failed / rejected / cancelled / interrupted`。`outcome` 只表达统计归因：运行中为 null，终态为 `success / upstream_error / gateway_error / rejected / client_cancelled`。
- 证据字段严格分离：`http_status` 是 HTTP 证据，`protocol_error_code` 是 Codex 协议码，`diagnostic_code` 是网关或传输诊断码；三者不得互相回填。WebSocket `response.completed` 仅在弃用兼容字段 `statusCode` 中合成 200，`http_status` 保持 null。
- 结果优先级为：网关本地拒绝；非 Responses 的最终 HTTP 状态；Responses/WS 协议终态；明确客户端取消；终态前传输中断。未知协议错误保留规范化原码，不无证据改写为通用错误。
- 网关启动时将遗留 `running` 原位标记为 `interrupted/gateway_error`，诊断码为 `gateway_process_interrupted`；未知失败阶段保持 null。
- `websocket_connection_log` 独立保存握手和关闭证据。Upgrade 101 只保存为 `handshake_http_status=101`；客户端/上游关闭码、关闭发起方、退役及关闭原因不进入请求状态和成功率。
- 汇总、故障率、可用性、时间线和平均耗时只统计已终结请求；运行中请求和全部连接记录均排除。
- 仅允许保存响应头白名单 `x-request-id`、`openai-request-id`、`retry-after`，其中前两者用于上游请求 ID。传输异常仅保存经过长度和字符集约束的 `name` / `code` 因果链；禁止保存 Authorization、Cookie、Set-Cookie、正文、错误 message / stack、Prompt、工具参数或工具结果。
- HTTP 上游连接使用共享 Undici Agent，连接超时为 30 秒，并启用 `autoSelectFamily` 在 IPv4 / IPv6 地址之间自动选择；响应头超时和无限流式 body timeout 保持不变。

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
