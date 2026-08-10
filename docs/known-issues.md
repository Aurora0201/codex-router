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

## No `/responses/compact` rows without a remote compaction request

The router only proxies and records remote compaction initiated by Codex. It does not
decide when to compact, count context tokens, or synthesize summaries. An empty
`compact` transport therefore means the connected Codex process has not sent
`POST /backend-api/codex/responses/compact`; it is not evidence that the request-log
filter omitted the route.
