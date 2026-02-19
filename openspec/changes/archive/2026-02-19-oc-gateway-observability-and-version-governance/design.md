## Context

The platform now introduces external methods (`agent.execute`, `agent.confirm`) and stricter control-plane semantics (`/skills/reload` v2). Without standardized tracing and performance signals, debugging integration issues and governing protocol upgrades is expensive and error-prone.

## Goals / Non-Goals

**Goals:**

- Ensure every external request can be correlated via `traceId` and `requestId`.
- Publish terminal execution metrics for capacity and SLO tracking.
- Formalize protocol compatibility and rollback expectations.
- Keep governance additive and non-breaking.

**Non-Goals:**

- Building a full telemetry backend in this phase.
- Introducing mandatory distributed tracing dependencies.
- Deprecating v1 immediately.

## Decisions

1. Correlation baseline.

- Decision: External calls carry `traceId`; gateway generates/returns `requestId` where applicable.
- Why: Supports external-to-gateway join keys for debugging.

2. Terminal metrics contract.

- Decision: Include `acceptedAtMs`, `firstTokenMs`, `totalMs`, `toolCount`, `executionMode` in terminal execution payloads.
- Why: Gives stable fields for SLA dashboards and load planning.

3. Version governance window.

- Decision: Keep `v1` compatibility while `v2` is rolling out, with explicit downgrade path by method/field gating.
- Why: Safer phased rollout for heterogeneous clients.

4. Error code harmonization.

- Decision: Use snake_case external errors for platform-facing contracts while preserving internal legacy codes.
- Why: Improves cross-language/client consistency without breaking existing internals.

## Risks / Trade-offs

- [Risk] Mixed internal and external error code families may confuse maintainers. -> Mitigation: Document code families and usage boundaries.
- [Risk] Metrics gaps for some providers (e.g., first token unavailable). -> Mitigation: Allow nullable metrics fields and document semantics.
- [Risk] Governance docs diverge from implementation. -> Mitigation: Add contract-focused tests and update docs with each protocol change.

## Migration Plan

1. Add and validate correlation fields in external paths.
2. Emit/return normalized terminal metrics.
3. Update protocol/runbook docs with version and rollback policy.
4. Add test coverage for error semantics and observability payloads.

## Open Questions

- Should `requestId` be propagated in WS response metadata as a first-class field in a future protocol schema revision?
