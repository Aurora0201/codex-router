# Known issues

## Repeated `/models` failures can be over-counted

Observed behavior:

- Codex periodically refreshes `GET /backend-api/codex/models` and retries after failures.
- When the upstream connection to `chatgpt.com:443` times out, or the Codex client
  cancels a slow refresh, the router currently records the request as a `502` error.
- The exception path does not retain the account that had already been selected, so
  these rows can have an empty account label even though routing succeeded.

Follow-up work:

- Retain the selected account ID when logging proxy exceptions.
- Distinguish client cancellation from an upstream gateway failure in structured logs
  and error summaries.
- Add tests for upstream connect timeout, client cancellation, and account attribution.

Security constraints remain unchanged: diagnostics must not record credentials,
prompts, tool arguments, tool output, or response bodies.

## Remote compaction v2 is classified as a normal Responses request

Codex supports two remote compaction transports. V1 sends
`POST /backend-api/codex/responses/compact`, which the router classifies as `compact`.
V2 sends a normal Responses stream (HTTP or WebSocket) with
`x-codex-turn-metadata.request_kind = "compaction"`, so it is currently classified as
`http` or `ws`. Consequently, an empty `compact` transport does not mean that no
compaction occurred.

Follow-up work:

- Read only the bounded `x-codex-turn-metadata` compatibility header and classify
  `request_kind = "compaction"` as `compact` for both HTTP and WebSocket requests.
- Keep the data-plane body opaque; never inspect the compaction trigger or other
  request content to perform this classification.
- Preserve the physical transport separately if the UI needs to distinguish HTTP
  from WebSocket.
