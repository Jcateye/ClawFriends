## 1. Contract Hardening

- [x] 1.1 Add `/skills/reload` protocol version gates for `v1` and `v2`
- [x] 1.2 Enforce `v2` required fields (`traceId`, `loadActions`, `unloadActions`)
- [x] 1.3 Add structured external error envelope fields (`code`, `message`, `retryable`, `traceId`, `requestId`)

## 2. Idempotency + Traceability

- [x] 2.1 Add deterministic idempotency key based on tenant/scope/hash/version
- [x] 2.2 Add bounded cache window for duplicate request handling
- [x] 2.3 Return `requestId` for successful acceptances and cached responses

## 3. Validation

- [x] 3.1 Add unit/e2e coverage for v1/v2 compatibility and strict validation
- [x] 3.2 Add test coverage for unsupported protocol and unauthorized paths
- [x] 3.3 Add test coverage for duplicate idempotency behavior
