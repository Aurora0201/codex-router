# Multi-provider routing for Codex (research)

> Status: research notes for a future feature (not yet implemented)
> Researched: 2026-08-08
> Author: codex-router maintainers
> Scope: allow other providers (e.g. DeepSeek) to be used inside Codex, including switching provider mid-conversation

This document records research findings for two questions:

1. How can non-OpenAI models be plugged into Codex **without replacing the built-in `openai` provider**?
2. How can the gateway register multiple API-key providers and let them be used **simultaneously inside Codex** (including switching provider mid-conversation)?

Every claim is cross-checked against at least one of:

- Official OpenAI Codex documentation (`developers.openai.com` / `learn.chatgpt.com`)
- Official DeepSeek documentation (`api-docs.deepseek.com`)
- Codex open-source source (`github.com/openai/codex`, `codex-rs/`)
- The installed `opencodex` package source (a working reference implementation)

---

## 1. Question 1: plug in another model without replacing the OpenAI provider

### 1.1 Verdict

Codex natively supports **multiple model providers coexisting**. Adding a provider does not replace the built-in `openai` provider. DeepSeek's official Codex integration works exactly this way.

### 1.2 Official evidence

**OpenAI docs — Advanced Configuration ("Custom model providers"):**

> "Custom providers can't reuse the reserved built-in provider IDs: `openai`, `ollama`, and `lmstudio`."
> "Define additional providers and point `model_provider` at them":
> ```toml
> model = "gpt-5.6-terra"
> model_provider = "proxy"
> [model_providers.proxy]
> name = "OpenAI using LLM proxy"
> base_url = "http://proxy.example.com"
> env_key = "OPENAI_API_KEY"
> [model_providers.mistral]
> name = "Mistral"
> base_url = "https://api.mistral.ai/v1"
> env_key = "MISTRAL_API_KEY"
> ```
> "To change the base URL for the built-in OpenAI provider, use `openai_base_url`; don't create `[model_providers.openai]`."

Multiple providers (`proxy`, `local_ollama`, `mistral`) are shown side-by-side in one `config.toml`.

**OpenAI source — `codex-rs/model-provider-info/src/lib.rs`:**

- Built-ins are `openai`, `amazon-bedrock`, `ollama`, `lmstudio` (`MPI:444-455`).
- `merge_configured_model_providers` merges user providers with `model_providers.entry(key).or_insert(provider)` (`MPI:466-502`) — **user providers always coexist with built-ins; they never override them** (except `amazon-bedrock` which allows partial `aws` override).
- `create_openai_provider(openai_base_url)` feeds `openai_base_url` into the built-in `openai` entry (`MPI:433-437`, `CFG:3753-3760`). It is orthogonal to any separate `[model_providers.deepseek]` entry.

**DeepSeek docs — "Integrate with Codex":**

> "All Codex clients — Codex CLI, the ChatGPT desktop app, and the Codex IDE extension for VS Code — share the same configuration file. Configure it once ... DeepSeek models will be available in all of them."

DeepSeek's recommended config:

```toml
model = "deepseek-v4-flash"
model_provider = "deepseek"
preferred_auth_method = "apikey"
forced_login_method = "api"
model_reasoning_effort = "high"
model_catalog_json = "~/.codex/models.json"

[model_providers.deepseek]
name = "deepseek"
base_url = "https://api.deepseek.com/"
wire_api = "responses"
experimental_bearer_token = "<your DeepSeek API Key>"
```

DeepSeek ships a one-click setup script that backs up `~/.codex/config.toml`, writes the catalog `~/.codex/models.json`, adds `[model_providers.deepseek]`, and validates before writing. Restore = point `model_provider` back at `openai`.

### 1.3 How provider resolution works in Codex

**One active provider at a time, resolved client-side:**

- The active provider id is `model_provider` (thread/CLI override) falling back to `cfg.model_provider` then `"openai"` (`CFG:3762-3764`).
- `base_url` comes from the provider entry (`to_api_provider`, `MPI:243-261`); auth comes from `env_key` / `experimental_bearer_token` / `auth` command, else the ChatGPT login snapshot (`MPA:179-197`, `267-279`).
- **The provider is NOT tagged in the wire protocol.** It is resolved purely client-side into base URL + Authorization header.
- `wire_api = "responses"` is the only accepted value in current source (`MPI:64-89`); the old `"chat"` value was removed.

**Provider is fixed per thread; model is switchable mid-thread:**

- `ThreadStartParams`/`ThreadResumeParams`/`ThreadForkParams` accept both `model` and `model_provider` (`PT:57-62`, `349/351`, `537/539`).
- `ThreadSettingsUpdateParams` accepts **`model` only** (`thread.rs:216-269`, `:238`) — there is **no `model_provider` field** in mid-thread settings.
- Each turn re-resolves the wire `model` from the thread's current model (`turn_context.rs:768-775` → `client.rs:927`), so changing model mid-thread changes subsequent request bodies.
- The provider (`SharedModelProvider`, base URL, auth) is pinned at session creation (`session.rs:1272`).

**Implication:** cross-provider switching cannot be done by Codex itself mid-thread. It must be done by a **proxy that routes on the `model` field** of each request body.

---

## 2. Question 2: gateway feature — register multiple providers, use them inside Codex

### 2.1 Reference implementation: opencodex

The installed `opencodex` package (`@bitkyc08/opencodex`) is a working "universal provider proxy" that lets Codex (and Claude Code, Grok Build) run any LLM. Its mechanism is the exact template for this feature.

**Injection (what it writes into `~/.codex`):**

| Mechanism | Source | Effect |
|---|---|---|
| Root `openai_base_url` pointing at the proxy | `src/codex/inject.ts:137-168` | Codex's built-in `openai` provider is repointed to `http://127.0.0.1:PORT/v1`; auth keeps flowing via the normal ChatGPT OAuth path (forward passthrough). |
| Merged model catalog | `inject.ts:351-373`, `catalog/sync.ts:510-573` | Writes `~/.codex/opencodex-catalog.json` = native OpenAI `gpt-*`/`codex-*` rows **plus** routed rows as namespaced slugs `<provider>/<model>` (e.g. `deepseek/deepseek-v4-flash`), and sets root `model_catalog_json`. |
| Fake `/v1/models` endpoint | `src/server/index.ts:456` | Returns the merged catalog to Codex so its model picker lists routed models. |

**Routing (how a provider is picked per request):**

- `routeModel` (`src/router.ts:408-410`) → `routeModelInternal` (`:337-406`), priority:
  1. combo aliases (`:338-347`)
  2. explicit `<provider>/<model>` namespace — only triggers when the prefix matches a configured provider (`:353-371`)
  3. bare OpenAI-family slugs (`gpt-|o1-|o3-|o4-`) → `openai` provider (`:373-377`)
  4. per-provider `defaultModel` (`:379-384`)
  5. known name patterns (`claude-`→anthropic, etc.) (`:412-425`)
  6. provider `models` list membership (`:389-394`)
  7. `defaultProvider` fallback (`:396-403`)
- Provider selection is driven purely by `body.model`, resolved fresh per request (`server/responses/core.ts:1269` → `routeModel(config, parsed.modelId)`).
- **No thread→provider pinning.** The only thread-keyed state is a ChatGPT **accountId** (account pool), not provider/model (`src/codex/routing.ts:137-142`).

**Provider config shape (`~/.opencodex/config.json`, `OcxProviderConfig`):**

- `adapter`: `"openai-chat"` or `"openai-responses"` (plus anthropic/google/kiro/cursor/...)
- `baseUrl`: upstream root
- `responsesPath`: relative path for the Responses endpoint (DeepSeek uses `/responses`, no `/v1` segment)
- `statelessResponses`: upstream stores nothing server-side; stateful params dropped, `store` pinned false
- `authMode`: `"key"` (send provider `apiKey` as Bearer) | `"forward"` (relay caller's auth verbatim) | `"oauth"` | `"local"`
- `apiKey`, `models`, `modelContextWindows`, `modelReasoningEfforts`, `modelReasoningEffortMap`
- Top-level `injectionModel`, `subagentModels`, `defaultProvider`, `activeCodexAccountId`, `autoSwitchThreshold`

DeepSeek registry entry (reference): `adapter: "openai-chat"`, `baseUrl: "https://api.deepseek.com"`, `models: ["deepseek-chat","deepseek-reasoner","deepseek-v4-pro","deepseek-v4-flash"]`, `defaultModel: "deepseek-v4-flash"`, `responsesPath: "/responses"`, `statelessResponses: true`.

### 2.2 DeepSeek native Responses support

DeepSeek officially supports the Responses API format (no translation proxy needed for it):

> "To meet the demand for Codex, our API now supports the Responses API format, with the base_url `https://api.deepseek.com`." — DeepSeek "Using the Responses API"

- `POST https://api.deepseek.com/responses` works with the OpenAI SDK unchanged.
- Currently only `deepseek-v4-flash` supports Codex integration; `deepseek-v4-pro` expected early Aug 2026.
- Compatibility table: `model`, `input`, `instructions`, `stream`, `temperature`, `top_p`, `max_output_tokens`, `tools` (function/web_search partial), `tool_choice`, `reasoning.effort` supported; `service_tier`, `context_management`, `stream_options` not supported; context caching automatic.

### 2.3 DeepSeek official Codex transport: HTTP/SSE, not WebSocket

DeepSeek's official "Integrate with Codex" tutorial makes the transport choice explicit in the generated `models.json`:

- Both `deepseek-v4-flash` and `deepseek-v4-pro` set `"prefer_websockets": false`.
- The provider config declares `base_url = "https://api.deepseek.com/"` and `wire_api = "responses"`; it does not declare WebSocket support or a WebSocket endpoint.
- DeepSeek's streaming API documentation describes HTTP `text/event-stream` / server-sent events (SSE), including `: keep-alive` comments while a request is queued. The official Codex tutorial does not document a Responses WebSocket transport.

Therefore the official integration path is **Codex -> HTTPS Responses request -> SSE response stream**. `wire_api = "responses"` identifies the application protocol; it does not imply WebSocket transport.

This materially simplifies the gateway design for DeepSeek:

1. Generated routed-model catalog entries should preserve `prefer_websockets: false`.
2. Codex should issue `/responses` over HTTP for those selected model entries, so the gateway can route from the request body's namespaced `model` before opening the upstream request.
3. The gateway can forward DeepSeek's native Responses SSE stream (with parameter/event normalization only where compatibility requires it); it does not need to create a DeepSeek upstream WebSocket.
4. The existing OpenAI WebSocket path remains relevant for OpenAI catalog entries. A generic provider adapter should not assume that every Responses-compatible provider supports WebSocket.

Open question to verify in integration tests: when the built-in `openai` provider is repointed at the gateway but a custom merged catalog marks a routed model `prefer_websockets: false`, confirm Codex 0.147.0 selects HTTP/SSE per model even when another model in the same provider prefers WebSocket. This behavior is strongly indicated by the catalog field and DeepSeek's official setup, but must remain a compatibility test because it is central to avoiding a shared-connection cross-provider WS router.

### 2.4 Relevance to our gateway

Our gateway already injects `openai_base_url` via `CodexConfigService.applyGatewayConfig` (`server/src/codex/codex-config.ts:97-122`) — the same primitive opencodex uses. The gap is:

- We inject only `openai_base_url`; we do **not** inject a merged catalog or serve `/v1/models`.
- Our `/responses` proxy always forwards to a single configured upstream with the active ChatGPT account (`server/src/proxy/http-proxy.ts`), i.e. no per-request provider routing.

---

## 3. Proposed architecture (to be finalized)

```
Codex (CLI / desktop)
    │  openai_base_url  → gateway (http://127.0.0.1:8317/backend-api/codex)
    │  model_catalog_json → gateway-generated merged catalog
    │  auth             → ChatGPT account (forward passthrough)
    ▼
Gateway (127.0.0.1:8317)
    │  body.model → routeModel (per request)
    ├── openai/*            → chatgpt.com/backend-api/codex  (existing account pool / active account)
    ├── deepseek/*          → https://api.deepseek.com/responses  (native Responses)
    └── <provider>/*        → configured provider (Responses or Chat translation)
```

### 3.1 Module sketch (aligned with existing code style)

1. **`providers` registry** (new DB table + repository): id, name, adapter (`openai-responses` / `openai-chat`), base_url, responsesPath, api_key (encrypted), models + model metadata.
2. **Catalog generator** (`codex/catalog.ts`): merge native OpenAI models + per-provider `<provider>/<model>` entries → write `~/.codex/gateway-catalog.json`, inject `model_catalog_json`. Model after `opencodex/catalog/sync.ts`.
3. **Router** (`proxy/router.ts`): parse `body.model` → namespace match → provider (opencodex `router.ts:337-406` priority chain as blueprint).
4. **Adapters**:
   - `openai-responses`: forward to provider's Responses endpoint (DeepSeek `POST /responses`; `statelessResponses` semantics: `store=false` — consistent with codex's own `store=false`).
   - `openai-chat` (phase 2, optional): Responses↔Chat translation for providers without Responses support.
5. **Admin API + frontend**: `/api/providers` CRUD; providers/accounts/settings page.

### 3.2 Open decisions (awaiting product confirmation)

1. **Catalog namespace format**: use opencodex-style `<provider>/<model>` (e.g. `deepseek/deepseek-v4-flash`)? Recommended, already proven.
2. **Adapter scope for MVP**:
   - (a) `openai-responses` only (DeepSeek is natively supported; minimal viable) — recommended first step.
   - (b) also `openai-chat` translation (any OpenAI-compatible Chat API) — more general, higher complexity.
3. **Relationship to existing account routing**: `openai/*` should keep using the existing active-account + account-pool logic; non-OpenAI providers use their own API keys. Confirm whether "active account" should only affect `openai/*` requests.
4. **API key storage**: encrypted in DB vs env-var reference vs plaintext config (opencodex stores plaintext in `config.json`; our AGENTS.md forbids leaking secrets → prefer encryption/env-var).

---

## 4. Key sources

- OpenAI Codex Advanced Configuration: `https://developers.openai.com/codex/config-file/config-advanced`
- OpenAI Codex Config Reference: `https://developers.openai.com/codex/config-file/config-reference`
- OpenAI Codex Config Sample: `https://developers.openai.com/codex/config-file/config-sample`
- DeepSeek "Integrate with Codex": `https://api-docs.deepseek.com/quick_start/agent_integrations/codex/`
- DeepSeek "Using the Responses API": `https://api-docs.deepseek.com/guides/responses_api/`
- Codex source: `github.com/openai/codex`, `codex-rs/model-provider-info/src/lib.rs`, `codex-rs/core/src/client.rs`, `codex-rs/core/src/session/turn_context.rs`, `codex-rs/app-server-protocol/src/protocol/v2/thread.rs`, `codex-rs/app-server/src/request_processors/turn_processor.rs`
- opencodex installed source: `%APPDATA%\npm\node_modules\@bitkyc08\opencodex\src` (inject.ts, router.ts, catalog/sync.ts, server/responses/core.ts, types.ts)
