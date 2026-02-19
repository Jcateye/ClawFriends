## Context

`/skills/reload` is the primary control-plane entry point used by operator clients and will now also be used by external systems (such as FriendsAI orchestration). External callers need deterministic retries, strict versioning, and traceability.

## Goals / Non-Goals

**Goals:**

- Provide a strict `v2` contract while preserving `v1` compatibility.
- Ensure repeated identical requests do not execute duplicate side effects.
- Return structured errors that allow caller retry policy decisions.
- Return request correlation identifiers in every response path.

**Non-Goals:**

- Changing internal skill load execution semantics in this phase.
- Replacing `/skills/reload` with a new endpoint.
- Building distributed idempotency storage in this phase.

## Decisions

1. Keep one endpoint with protocol version gates.

- Decision: Use `protocolVersion` in request body with `v1`/`v2` semantics.
- Why: Non-breaking migration path.
- Alternative rejected: New endpoint path for v2 (forces duplicate integration surface).

2. Enforce strict required fields in v2.

- Decision: `traceId`, `loadActions`, and `unloadActions` become mandatory for `v2`.
- Why: Ensures deterministic intent expression and observability.
- Alternative rejected: Keep optional fields and infer defaults (too ambiguous for external systems).

3. Add in-process idempotency cache keyed by tenant/scope/hash/version.

- Decision: Idempotency key = `tenantId + agentScope + desiredHash + protocolVersion` with bounded TTL.
- Why: Eliminates duplicate side effects for common retry windows with low complexity.
- Alternative rejected: No idempotency (unsafe), DB-backed idempotency (heavier than needed for first phase).

4. Standardize error envelope for external calls.

- Decision: Always return `code`, `message`, `retryable`, `traceId`, `requestId`.
- Why: Predictable integration and incident triage.
- Alternative rejected: Mixed legacy/plain errors.

## Risks / Trade-offs

- [Risk] In-memory idempotency is process-local only. -> Mitigation: Document behavior and upgrade to shared store when multi-instance control plane is introduced.
- [Risk] Stricter v2 validation may break loosely implemented clients. -> Mitigation: Keep `v1` compatibility window and explicit version errors.
- [Risk] Cache growth if abused. -> Mitigation: TTL pruning and narrow key space.

## Migration Plan

1. Roll out validation + envelope changes with `v1` untouched.
2. Enable v2 in external client integration tests.
3. Monitor request/error rates using `traceId` + `requestId` correlation.
4. Deprecate v1 only after external clients complete migration.

## Open Questions

- Should idempotency become durable across process restarts for control-plane HA mode?
- Should `requestId` be optionally client-provided for cross-system correlation continuity?
