## Context

OpenClaw already supports approval requests and resolutions (`exec.approval.*`) for sensitive tool actions. External platforms need a method-level contract that is easy to consume and enforce while preserving current approval manager internals.

## Goals / Non-Goals

**Goals:**

- Expose `agent.confirm` for external callers with minimal mapping complexity.
- Enforce tenant/scope/session alignment before execution starts.
- Make scope violations explicit and non-retryable.
- Ensure pending confirmation state can be correlated by external clients.

**Non-Goals:**

- Replacing internal approval manager implementation.
- Redesigning all tool-level approval UX in this phase.
- Implementing full authorization policy engine changes.

## Decisions

1. Add `agent.confirm` as compatibility wrapper.

- Decision: `approved=true|false` maps to `allow-once|deny` in approval manager.
- Why: Keeps external API simple and avoids exposing internal decision variants.

2. Enforce scope guard at method ingress.

- Decision: Validate `sessionKey` against `tenantId` + `agentScope` before run start.
- Why: Prevents cross-tenant/session confusion from malformed external requests.

3. Keep approval event compatibility and add normalized tool-state signal.

- Decision: Continue broadcasting `exec.approval.requested` while also emitting normalized `tool.state` with `confirmationId`.
- Why: Preserves old consumers and unlocks stable external contract.

## Risks / Trade-offs

- [Risk] Legacy session keys not matching canonical tenant prefix. -> Mitigation: Support canonical and legacy prefix formats in validator.
- [Risk] Wrapper API may hide richer internal decisions (`allow-always`). -> Mitigation: Keep internal method for advanced operator tooling.
- [Risk] Additional event broadcast duplication. -> Mitigation: Keep payload compact and deterministic.

## Migration Plan

1. Add scope validator helpers and integrate into `agent.execute`.
2. Introduce `agent.confirm` and map to existing approval resolution.
3. Emit normalized tool-state confirmation events.
4. Validate via unit/e2e tests and external integration harness.

## Open Questions

- Should `agent.confirm` support batch confirmations in a future protocol version?
