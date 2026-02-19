## ADDED Requirements

### Requirement: Versioned skills reload contract

The Gateway SHALL accept `POST /skills/reload` requests for both `protocolVersion=v1` and `protocolVersion=v2`.

#### Scenario: Accept v1 compatibility request

- **WHEN** a request includes valid `tenantId`, `agentScope`, `desiredHash`, and `skills[]` with `protocolVersion=v1`
- **THEN** the Gateway returns `200` with `ok=true` and includes a generated `requestId`

#### Scenario: Reject unsupported protocol version

- **WHEN** a request includes any protocol version other than `v1` or `v2`
- **THEN** the Gateway returns `400` with `code="protocol_version_unsupported"`

### Requirement: v2 strict validation

For `protocolVersion=v2`, the Gateway SHALL require explicit `traceId`, `loadActions[]`, and `unloadActions[]`.

#### Scenario: Reject missing v2 actions

- **WHEN** a `v2` request omits `loadActions` or `unloadActions`
- **THEN** the Gateway returns `400` with `code="invalid_request"` and a clear validation message

#### Scenario: Reject missing v2 trace id

- **WHEN** a `v2` request omits `traceId`
- **THEN** the Gateway returns `400` with `code="invalid_request"`

### Requirement: Idempotent control-plane acceptance

The Gateway SHALL treat repeated requests with identical `(tenantId, agentScope, desiredHash, protocolVersion)` as idempotent for the active idempotency window.

#### Scenario: Return cached acceptance for duplicate key

- **WHEN** the same idempotency tuple is submitted twice within the cache window
- **THEN** the second response returns the same `requestId` and `acceptedAtMs` as the first response

### Requirement: Structured error envelope

The Gateway SHALL return structured errors for `/skills/reload` with `code`, `message`, `retryable`, `traceId`, and `requestId`.

#### Scenario: Unauthorized caller receives structured error

- **WHEN** a caller sends `/skills/reload` without valid gateway auth
- **THEN** the response is `401` and includes `code="unauthorized"`, `retryable=false`, and `requestId`
