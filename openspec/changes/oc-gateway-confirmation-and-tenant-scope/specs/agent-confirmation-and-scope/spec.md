## ADDED Requirements

### Requirement: External confirmation method

The Gateway SHALL expose `agent.confirm` with fields `confirmationId`, `approved`, and `traceId`.

#### Scenario: Approve pending confirmation

- **WHEN** `agent.confirm` is called with a valid `confirmationId` and `approved=true`
- **THEN** the approval manager resolves the request as `allow-once` and returns success

#### Scenario: Reject unknown confirmation id

- **WHEN** `agent.confirm` is called with a non-existent `confirmationId`
- **THEN** the Gateway returns `code="invalid_request"` and does not mutate approval state

### Requirement: Tenant scope enforcement

The Gateway SHALL enforce tenant/scope/session alignment before starting `agent.execute` processing.

#### Scenario: Reject session outside tenant scope

- **WHEN** `agent.execute` includes a `sessionKey` not matching `tenantId` + `agentScope`
- **THEN** the Gateway rejects with `code="tenant_scope_mismatch"` and no execution side effects

#### Scenario: Accept canonical tenant-scoped session keys

- **WHEN** `sessionKey` matches `tenant:<tenantId>:scope:<agentScope>:` prefix
- **THEN** scope validation passes and execution may continue

### Requirement: Confirmation state visibility

The Gateway SHALL expose pending confirmation identity in normalized tool-state payloads.

#### Scenario: Pending approval emits awaiting_input state

- **WHEN** an approval request is created for a tool action
- **THEN** the Gateway emits `tool.state` with `state="awaiting_input"` and `confirmationId`
