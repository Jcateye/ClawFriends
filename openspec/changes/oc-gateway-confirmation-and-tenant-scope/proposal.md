## Why

External execution calls must not bypass write confirmations and must never cross tenant boundaries. Existing approval flows and session handling exist, but external integrations need protocol-level guarantees for confirmation and scope enforcement.

## What Changes

- Add `agent.confirm` method with `confirmationId + approved` semantics.
- Map `agent.confirm` to existing approval resolution path.
- Enforce tenant scope constraints using `tenantId + agentScope + sessionKey` checks in external execute flow.
- Add explicit `tenant_scope_mismatch` rejection semantics.
- Expose pending confirmation IDs in external-facing tool-state event shape.

## Capabilities

### New Capabilities

- `agent-confirmation-and-scope`: Protocol-level confirmation and tenant-scope guardrails for external execution.

### Modified Capabilities

- None.

## Impact

- Gateway approval handlers and method scopes.
- Session key validation helpers and external execute guard paths.
- Tests for cross-scope rejection and confirmation lifecycle behavior.
- External protocol docs and governance playbooks.
