# Repository instructions

- Follow the product baseline in `codex-gateway-mvp-design.md`.
- For frontend work, follow `docs/agents/frontend.md`.
- Never log credentials, prompts, tool arguments, tool output, or response bodies.
- Keep data-plane payloads opaque; only routing metadata may be inspected read-only.

## Coding principles

- Seek a reasonable separation of concerns, but avoid over-abstraction; do not add layers or indirection that buy nothing (no unnecessary base classes, factories, or wrappers).
- Favor the smallest amount of code that implements the feature, but do not create tightly coupled modules; keep dependencies clear and replaceable rather than implicit.
- Prefer reusing existing components and third-party modules over writing your own; when adopting a component or external module, check its official documentation first to confirm the correct usage and API.

## Account and routing hard rules

- Do not add automatic account routing (round robin, weighted, least-used, quota-aware, failover, or fallback).
- Do not change the active account automatically; only the user's explicit manual selection changes it.
- Every request uses the manually selected active account; when none is selected, fail with `no_active_account_selected`.
- There is no session-to-account binding; switching the active account takes effect on the next request.
- Do not use user-defined account labels; the real ChatGPT account ID is the account identity.
- The `chatgpt_account_id` from Codex auth data must be unique; duplicate logins return `account_already_exists`.
- Rate-limit data is display state only and must never affect routing or account selection.
- Gateway must not parse or rewrite Responses tool payloads; data-plane bytes stay opaque.

## Data plane freeze

- Do not change HTTP/WS proxy transport behavior without the integration tests in `server/test/gateway.e2e.test.ts` staying green.
