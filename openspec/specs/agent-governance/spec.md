# agent-governance Specification

## Purpose

TBD - created by archiving change oc-gateway-observability-and-version-governance. Update Purpose after archive.

## Requirements

### Requirement: Correlation identifiers

External control and execution contracts SHALL expose correlation identifiers for request tracing.

#### Scenario: Skills reload returns request id

- **WHEN** `/skills/reload` accepts or rejects a request
- **THEN** the response includes `requestId` and trace context fields

#### Scenario: Execute path preserves trace context

- **WHEN** `agent.execute` receives `traceId`
- **THEN** terminal payloads and error details include that trace context

### Requirement: Terminal execution metrics

Terminal execution payloads SHALL include key performance metrics.

#### Scenario: Unary run returns metrics block

- **WHEN** a unary run completes
- **THEN** payload includes `acceptedAtMs`, `firstTokenMs`, `totalMs`, `toolCount`, and `executionMode`

#### Scenario: Terminal lifecycle event includes metrics

- **WHEN** a streamed run completes
- **THEN** `agent.end` includes the same metrics fields or explicit nulls when unavailable

### Requirement: Version governance compatibility window

The Gateway SHALL keep external contract compatibility for `v1` and `v2` during migration windows and document downgrade paths.

#### Scenario: v2 can be disabled without breaking v1 clients

- **WHEN** v2 routing is disabled for rollback
- **THEN** v1 clients continue to operate through existing methods/contracts

### Requirement: External error semantics

External-facing contracts SHALL use documented snake_case error codes with retryability semantics.

#### Scenario: Scope mismatch returns non-retryable error

- **WHEN** a scope mismatch is detected
- **THEN** the returned error uses `tenant_scope_mismatch` and `retryable=false`
