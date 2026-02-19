## 1. Confirmation API

- [x] 1.1 Add `agent.confirm` schema and method registration
- [x] 1.2 Map `agent.confirm` to existing approval manager resolution path
- [x] 1.3 Emit normalized `tool.state.awaiting_input` with `confirmationId`

## 2. Scope Guardrails

- [x] 2.1 Add tenant scope session-key validation helper
- [x] 2.2 Enforce scope validation in `agent.execute`
- [x] 2.3 Add negative tests for cross-tenant/scope rejection paths

## 3. Validation

- [x] 3.1 Add tests for `agent.confirm` success and unknown ID behavior
- [x] 3.2 Add tests for scope validator canonical and legacy key forms in execute path
