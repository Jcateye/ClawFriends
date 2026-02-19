## 1. Correlation and Metrics

- [x] 1.1 Add `requestId` support for `/skills/reload` responses
- [x] 1.2 Ensure `traceId` is required/validated for external v2 control contract
- [x] 1.3 Add terminal metrics payload for unary external run responses

## 2. Error and Compatibility Governance

- [x] 2.1 Add external snake_case error code set for platform contracts
- [x] 2.2 Ensure stream terminal `agent.end` payload includes normalized metrics block
- [x] 2.3 Add explicit compatibility/rollback guidance in gateway docs

## 3. Validation Gates

- [x] 3.1 Add/extend contract tests for external error semantics and trace propagation
- [x] 3.2 Add protocol doc checks for v1/v2 compatibility guidance and event semantics
