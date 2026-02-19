import { describe, expect, it, vi } from "vitest";
import { registerAgentRunContext, resetAgentRunContextForTest } from "../infra/agent-events.js";
import {
  createAgentEventHandler,
  createChatRunState,
  createToolEventRecipientRegistry,
} from "./server-chat.js";

describe("agent event handler", () => {
  it("emits chat delta for assistant text-only events", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const broadcast = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const toolEventRecipients = createToolEventRecipientRegistry();
    chatRunState.registry.add("run-1", { sessionKey: "session-1", clientRunId: "client-1" });

    const handler = createAgentEventHandler({
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => undefined,
      clearAgentRunContext: vi.fn(),
      toolEventRecipients,
    });

    handler({
      runId: "run-1",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Hello world" },
    });

    const chatCalls = broadcast.mock.calls.filter(([event]) => event === "chat");
    expect(chatCalls).toHaveLength(1);
    const payload = chatCalls[0]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.state).toBe("delta");
    expect(payload.message?.content?.[0]?.text).toBe("Hello world");
    const sessionChatCalls = nodeSendToSession.mock.calls.filter(([, event]) => event === "chat");
    expect(sessionChatCalls).toHaveLength(1);
    nowSpy.mockRestore();
  });

  it("routes tool events only to registered recipients when verbose is enabled", () => {
    const broadcast = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const toolEventRecipients = createToolEventRecipientRegistry();

    registerAgentRunContext("run-tool", { sessionKey: "session-1", verboseLevel: "on" });
    toolEventRecipients.add("run-tool", "conn-1");

    const handler = createAgentEventHandler({
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => "session-1",
      clearAgentRunContext: vi.fn(),
      toolEventRecipients,
    });

    handler({
      runId: "run-tool",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", name: "read", toolCallId: "t1" },
    });

    const normalizedToolCalls = broadcastToConnIds.mock.calls.filter(
      ([event]) => event === "tool.state",
    );
    expect(normalizedToolCalls).toHaveLength(1);
    const legacyToolCalls = broadcastToConnIds.mock.calls.filter(([event]) => event === "agent");
    expect(legacyToolCalls).toHaveLength(1);
    resetAgentRunContextForTest();
  });

  it("broadcasts tool events to WS recipients even when verbose is off, but skips node send", () => {
    const broadcast = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const toolEventRecipients = createToolEventRecipientRegistry();

    registerAgentRunContext("run-tool-off", { sessionKey: "session-1", verboseLevel: "off" });
    toolEventRecipients.add("run-tool-off", "conn-1");

    const handler = createAgentEventHandler({
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => "session-1",
      clearAgentRunContext: vi.fn(),
      toolEventRecipients,
    });

    handler({
      runId: "run-tool-off",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", name: "read", toolCallId: "t2" },
    });

    const normalizedToolCalls = broadcastToConnIds.mock.calls.filter(
      ([event]) => event === "tool.state",
    );
    expect(normalizedToolCalls).toHaveLength(1);
    // Tool events always broadcast to registered WS recipients
    const legacyToolCalls = broadcastToConnIds.mock.calls.filter(([event]) => event === "agent");
    expect(legacyToolCalls).toHaveLength(1);
    // But node/channel subscribers should NOT receive when verbose is off
    const nodeToolCalls = nodeSendToSession.mock.calls.filter(([, event]) => event === "agent");
    expect(nodeToolCalls).toHaveLength(0);
    resetAgentRunContextForTest();
  });

  it("strips tool output when verbose is on", () => {
    const broadcast = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const toolEventRecipients = createToolEventRecipientRegistry();

    registerAgentRunContext("run-tool-on", { sessionKey: "session-1", verboseLevel: "on" });
    toolEventRecipients.add("run-tool-on", "conn-1");

    const handler = createAgentEventHandler({
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => "session-1",
      clearAgentRunContext: vi.fn(),
      toolEventRecipients,
    });

    handler({
      runId: "run-tool-on",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: {
        phase: "result",
        name: "exec",
        toolCallId: "t3",
        result: { content: [{ type: "text", text: "secret" }] },
        partialResult: { content: [{ type: "text", text: "partial" }] },
      },
    });

    const toolStateCall = broadcastToConnIds.mock.calls.find(([event]) => event === "tool.state");
    expect(toolStateCall).toBeTruthy();
    const payload = toolStateCall?.[1] as { data?: Record<string, unknown> };
    expect(payload.data?.result).toBeUndefined();
    expect(payload.data?.partialResult).toBeUndefined();
    resetAgentRunContextForTest();
  });

  it("keeps tool output when verbose is full", () => {
    const broadcast = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const toolEventRecipients = createToolEventRecipientRegistry();

    registerAgentRunContext("run-tool-full", { sessionKey: "session-1", verboseLevel: "full" });
    toolEventRecipients.add("run-tool-full", "conn-1");

    const handler = createAgentEventHandler({
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => "session-1",
      clearAgentRunContext: vi.fn(),
      toolEventRecipients,
    });

    const result = { content: [{ type: "text", text: "secret" }] };
    handler({
      runId: "run-tool-full",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: {
        phase: "result",
        name: "exec",
        toolCallId: "t4",
        result,
      },
    });

    const toolStateCall = broadcastToConnIds.mock.calls.find(([event]) => event === "tool.state");
    expect(toolStateCall).toBeTruthy();
    const payload = toolStateCall?.[1] as { data?: Record<string, unknown> };
    expect(payload.data?.result).toEqual(result);
    resetAgentRunContextForTest();
  });

  it("emits normalized start and end events with stream metrics", () => {
    const broadcast = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const toolEventRecipients = createToolEventRecipientRegistry();
    const clearAgentRunContext = vi.fn();

    const handler = createAgentEventHandler({
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => "session-1",
      clearAgentRunContext,
      toolEventRecipients,
    });

    handler({
      runId: "run-lifecycle",
      seq: 1,
      stream: "lifecycle",
      ts: 1_000,
      data: { phase: "start" },
    });
    handler({
      runId: "run-lifecycle",
      seq: 2,
      stream: "assistant",
      ts: 1_100,
      data: { text: "Hello" },
    });
    handler({
      runId: "run-lifecycle",
      seq: 3,
      stream: "tool",
      ts: 1_150,
      data: { phase: "start", name: "read", toolCallId: "t-run" },
    });
    handler({
      runId: "run-lifecycle",
      seq: 4,
      stream: "lifecycle",
      ts: 1_450,
      data: { phase: "end" },
    });

    const startCalls = broadcast.mock.calls.filter(([event]) => event === "agent.start");
    expect(startCalls).toHaveLength(1);
    const endCalls = broadcast.mock.calls.filter(([event]) => event === "agent.end");
    expect(endCalls).toHaveLength(1);
    const endPayload = endCalls[0]?.[1] as {
      status?: string;
      metrics?: {
        acceptedAtMs?: number;
        firstTokenMs?: number | null;
        totalMs?: number;
        toolCount?: number;
        executionMode?: string;
      };
    };
    expect(endPayload.status).toBe("ok");
    expect(endPayload.metrics?.acceptedAtMs).toBe(1_000);
    expect(endPayload.metrics?.firstTokenMs).toBe(100);
    expect(endPayload.metrics?.totalMs).toBe(450);
    expect(endPayload.metrics?.toolCount).toBe(1);
    expect(endPayload.metrics?.executionMode).toBe("stream");
    expect(clearAgentRunContext).toHaveBeenCalledWith("run-lifecycle");
  });
});
