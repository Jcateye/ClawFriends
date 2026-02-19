import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";
import { agentHandlers } from "./agent.js";

const mocks = vi.hoisted(() => ({
  loadSessionEntry: vi.fn(),
  updateSessionStore: vi.fn(),
  agentCommand: vi.fn(),
  registerAgentRunContext: vi.fn(),
  loadConfigReturn: {} as Record<string, unknown>,
}));

vi.mock("../session-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../session-utils.js")>("../session-utils.js");
  return {
    ...actual,
    loadSessionEntry: mocks.loadSessionEntry,
  };
});

vi.mock("../../config/sessions.js", async () => {
  const actual = await vi.importActual<typeof import("../../config/sessions.js")>(
    "../../config/sessions.js",
  );
  return {
    ...actual,
    updateSessionStore: mocks.updateSessionStore,
    resolveAgentIdFromSessionKey: () => "main",
    resolveExplicitAgentSessionKey: () => undefined,
    resolveAgentMainSessionKey: () => "agent:main:main",
  };
});

vi.mock("../../commands/agent.js", () => ({
  agentCommand: mocks.agentCommand,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => mocks.loadConfigReturn,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: () => ["main"],
}));

vi.mock("../../infra/agent-events.js", () => ({
  registerAgentRunContext: mocks.registerAgentRunContext,
  onAgentEvent: vi.fn(),
}));

vi.mock("../../sessions/send-policy.js", () => ({
  resolveSendPolicy: () => "allow",
}));

vi.mock("../../utils/delivery-context.js", async () => {
  const actual = await vi.importActual<typeof import("../../utils/delivery-context.js")>(
    "../../utils/delivery-context.js",
  );
  return {
    ...actual,
    normalizeSessionDeliveryFields: () => ({}),
  };
});

const makeContext = (): GatewayRequestContext =>
  ({
    dedupe: new Map(),
    addChatRun: vi.fn(),
    logGateway: { info: vi.fn(), error: vi.fn() },
  }) as unknown as GatewayRequestContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadConfigReturn = {};
});

describe("gateway agent handler", () => {
  it("preserves cliSessionIds from existing session entry", async () => {
    const existingCliSessionIds = { "claude-cli": "abc-123-def" };
    const existingClaudeCliSessionId = "abc-123-def";

    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: Date.now(),
        cliSessionIds: existingCliSessionIds,
        claudeCliSessionId: existingClaudeCliSessionId,
      },
      canonicalKey: "agent:main:main",
    });

    let capturedEntry: Record<string, unknown> | undefined;
    mocks.updateSessionStore.mockImplementation(async (_path, updater) => {
      const store: Record<string, unknown> = {};
      await updater(store);
      capturedEntry = store["agent:main:main"] as Record<string, unknown>;
    });

    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });

    const respond = vi.fn();
    await agentHandlers.agent({
      params: {
        message: "test",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "test-idem",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "agent" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.updateSessionStore).toHaveBeenCalled();
    expect(capturedEntry).toBeDefined();
    expect(capturedEntry?.cliSessionIds).toEqual(existingCliSessionIds);
    expect(capturedEntry?.claudeCliSessionId).toBe(existingClaudeCliSessionId);
  });

  it("injects a timestamp into the message passed to agentCommand", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-29T01:30:00.000Z")); // Wed Jan 28, 8:30 PM EST
    mocks.agentCommand.mockReset();

    mocks.loadConfigReturn = {
      agents: {
        defaults: {
          userTimezone: "America/New_York",
        },
      },
    };

    mocks.loadSessionEntry.mockReturnValue({
      cfg: mocks.loadConfigReturn,
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: Date.now(),
      },
      canonicalKey: "agent:main:main",
    });
    mocks.updateSessionStore.mockResolvedValue(undefined);
    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });

    const respond = vi.fn();
    await agentHandlers.agent({
      params: {
        message: "Is it the weekend?",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "test-timestamp-inject",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "ts-1", method: "agent" },
      client: null,
      isWebchatConnect: () => false,
    });

    // Wait for the async agentCommand call
    await vi.waitFor(() => expect(mocks.agentCommand).toHaveBeenCalled());

    const callArgs = mocks.agentCommand.mock.calls[0][0];
    expect(callArgs.message).toBe("[Wed 2026-01-28 20:30 EST] Is it the weekend?");

    mocks.loadConfigReturn = {};
    vi.useRealTimers();
  });

  it("handles missing cliSessionIds gracefully", async () => {
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: Date.now(),
        // No cliSessionIds or claudeCliSessionId
      },
      canonicalKey: "agent:main:main",
    });

    let capturedEntry: Record<string, unknown> | undefined;
    mocks.updateSessionStore.mockImplementation(async (_path, updater) => {
      const store: Record<string, unknown> = {};
      await updater(store);
      capturedEntry = store["agent:main:main"] as Record<string, unknown>;
    });

    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });

    const respond = vi.fn();
    await agentHandlers.agent({
      params: {
        message: "test",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "test-idem-2",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "2", method: "agent" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.updateSessionStore).toHaveBeenCalled();
    expect(capturedEntry).toBeDefined();
    // Should be undefined, not cause an error
    expect(capturedEntry?.cliSessionIds).toBeUndefined();
    expect(capturedEntry?.claudeCliSessionId).toBeUndefined();
  });

  it("agent.execute rejects session keys outside tenant scope", async () => {
    const respond = vi.fn();

    await agentHandlers["agent.execute"]({
      params: {
        tenantId: "tenant-1",
        agentScope: "agent-main",
        sessionKey: "tenant:tenant-2:scope:agent-main:conv:1",
        agentId: "main",
        operation: "chat",
        input: { message: "hello" },
        traceId: "trace-1",
        protocolVersion: "v2",
        idempotencyKey: "idem-1",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "ex-1", method: "agent.execute" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "tenant_scope_mismatch" }),
    );
    expect(mocks.agentCommand).not.toHaveBeenCalled();
  });

  it("agent.execute run unary returns terminal payload with metrics", async () => {
    mocks.agentCommand.mockResolvedValueOnce({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 50 },
    });
    const respond = vi.fn();

    await agentHandlers["agent.execute"]({
      params: {
        tenantId: "tenant-1",
        agentScope: "agent-main",
        sessionKey: "tenant:tenant-1:scope:agent-main:conv:1",
        agentId: "main",
        operation: "run",
        mode: "unary",
        input: { prompt: "summarize" },
        traceId: "trace-run-1",
        protocolVersion: "v2",
        idempotencyKey: "idem-run-1",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "ex-2", method: "agent.execute" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "ok",
        operation: "run",
        mode: "unary",
        traceId: "trace-run-1",
        requestId: "ex-2",
        metrics: expect.objectContaining({
          executionMode: "unary",
          acceptedAtMs: expect.any(Number),
          totalMs: expect.any(Number),
        }),
      }),
      undefined,
      expect.objectContaining({ runId: "idem-run-1" }),
    );
  });

  it("agent.execute returns trace and request ids in validation errors", async () => {
    const respond = vi.fn();

    await agentHandlers["agent.execute"]({
      params: {
        tenantId: "tenant-1",
        agentScope: "agent-main",
        sessionKey: "tenant:tenant-1:scope:agent-main:conv:3",
        agentId: "main",
        operation: "chat",
        input: {},
        traceId: "trace-invalid-1",
        protocolVersion: "v2",
        idempotencyKey: "idem-invalid-1",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "ex-invalid-1", method: "agent.execute" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "invalid_request",
        details: expect.objectContaining({
          traceId: "trace-invalid-1",
          requestId: "ex-invalid-1",
        }),
      }),
    );
  });

  it("agent.execute chat stream delegates to legacy agent flow", async () => {
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: Date.now(),
      },
      canonicalKey: "agent:main:main",
    });
    mocks.updateSessionStore.mockResolvedValue(undefined);
    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });
    const respond = vi.fn();

    await agentHandlers["agent.execute"]({
      params: {
        tenantId: "tenant-1",
        agentScope: "agent-main",
        sessionKey: "tenant:tenant-1:scope:agent-main:conv:2",
        agentId: "main",
        operation: "chat",
        mode: "stream",
        input: { message: "hello from execute" },
        traceId: "trace-chat-1",
        protocolVersion: "v2",
        idempotencyKey: "idem-chat-1",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "ex-3", method: "agent.execute" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ status: "accepted" }),
      undefined,
      expect.objectContaining({ runId: "idem-chat-1" }),
    );
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({ status: "ok", runId: "idem-chat-1" }),
        undefined,
        expect.objectContaining({ runId: "idem-chat-1" }),
      ),
    );
  });

  it("agent.execute accepts legacy tenant scope session keys", async () => {
    mocks.agentCommand.mockResolvedValueOnce({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 20 },
    });
    const respond = vi.fn();

    await agentHandlers["agent.execute"]({
      params: {
        tenantId: "tenant-1",
        agentScope: "agent-main",
        sessionKey: "tenant-1:agent-main:conv:legacy-1",
        agentId: "main",
        operation: "run",
        mode: "unary",
        input: { prompt: "legacy scope" },
        traceId: "trace-legacy-1",
        protocolVersion: "v2",
        idempotencyKey: "idem-legacy-1",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "ex-4", method: "agent.execute" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "ok",
        traceId: "trace-legacy-1",
      }),
      undefined,
      expect.objectContaining({ runId: "idem-legacy-1" }),
    );
  });
});
