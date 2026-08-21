# ADR 0002: Local Codex usage analytics

## Status

Accepted.

## Context

Codex writes local rollout records below the primary `CODEX_HOME` in `sessions` and `archived_sessions`. Token-count events are cumulative snapshots within a rollout, not independent usage records. These files also contain sensitive conversation and tool content that the router must never persist or expose.

The primary Codex home contains client history produced across routing identities. Rollout metadata does not provide a reliable managed-account attribution, so these statistics cannot be presented as account-specific usage, billing, or quota data.

## Decision

- The admin console exposes a separate local usage dashboard backed by the primary `CODEX_HOME`, independent of managed account homes and request-log statistics.
- The scanner allowlists timestamps, session identifiers, model names, working-directory attribution, token counters, task lifecycle events, aborts, and context compactions. It never stores raw JSON lines, prompts, responses, tool arguments, tool output, credentials, or response bodies.
- Working directories are converted in memory to a SHA-256 key and a label containing only the final two path segments. Codex-managed `Codex/YYYY-MM-DD/name` workspaces use the shared `uncategorized-conversation` key and “无分类对话” label. Full paths are not written to the analytics cache or returned by the API.
- Token usage is the non-negative delta between adjacent cumulative snapshots. For the first observed snapshot, `last_token_usage` is used when available. Cached input is a subset of input; reasoning output is a subset of output; total usage is input plus output.
- Derived events live in a dedicated WAL-mode `codex-usage.db`; account, credential, and data-plane state remain in `gateway.db`. Existing usage rows are imported once and the legacy tables remain read-only for one compatibility version. Installation-level HMAC identifiers replace source paths and raw rollout UUIDs in the new database.
- Plain JSONL files are scanned incrementally from the last complete newline; compressed Zstandard rollouts are rescanned when their size or modification time changes. A rewrite, truncation, or encoding change is parsed into temporary state and replaces the previous derived version only after reaching EOF without a damaged complete line. A partial first scan may retain its valid prefix.
- Codex 0.147.0 moves archived rollouts between `sessions` and `archived_sessions`, may produce an optional `.jsonl.zst` representation, and may hard-delete history. Discovery therefore treats active files as authoritative over archived files and plain JSONL as authoritative over a simultaneous compressed copy. Moves and representation changes do not constitute deletion.
- A source can become missing only after both directory trees were scanned completely. The first complete absence creates a `pending_missing` candidate without changing dashboard values. A second complete scan at least 30 seconds later confirms filesystem absence and moves allowlisted events to permanent retention. Reappearance before confirmation cancels the candidate.
- File absence cannot establish who or what deleted a rollout. Audit records use `reason: unknown` and `detection: filesystem_absence`; the product must not claim that Codex automatically cleaned the file.
- Changing the resolved primary `CODEX_HOME` takes effect only after the new directory can be scanned. Retaining the old source, selecting the new HMAC source, and recording `source_changed` occur in one transaction. Dashboard queries use only the current source and de-duplicate active and retained events by rollout and ordinal.
- Audit events are committed in the same SQLite transaction as retention state. They form an append-only SHA-256 hash chain with monotonic sequence numbers. `logs/codex-usage-retention.jsonl` is an fsynced projection: startup validates and repairs its tail, retries unexported database events, and rebuilds a tampered or missing projection while preserving the damaged file. It contains HMAC identifiers and allowlisted lifecycle metadata only.
- Online SQLite backups are published below `backups/codex-usage` only after integrity, row-count, Token-total, and SHA-256 verification. The system takes at most one daily snapshot plus debounced snapshots after retention or source changes, retains daily and weekly generations, and restores the newest valid snapshot when the primary usage database is missing or corrupt. Faulty database, WAL, and SHM files are preserved for diagnosis, and recovery is itself audited.
- Scanning is asynchronous and periodic and must not block or alter HTTP/WebSocket proxy behavior. Scan failures expose only a partial-status flag and safe identifiers; raw line content must not appear in logs.
- The API and UI always identify the result as a local, all-account aggregate that is not billing or quota data. No account filter is offered.

## Consequences

The dashboard can show trends, daily model composition, model/project distribution, task workload, activity time, scan completeness, audit synchronization, and snapshot health using only local derived metadata. Once scanned, historical values remain available after a confirmed source absence and can survive primary database damage when a verified snapshot exists. History that disappeared before retention was introduced cannot be reconstructed. Exact account attribution, deletion-cause attribution, and cost estimation remain out of scope.
