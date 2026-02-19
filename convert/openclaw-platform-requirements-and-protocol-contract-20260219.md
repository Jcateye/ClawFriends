# OpenClaw 底层能力需求与协议要求（FriendsAI 主导版，2026-02-19）

## 0. 文档目的

- 目的：作为 FriendsAI 对 OpenClaw 底层能力的对接准入合同（integration contract）。
- 适用范围：
  - FriendsAI：`/Users/haoqi/OnePersonCompany/friendsAI`
  - OpenClaw（ClawFriends）：`/Users/haoqi/OnePersonCompany/ClawFriends`
- 使用方式：OpenClaw 可自由设计内部实现，但对外协议和行为必须满足本文 `MUST` 要求。

## 1. 边界与职责（MUST）

1. OpenClaw MUST 承担执行态与会话态，不承担 FriendsAI 业务主数据 SoR。
2. FriendsAI 对外 API MUST 保持不变：`POST /v1/agent/chat`、`POST /v1/agent/run`。
3. OpenClaw 对 FriendsAI MUST 提供控制面协议与执行面协议，两者 MUST 可版本化。
4. OpenClaw 内部状态存储与调度实现可自定义，但外部可见语义 MUST 稳定。

## 2. 控制面协议：`POST /skills/reload`（MUST）

### 2.1 版本支持

1. OpenClaw MUST 同时支持 `v1` 与 `v2`。
2. FriendsAI 侧默认使用 `v2`，OpenClaw MUST 保持向后兼容窗口。

### 2.2 v2 请求必填字段

OpenClaw MUST 校验以下字段：

1. `tenantId`
2. `agentScope`
3. `desiredHash`
4. `skills[]`
5. `loadActions[]`
6. `unloadActions[]`
7. `traceId`
8. `protocolVersion`（值为 `v2`）

### 2.3 响应必填字段

OpenClaw MUST 返回：

1. `ok`
2. `executionMode`
3. `tenantId`
4. `agentScope`
5. `desiredHash`
6. `acceptedAtMs`
7. `summary`

### 2.4 幂等语义

1. 幂等键 MUST 定义为：`tenantId + agentScope + desiredHash + protocolVersion`。
2. 相同幂等键的重复请求 MUST 不触发重复重载副作用。
3. `traceId` MUST 用于追踪，不作为唯一幂等键。

## 3. 执行面协议（MUST）

1. OpenClaw MUST 提供统一执行入口，支持 `chat(stream)` 和 `run(unary 或 stream)`。
2. 执行上下文 MUST 包含：`traceId`、`tenantId`、`agentScope`、`sessionKey`、`agentId`、`operation`、`input`。
3. 事件语义 MUST 与 FriendsAI 当前状态机兼容：
   - `agent.start`
   - `agent.delta`
   - `agent.message`
   - `tool.state`
   - `context.patch`
   - `agent.end`
   - `error`
4. `agent.end` MUST 保证最终必达（成功/失败/取消均有终态）。
5. 当 `tool.state.status=awaiting_input` 时，响应 MUST 提供可恢复执行的 `confirmationId`。

## 4. 工具确认闸门（MUST）

1. 任何写操作工具 MUST 经确认后才能执行副作用。
2. OpenClaw MUST 支持 `confirmationId + approved` 的恢复执行协议。
3. 用户拒绝确认时 MUST 产生可审计终态（`cancelled` 或明确失败码）。
4. 未确认直接执行写操作 MUST 视为协议违规。

## 5. 错误码与重试语义（MUST）

### 5.1 错误码集合（至少）

OpenClaw MUST 提供稳定、可机器判断的错误码，至少包含：

1. `invalid_request`
2. `unauthorized`
3. `forbidden`
4. `tenant_scope_mismatch`
5. `protocol_version_unsupported`
6. `tool_confirmation_required`
7. `upstream_timeout`
8. `rate_limited`
9. `internal_error`

### 5.2 错误响应字段

每个错误响应 MUST 回传：

1. `code`
2. `message`
3. `retryable`
4. `traceId`
5. `requestId`

### 5.3 重试规则

1. OpenClaw/网关语义 MUST 支持 FriendsAI 按 `retryable` 判定重试。
2. 默认规则：
   - `4xx`：不可重试（除显式声明 `retryable=true` 的限流/瞬态场景）
   - `408`、`429`、`5xx`：可重试

## 6. 隔离与安全（MUST）

1. 隔离主键 MUST 至少覆盖：`tenantId + agentScope + sessionKey + workspace`。
2. 跨租户/跨 scope 访问 MUST 硬拒绝，不能依赖调用方“自觉”。
3. token/secret MUST 不落日志、不回传客户端、不落审计详情。
4. 对外 hook 默认 SHOULD 关闭；如开启，MUST 启用 token 白名单及 scope 校验。
5. 工具权限 MUST 最小化，默认只读，写类能力通过确认闸门放行。

## 7. 可观测性与审计（MUST）

1. 全链路 MUST 透传 `traceId`，网关 MUST 生成并回传 `requestId`。
2. OpenClaw MUST 提供或可查询以下执行指标：
   - `acceptedAtMs`
   - `firstTokenMs`（chat）
   - `totalMs`
   - `toolCount`
   - `executionMode`
3. 失败信息 MUST 可定位到阶段（鉴权/路由/执行/工具/协议校验）。
4. 审计日志 SHOULD 保留最小必要上下文，不包含敏感 payload 明文。

## 8. 协议兼容与版本治理（MUST）

1. 协议字段只允许非破坏性扩展；破坏性变更 MUST 升版本。
2. `protocolVersion` MUST 显式协商，禁止隐式行为漂移。
3. 新版本上线 MUST 提供至少一个兼容窗口（旧版本可运行并有迁移公告）。
4. 废弃版本 MUST 有明确时间表、验收门禁和回滚策略。

## 9. 联调验收门槛（MUST）

1. 跨租户隔离测试通过。
2. 协议兼容测试通过（chat 流事件 + run 结果结构）。
3. 故障回退测试通过（超时/5xx/确认拒绝）。
4. 观测字段完整性通过（`traceId`/`requestId`/`errorCode`/阶段耗时）。
5. 幂等测试通过（重复 `desiredHash` 不产生重复副作用）。

## 10. 推荐联调用例（SHOULD）

1. `skills/reload`：`v1`、`v2`、缺字段、错误 token、重复幂等键。
2. `chat(stream)`：正常结束、异常结束、工具确认中断、恢复继续。
3. `run`：成功、业务失败、上游超时、限流重试、fallback 验证。
4. 隔离：同 `agentId` 不同 `tenantId` 的 session/workspace 不可见。
5. 可观测：每次请求都能串起 `traceId -> requestId -> runId`。

## 11. 变更流程要求（SHOULD）

1. OpenClaw 侧协议改动 SHOULD 先走变更提案（proposal/design/spec/tasks）。
2. 与 FriendsAI 联调前 SHOULD 固定版本标签（release tag 或 commit SHA）。
3. 任何 breaking 变更 MUST 提前同步并给出迁移窗口。

## 12. 结论

本文是 FriendsAI 主导的底层能力准入合同：OpenClaw 的内部实现可灵活，但对外协议、隔离安全、错误语义、观测字段和兼容策略必须严格满足本文件要求，才能进入灰度与正式流量。
