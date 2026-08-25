# Production observability

Kheyflix writes newline-delimited JSON events to standard output and standard
error. Railway collects these streams without a separate in-process transport.
Every public API response also returns `X-Request-Id` and `Server-Timing`.

## Correlating an incident

1. Copy the `Reference` shown in a user-facing error, or the `x-request-id`
   response header from browser developer tools.
2. Search Railway logs for the exact `requestId`.
3. Read the leading `message` (for example, `Search catalog failed (503)`) and
   use `event`, `status`, `errorCode`, and `durationMs` for filtering.

The browser console also emits structured discovery lifecycle events. These
include search result counts, preparation start/acceptance, and correlated API
failures. They never include the search term, release title, magnet URI, request
body, credentials, or unlocked provider URL.

## Event contract

Every emitted event leads with a short `message`, followed by `level`, `event`,
and the smallest useful context. API action events include `requestId`, method,
status, and duration; failed JSON responses also include `errorCode` when
available. Railway already supplies time, environment, service, and deployment
context, so Kheyflix does not repeat those fields on every line.

Provider and health events add only bounded operational metadata: result counts,
cache state, dependency booleans, provider error type/code, or numeric resource
identifiers. A central sanitizer redacts sensitive field names, authorization
values, credential/token/cookie/session patterns, magnet URIs, and HTTP(S) URLs
as defense in depth. Provider messages cross an additional public-message filter
before they can appear in an API response.

Expected severity:

- `info`: meaningful successful user operations;
- `warn`: client errors, degraded optional dependencies, or recoverable states;
- `error`: server/upstream failures and unhandled exceptions.

## Operational checks

- One user action produces at most one application event.
- Successful health probes, playback keepalives/stops, and byte-range responses
  are intentionally silent; degraded health, failures, and slow actionable
  operations remain visible.
- A 5xx event must carry the same request ID as the response and user reference.
- `/api/health` emits `health.check.completed` only when degraded and must report
  the exact deployed commit in its response.
- Never add request bodies, raw query strings, headers, magnets, or provider URLs
  to logging context.
