## ADDED Requirements

### Requirement: External execution method

The Gateway SHALL expose `agent.execute` as a supported WS method for external integrations.

#### Scenario: Reject invalid execute request payload

- **WHEN** `agent.execute` receives invalid params for required fields
- **THEN** the Gateway responds with `code="invalid_request"` and does not start execution

#### Scenario: Accept valid execute request payload

- **WHEN** `agent.execute` receives valid params including tenant/scope/session context
- **THEN** the Gateway starts execution through the agent runtime path

### Requirement: Operation semantics for chat and run

The Gateway SHALL support `operation=chat|run` with consistent request shape and mode semantics.

#### Scenario: Run unary returns one terminal response

- **WHEN** `operation=run` and `mode=unary`
- **THEN** the Gateway returns exactly one terminal payload containing execution result and metrics

#### Scenario: Chat stream uses lifecycle events and terminal end

- **WHEN** `operation=chat` with stream mode
- **THEN** the Gateway emits lifecycle events and a terminal `agent.end` event

### Requirement: Normalized lifecycle events

The Gateway SHALL emit normalized external lifecycle events for `agent.execute` runs.

#### Scenario: Emit start event before deltas

- **WHEN** execution is accepted
- **THEN** the Gateway emits `agent.start` before `agent.delta` or `agent.message`

#### Scenario: Emit terminal event for success and failure

- **WHEN** execution completes or errors
- **THEN** the Gateway emits exactly one `agent.end` event containing final status

### Requirement: Backward compatibility

The Gateway SHALL keep legacy methods and event shapes functional.

#### Scenario: Legacy clients continue to work

- **WHEN** a client calls `agent`/`chat.send`/`agent.wait`
- **THEN** behavior remains compatible with existing contracts
