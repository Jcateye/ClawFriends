## Context

The Gateway currently exposes `agent` and `chat.send` flows optimized for OpenClaw-native clients. External platform usage needs explicit tenant/scope/session ownership and consistent execution semantics for both conversational (`chat`) and task (`run`) operations.

## Goals / Non-Goals

**Goals:**

- Introduce `agent.execute` without breaking existing clients.
- Define one request shape that works for `chat` and `run` operations.
- Ensure terminal completion visibility for stream and unary workflows.
- Reuse existing agent runtime paths where safe.

**Non-Goals:**

- Removing or rewriting the existing `agent` method.
- Changing internal model/provider execution behavior.
- Defining domain-specific business payload schemas in this phase.

## Decisions

1. Add method instead of replacing existing method.

- Decision: Introduce `agent.execute`; keep `agent` unchanged.
- Why: Lowest regression risk and gradual migration path.

2. Unified request envelope.

- Decision: Require `tenantId`, `agentScope`, `sessionKey`, `agentId`, `operation`, `input`, `traceId`, `protocolVersion`, and `idempotencyKey`.
- Why: Makes ownership and observability explicit.

3. Run mode split.

- Decision: `run` supports `mode=unary|stream`; default `run` to unary and `chat` to stream.
- Why: Fits synchronous workflow APIs and conversational UX.

4. Lifecycle normalization.

- Decision: Keep legacy `agent` events and additionally emit normalized lifecycle events (`agent.start`, `agent.delta`, `agent.message`, `tool.state`, `context.patch`, `agent.end`, `error`) with stable payload fields.
- Why: External clients get stable semantics while old clients remain compatible.

## Risks / Trade-offs

- [Risk] Duplicate event streams (legacy + normalized) may increase event volume. -> Mitigation: Keep normalized payloads lightweight and document opt-in filtering on clients.
- [Risk] Mapping layer drift from source events. -> Mitigation: Add focused tests for lifecycle mapping invariants.
- [Risk] Confusion between unary and stream behavior. -> Mitigation: Explicit mode defaults and protocol docs.

## Migration Plan

1. Add schemas + handler behind new method name.
2. Validate with external client harness using chat then run-unary then run-stream.
3. Keep legacy methods as fallback path.
4. Promote `agent.execute` as preferred external method in docs.

## Open Questions

- Should future protocol versions expose an explicit subscription flag to disable legacy `agent` events for external-only clients?
