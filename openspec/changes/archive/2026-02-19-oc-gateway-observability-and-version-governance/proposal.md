## Why

External platform contracts require reproducible telemetry and explicit version governance to support rollout, rollback, and incident response. Current runtime data is useful but not yet normalized for cross-system contract auditing.

## What Changes

- Standardize `traceId` and `requestId` propagation in external control/execution paths.
- Add terminal execution metrics in external execution responses/events.
- Define external error code usage and retry semantics.
- Document protocol compatibility window (`v1`/`v2`) and rollback controls.
- Add validation gates to keep protocol behavior stable.

## Capabilities

### New Capabilities

- `agent-governance`: Protocol observability and version-governance baseline for external integrations.

### Modified Capabilities

- None.

## Impact

- Gateway execution/control handlers and error-code policy.
- Gateway protocol and runbook documentation.
- Contract tests and compatibility gates in CI.
- Operational rollout and rollback playbooks.
