## Why

External systems need a stable control-plane contract for skills reloading so retries do not create duplicate side effects and operators can trace every request end-to-end. The current endpoint shape is useful but too loose for platform-grade integration.

## What Changes

- Harden `POST /skills/reload` with a versioned external contract (`v1` + `v2`).
- Require stricter fields for `protocolVersion=v2`, including `traceId` and explicit `loadActions`/`unloadActions`.
- Add idempotency behavior keyed by tenant/scope/hash/version.
- Standardize error response shape with explicit retry semantics and trace fields.
- Add request correlation (`requestId`) for accepted and rejected requests.

## Capabilities

### New Capabilities

- `skills-reload-contract`: Versioned, idempotent, traceable control-plane contract for skill reload requests.

### Modified Capabilities

- None.

## Impact

- Gateway HTTP handler for `/skills/reload`.
- Shared gateway error semantics for external callers.
- Tests for request validation, compatibility, and idempotency.
- Gateway docs for control-plane protocol behavior.
