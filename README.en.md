<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/branding/codex-router-logo-dark.png">
    <img alt="Codex Router" src="assets/branding/codex-router-logo.png" width="680">
  </picture>
</p>

<h1 align="center">Codex Router</h1>

<p align="center">
  A local multi-account router and operations console for Codex CLI.<br>
  Isolate identities, understand quota windows, and trace streaming requests with evidence for every switch and failure.
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/Aurora0201/codex-router/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Aurora0201/codex-router/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/Aurora0201/codex-router/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/Aurora0201/codex-router/actions/workflows/codeql.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@aurora0201/codex-router"><img alt="npm" src="https://img.shields.io/npm/v/%40aurora0201%2Fcodex-router?logo=npm"></a>
  <a href="https://github.com/Aurora0201/codex-router/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Aurora0201/codex-router?logo=github"></a>
  <img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-5FA04E?logo=nodedotjs&logoColor=white">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/github/license/Aurora0201/codex-router"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> · <a href="#interface-preview">Screenshots</a> · <a href="#features">Features</a> ·
  <a href="#architecture">Architecture</a> · <a href="#privacy">Security and privacy</a> ·
  <a href="#cli">CLI</a> · <a href="#faq">FAQ</a>
</p>

> [!IMPORTANT]
> Release packages currently support **Windows x64 / Node.js 24+**. Automatic switching and automatic warm-up are disabled by default and require explicit opt-in. Warm-up consumes real quota. Router does not provide subscriptions, extra quota, or exemptions from upstream limits.

## About

Codex Router runs a local transparent proxy between Codex CLI and the official Codex backend. Manage multiple authorized accounts, choose the identity used by the next request, and inspect quota, connections, request outcomes, and local usage in one console.

It is useful for regular Codex users managing independent accounts or diagnosing HTTP/SSE/WebSocket failures. Routine operations live in a local interface; switching the proxy identity does not require repeatedly replacing your primary Codex login file.

Every preview below is rendered by the current frontend with synthetic demonstration data. No real email, account ID, request ID, local path, or credential is included.

## Interface preview

### Runtime status

<p align="center">
  <img alt="Codex Router runtime page showing takeover status, request outcomes, API availability, and WebSocket connections" src="assets/screenshots/admin-dashboard.png" width="1200">
</p>

Confirm that Codex is routed through the gateway, then inspect request trends, outcome distribution, API availability, and live WebSockets in one view. Connections are stably grouped as transmitting, connecting/retiring, and idle, making the current health of the gateway easy to assess.

### Account routing

<p align="center">
  <img alt="Codex Router account routing page showing isolated accounts, the active route, and quota windows" src="assets/screenshots/admin-accounts.png" width="1200">
</p>

Each account has an isolated identity directory and its own quota state, while the active route is explicitly marked. Authentication refresh, quota reads, automatic switching, and five-hour-window warm-up are available here, but every automatic spending feature requires explicit opt-in.

### Request evidence

<p align="center">
  <img alt="Codex Router request log page showing outcome metrics, filters, and structured request records" src="assets/screenshots/admin-request-logs.png" width="1200">
</p>

Request logs and WebSocket connection diagnostics remain separate. Filter by time, outcome, transport, and failure evidence, then use the detail sheet to inspect HTTP status, protocol errors, diagnostic codes, failure source, and failure stage without reading prompts or response bodies.

<a id="quick-start"></a>
## Quick start

### 1. Install and start

With Node.js 24+ installed, run in PowerShell:

```powershell
npm install --global @aurora0201/codex-router
codex-router start
```

Open <http://127.0.0.1:8317/admin/>. The gateway runs in the background by default; use `codex-router start --foreground` to view logs in your terminal.

You can also download the Windows x64 ZIP from [GitHub Releases](https://github.com/Aurora0201/codex-router/releases), extract it, and use `codex-router.cmd`. The ZIP still requires Node.js installed on the system.

### 2. Add and select an account

Add an account on the Account Routing page, complete OpenAI's official Browser OAuth flow, then select the active routing account. Each account has an isolated `CODEX_HOME` and does not overwrite your primary Codex authentication file.

You can also select an account in the terminal:

```powershell
codex-router account
```

### 3. Configure Codex

Use the built-in configuration command to create a backup and inject the gateway URL:

```powershell
codex-router config apply
codex-router restart
codex-router status
```

The equivalent root-level Codex TOML configuration is:

```toml
openai_base_url = "http://127.0.0.1:8317/backend-api/codex"
```

Use Codex CLI normally afterward. A completely empty account database enables client identity passthrough. If the managed pool is non-empty but its current account is unavailable, Router explicitly rejects the request rather than silently choosing another identity.

<a id="features"></a>
## Features

### Account isolation and routing control

- Add accounts through official authentication; refresh state, enable, disable, and remove them.
- Inspect short and weekly quota windows, subscription information, and expiry indicators.
- Select identities manually by default. Each new HTTP request uses the account resolved when it enters the gateway.
- WebSocket identity is fixed at handshake. After a switch, idle old connections retire immediately; transmitting connections wait for a protocol terminal.
- No sticky conversation/turn binding to an account and no authentication replacement inside an existing connection.

### Optional automatic switching

When explicitly enabled, Router evaluates the account pool after quota refreshes, authentication changes, and limit signals, then updates the active identity through the same path as manual selection.

| Rule | Behavior |
| --- | --- |
| Default | Off; manual selection |
| Participation | Enabled, authenticated accounts opted into switching |
| Weekly exhaustion | Excluded from every automatic selection branch |
| In-flight requests | Keep their original identity; no cross-account retry |
| Existing WebSockets | Follow normal retirement rules |
| Every switch | Records source, destination, reason, and decision evidence |

Disabling the feature restores manual control. A `429` is still returned unchanged to the current request; a newly selected identity affects later requests only.

### Five-hour window warm-up

Warm-up tries to start a five-hour window that is not running: send one small turn through the account's isolated official app-server, then refresh quota to confirm the result. Choose a model and reasoning effort or configure a short warm-up message.

- Automatic warm-up is off by default; each account must opt in.
- Router startup, window expiry, resume from sleep, settings changes, and status refreshes trigger evaluation.
- Official or external resets have no push source; polling discovers them without a guarantee of immediate execution.
- Expiry triggers a fresh quota read. Unknown windows, absent short windows, and exhausted weekly quota do not cause automatic sends.
- Defaults are a 15-minute cooldown and at most 6 automatic attempts per account over a rolling 24 hours; both are configurable.
- Attempts are recorded before sending. A completed turn is successful only after the window is confirmed running. Otherwise it remains pending while quota is observed, without automatic resending.
- A confirmed new reset may release the old cooldown but does not relax the daily automatic limit.
- Manual force is an explicit spend and still respects account eligibility and weekly exhaustion.

> [!NOTE]
> Warm-up connects directly to the official backend, bypasses the proxy, and does not change the active routing account. Results appear in warm-up history rather than proxy request logs. Codex protocol prewarm with `generate:false` is a separate mechanism from these real turns intended to start a quota window.

### Runtime status and live connections

The runtime page brings together takeover status, request trends, API availability, and every currently open WebSocket.

The live table uses connection ID as its unique identity and shows allowlisted conversation/turn identifiers, current activity, connection state, and elapsed connection time. A conversation can have several connections, and one connection can handle multiple turns over time.

Connections are stably grouped as transmitting, connecting/retiring, and idle. A state change moves a connection toward the front of its new group. Missing conversation metadata falls back to a connection identifier, and growing lists scroll within a fixed area.

### Request logs and connection diagnostics

Separate views provide server-side filtering, pagination, and structured details.

| View | Evidence |
| --- | --- |
| Requests | Lifecycle, outcome, HTTP status, protocol error, diagnostic code, failure source/stage, upstream request ID, duration, and byte counts |
| Connection diagnostics | Handshake HTTP status, close codes on both sides, close initiator, and retirement/closure reason |

A request is recorded as `running` immediately and the first trusted terminal updates the same row. Key rules:

- Ordinary HTTP endpoints use status and completed transport; Responses SSE requires a successful protocol terminal. HTTP 200 alone does not prove success.
- `response.completed` means success; incomplete, failed, and top-level error events retain their own evidence.
- A disconnect or EOF before terminal is a transport failure. A valid terminal observed after a parse error still takes precedence.
- Client cancellations are classified separately; running records left across restart become interrupted.
- `101` means only WebSocket handshake success. Normal retirement does not increment request failures.
- Running requests and connection records are excluded from request success rates.

### Local Codex usage analytics

The usage page extracts allowlisted counters and lifecycle information from local rollouts in the primary `CODEX_HOME`, showing trends, model/project distribution, and task activity.

- This is a **local aggregate across accounts**, not an official bill or a way to infer each managed account's remaining quota.
- Complete records are read incrementally; cumulative token snapshots are converted into deltas to avoid double counting.
- Previously scanned statistics survive confirmed source-history disappearance. History never scanned cannot be reconstructed.
- A separate usage database provides verified backups and recovery records.
- Project attribution retains a hashed key and a label with the final two path segments, not the full working directory.

See the [local usage ADR](docs/adr/0002-local-codex-usage-analytics.md).

### Local administration

The console is served by Router and requires no separate deployment. It supports Chinese and English, light and dark themes, live SSE updates, copying diagnostic details, and copying local directory paths.

<a id="architecture"></a>
## How it works

```text
Codex CLI
   │ HTTP / SSE / WebSocket
   ▼
Codex Router · 127.0.0.1:8317
   ├─ active identity and authentication replacement
   ├─ transparent streaming data plane
   └─ allowlisted lifecycle and diagnostic metadata
   │
   ▼
Official Codex backend
```

The data plane supports Responses, remote compact, models, and web search routes. HTTP bodies and proxied responses are forwarded as original bytes. Router does not implement model inference or the tool runtime.

A `401` refreshes and retries the same account at most once. Automatic switching happens outside requests and never resends a failed request under another account. Authentication management and optional warm-up use account-isolated official app-servers.

<a id="privacy"></a>
## Security and privacy

### Data boundaries

| Area | Stored data |
| --- | --- |
| Request/connection logs | Time, route, identity mode, status/outcome, byte counts, and allowlisted error evidence |
| Safe response headers | `x-request-id`, `openai-request-id`, `retry-after` |
| Live connections | Safe session/thread/turn IDs held in memory, not added to persistent connection history |
| Usage analytics | Allowlisted counters, models, task events, and limited project labels |
| User settings | Participation, thresholds, model/effort choices, and an explicitly configured warm-up message |
| Authentication files | Account-specific `CODEX_HOME`; credentials are not stored in Router SQLite |

Proxy logs and analytics databases do not retain conversation prompts, input/output bodies, tool arguments/results, complete protocol events, authentication headers, or cookies. Diagnostics do not store upstream error messages/stacks or arbitrary `x-*` headers.

These boundaries describe Router logging and analytics. Files managed by official Codex follow Codex's own behavior. A custom warm-up message is persisted as a user setting; avoid putting sensitive content in it.

### Access boundaries

- Listen only on `127.0.0.1` or `::1`.
- Use the official Codex upstream by default; custom upstreams require explicit developer mode.
- Allowlist supported data-plane routes; others return 501.
- Reject browser Origin/Referer on data-plane requests. Admin writes use same-origin checks, a SameSite cookie, and CSRF token.
- Replace credentials and filter cookies in managed mode; retain client authentication for an empty account pool.

See the [transparent identity proxy ADR](docs/adr/0001-transparent-identity-proxy.md) for the complete rules.

<a id="cli"></a>
## Command line

| Command | Description |
| --- | --- |
| `codex-router start [--foreground]` | Start in the background or foreground |
| `codex-router status` | Inspect address, PID, uptime, configuration, and active account |
| `codex-router account [account-id]` | Select interactively or by ID |
| `codex-router stop` | Gracefully stop |
| `codex-router restart` | Restart with the most recent launch options |
| `codex-router logs [--tail]` | Read or follow logs |
| `codex-router config status/apply/restore` | Inspect, back up/inject, or restore Codex configuration |
| `codex-router startup enable/disable/status` | Manage Windows logon startup |
| `codex-router --version` | Print the current CLI version |

Common launch flags: `--host`, `--port`, `--data-dir`, `--log-level`, `--log-file`. A custom `--upstream` requires `--dev`.

### Windows logon startup

```powershell
codex-router startup enable
codex-router startup status
```

Task Scheduler starts Router when the current user logs in, without administrator privileges. This is a user logon task, not a system service that runs with no user logged in.

The task retains installation paths and the latest launch options. Run `startup enable` again after upgrading, moving the installation, or changing options. `startup status` also reports the last task result. Disabling startup does not stop the running gateway.

## Configuration and data directory

| Environment variable | Default / purpose |
| --- | --- |
| `GATEWAY_HOST` | `127.0.0.1` |
| `GATEWAY_PORT` | `8317` |
| `GATEWAY_DATA_DIR` | OS application-data directory; can be overridden |
| `GATEWAY_LOG_LEVEL` | `info` |
| `GATEWAY_LOG_FILE` | Optional log path; background mode supplies a default |
| `CODEX_ROUTER_CLI` | Override the bundled Codex executable entry point |
| `GATEWAY_UPSTREAM` | Official backend; overrides require `GATEWAY_DEVELOPER_MODE=true` |

Use `codex-router status` to locate the effective directory. Migrate or back up the **complete data directory**, including databases, account directories, and backups. SQLite alone does not contain account credentials.

## Upgrade and uninstall

Stop the gateway and back up its data before upgrading:

```powershell
codex-router stop
npm install --global @aurora0201/codex-router@latest
codex-router start
codex-router --version
```

If logon startup is enabled, run `codex-router startup enable` again. Database migration happens at startup; downgrade using a complete backup from the matching version.

When migrating an older source installation, keep using `--data-dir D:\path\to\codex-router\data` or stop the gateway and copy the whole directory.

Restore Codex configuration before uninstalling:

```powershell
codex-router config restore
codex-router startup disable
codex-router stop
npm uninstall --global @aurora0201/codex-router
```

npm uninstall does not automatically remove application data. Remove it manually only when it is no longer needed.

## Development and contributing

```powershell
git clone https://github.com/Aurora0201/codex-router.git
cd codex-router
npm install
npm run dev
```

Run validation:

```powershell
npm test
npm run lint
npm run build
npm run test:e2e
npm run release:check
npm run pack:check
```

Run a local build with `node server/dist/cli.js --help`. During development, run `npm link` inside `server`; the CLI uses compiled output, so rebuild after changes. Unlink and install an explicit version when validating a published package.

Reproducible reports are welcome in [Issues](https://github.com/Aurora0201/codex-router/issues). Include version, platform, reproduction steps, and safe diagnostic codes; omit credentials and conversation content. Use Conventional Commits, and keep gateway E2E tests passing for transport changes.

## Compatibility and releases

The compatibility baseline is Windows x64, Node.js 24+, and Codex CLI 0.147.0. The lockfile pins actual dependencies. Release Please manages versions and CHANGELOG entries. GitHub Releases include a tarball, Windows ZIP, and SHA256 checksums.

- [Compatibility checks](docs/compatibility.md)
- [Release process](docs/releasing.md)
- [Changelog](CHANGELOG.md)

<a id="faq"></a>
## FAQ

**Does Router combine quota or reset official windows?**

No. Every request belongs to one account. Warm-up tries to start a window through normal consumption and cannot add or reset official quota.

**Does automatic switching resend failed requests?**

No. It affects future requests only. Connections using the old identity follow normal retirement rules.

**Why can an HTTP 200 request still fail?**

For Responses SSE, HTTP status proves only that headers succeeded. The stream can still contain a protocol error or end before a successful terminal.

**Why does a conversation show as unassociated?**

When the client supplies no usable allowlisted identifiers, Router retains the row and falls back to connection ID. It does not read conversation titles or previews.

**Why does warm-up remain pending?**

The upstream has not supplied evidence of a running window. Inspect quota refreshes and warm-up history; Router does not automatically resend to guess whether it worked.

**Why is there no account filter on the usage page?**

Primary Codex history may span routing identities and cannot reliably be attributed to managed accounts. The page provides a local aggregate, not billing or quota accounting.

## License

[MIT](LICENSE)
