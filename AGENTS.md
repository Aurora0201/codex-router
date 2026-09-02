# Repository instructions

Stable, long-lived rules for agents working in this repository. Follow these across sessions;
one-off decisions belong in commit messages or ADRs, not here.

## Source of truth

- `docs/adr/0001-transparent-identity-proxy.md` is the authoritative reference for proxy and data-plane routing, including the account/routing hard rules (no automatic routing, manual active-account selection only, no session binding, opaque data plane); treat it as current truth.
- Frontend: follow `docs/agents/design-system.md`.
- Consult `docs/` before changing routing or transport behavior; update the relevant ADR when rules evolve.

## Coding principles

- Seek a reasonable separation of concerns, but avoid over-abstraction; do not add layers or indirection that buy nothing (no unnecessary base classes, factories, or wrappers).
- Favor the smallest amount of code that implements the feature, but do not create tightly coupled modules; keep dependencies clear and replaceable rather than implicit.
- Prefer reusing existing components and third-party modules over writing your own. When adopting or relying on any component, external module, or library API, search and check the latest official documentation to confirm the correct usage and API; do not rely on memory or outdated docs.

## Data plane freeze

- Do not change HTTP/WS proxy transport behavior without the integration tests in `server/test/gateway.e2e.test.ts` staying green.
- Before adding any new data-plane route, confirm the endpoint against the Codex source (`codex-rs/codex-api/src/endpoint`, `codex-rs/ext/web-search`) and record it in `docs/adr/0001-transparent-identity-proxy.md`.
- Data-plane payloads stay opaque; only routing metadata may be inspected read-only.

## Security

- Never log credentials, prompts, tool arguments, tool output, or response bodies.

## Git workflow

- `main` is the only long-lived branch and must stay deployable. Do not commit directly to it.
- Work on short-lived branches: `fix/...` for bug fixes, `feature/...` for features, `chore/...` for maintenance.
- Merge into `main` with `--no-ff` and delete the branch afterwards.
- Rebase the branch onto `main` before merging; never merge `main` into the branch.
- Use conventional commit messages (`fix:`, `feat:`, `refactor:`, `docs:`, `chore:`); one logical change per commit.
- Never force-push to `main`; undo with `git revert`.
- Tag releases (e.g. `v0.1.0`) so rollback points are explicit.

## Verification (definition of done)

- Changes must pass `npm test`, `npm run lint`, and `npm run build` before merging.
- Any transport/proxy change must keep `server/test/gateway.e2e.test.ts` green.
- After upgrading the `@openai/codex` dependency, run the full compatibility smoke test (see `docs/compatibility.md`).
