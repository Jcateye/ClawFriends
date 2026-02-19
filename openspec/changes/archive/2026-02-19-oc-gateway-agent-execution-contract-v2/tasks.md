## 1. Method + Schema

- [x] 1.1 Register `agent.execute` in gateway method list and scopes
- [x] 1.2 Add protocol schema and validator for execute params
- [x] 1.3 Wire handler entrypoint for `agent.execute`

## 2. Runtime Semantics

- [x] 2.1 Add unified operation handling (`chat`, `run`) and mode defaults
- [x] 2.2 Implement unary run response contract with execution metrics fields
- [x] 2.3 Add normalized external lifecycle events (`agent.start`/`agent.end` and related mapped events)

## 3. Compatibility + Validation

- [x] 3.1 Add unit tests for `agent.execute` validation and scope guard failures
- [x] 3.2 Add tests for run unary and stream behavior
- [x] 3.3 Add regression checks confirming legacy `agent` path remains stable
