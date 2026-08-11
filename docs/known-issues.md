# Known issues

## Resolved: Windows plugin clone locks could fail completed account logins

Codex plugin startup sync can briefly retain a handle below
`login-staging/<id>/codex-home/.tmp/plugins-clone-*` after the login app-server exits.
Older builds coupled account promotion to recursive staging deletion, so a Windows
`EBUSY` could report a completed OAuth login as failed after the target credentials
had already been copied.

Implemented resolution:

- Login-only app-servers disable the unrelated Codex plugins feature.
- Account credentials are copied without transient `.tmp`/`tmp` trees, validated,
  and atomically promoted before the SQLite transaction commits.
- Staging cleanup is best-effort with bounded Windows lock retries and startup
  cleanup; it cannot roll back a committed account.
- Login status exposes stable error codes instead of local filesystem paths.

## Resolved: repeated `/models` failures were over-counted

Observed behavior:

- Codex periodically refreshes `GET /backend-api/codex/models` and retries after failures.
- Older builds recorded both upstream timeouts and client-cancelled slow refreshes as
  `502`, which inflated the error count.

Implemented resolution:

- Proxy exceptions retain the selected account ID when one was resolved.
- Downstream abort/close is now recorded as `client_cancelled` without a fabricated
  status code and is excluded from upstream API availability.
- Structured outcomes distinguish success, upstream rejection, upstream failure,
  gateway failure, and client cancellation.

Security constraints remain unchanged: diagnostics must not record credentials,
prompts, tool arguments, tool output, or response bodies.

## Resolved: remote compaction v2 on reused WebSockets was classified as normal Responses

Codex supports two remote compaction transports. V1 sends
`POST /backend-api/codex/responses/compact`, which the router classifies as `compact`.
V2 sends a normal Responses stream (HTTP or WebSocket) with
`client_metadata["x-codex-turn-metadata"].request_kind = "compaction"`. A reused
WebSocket does not repeat the compatibility handshake header, which caused older
builds to miss the request.

Implemented resolution:

- HTTP continues to use the bounded compatibility header.
- WebSocket diagnostics stream-select only the official request-kind metadata and
  terminal event fields, without constructing or storing the full payload.
- Each non-prewarm `response.create` receives a request-level log entry, so a V2
  compaction on an already-reused connection is recorded as `compact` when its
  terminal event arrives.
- Malformed, binary, or future frames remain byte-for-byte transparent; failure to
  extract diagnostics never blocks forwarding.
