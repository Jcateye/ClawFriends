## Why

External systems need one stable execution method for both conversational and workflow-style agent calls without depending on legacy method quirks. The existing `agent` method works for OpenClaw clients, but external integrators need explicit tenant/scope context and normalized lifecycle semantics.

## What Changes

- Add a new WS method `agent.execute` for external execution contracts.
- Support two operations under one method: `chat` and `run`.
- Support `run` in both `unary` and `stream` modes.
- Normalize output lifecycle semantics with explicit final-state guarantees.
- Preserve backward compatibility by keeping existing `agent`/`chat.send`/`agent.wait` methods unchanged.

## Capabilities

### New Capabilities

- `agent-execution-contract`: External-facing, versioned execution API for chat and run operations.

### Modified Capabilities

- None.

## Impact

- Gateway method registry and protocol schema validators.
- Agent request handling and lifecycle event mapping.
- Gateway protocol docs and external integration guidance.
- Tests for method validation, mode behavior, and compatibility.
