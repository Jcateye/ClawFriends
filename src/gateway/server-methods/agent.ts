import { randomUUID } from "node:crypto";
import type { GatewayRequestHandlers } from "./types.js";
import { listAgentIds } from "../../agents/agent-scope.js";
import { agentCommand } from "../../commands/agent.js";
import { loadConfig } from "../../config/config.js";
import {
  resolveAgentIdFromSessionKey,
  resolveExplicitAgentSessionKey,
  resolveAgentMainSessionKey,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import {
  resolveAgentDeliveryPlan,
  resolveAgentOutboundTarget,
} from "../../infra/outbound/agent-delivery.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import { normalizeInputProvenance, type InputProvenance } from "../../sessions/input-provenance.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { normalizeSessionDeliveryFields } from "../../utils/delivery-context.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  isDeliverableMessageChannel,
  isGatewayMessageChannel,
  normalizeMessageChannel,
} from "../../utils/message-channel.js";
import { resolveAssistantIdentity } from "../assistant-identity.js";
import { parseMessageWithAttachments } from "../chat-attachments.js";
import { resolveAssistantAvatarUrl } from "../control-ui-shared.js";
import { GATEWAY_CLIENT_CAPS, hasGatewayClientCap } from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAgentExecuteParams,
  validateAgentIdentityParams,
  validateAgentParams,
  validateAgentWaitParams,
} from "../protocol/index.js";
import { isSessionKeyWithinTenantScope, loadSessionEntry } from "../session-utils.js";
import { formatForLog } from "../ws-log.js";
import { waitForAgentJob } from "./agent-job.js";
import { injectTimestamp, timestampOptsFromConfig } from "./agent-timestamp.js";

function resolveExecuteInputMessage(input: Record<string, unknown>, operation: "chat" | "run") {
  const messageRaw =
    typeof input.message === "string"
      ? input.message
      : typeof input.prompt === "string"
        ? input.prompt
        : undefined;
  const message = messageRaw?.trim();
  if (message) {
    return message;
  }
  if (operation === "run" && Object.keys(input).length > 0) {
    return JSON.stringify(input);
  }
  return "";
}

export const agentHandlers: GatewayRequestHandlers = {
  agent: async ({ params, respond, context, client }) => {
    const p = params;
    if (!validateAgentParams(p)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agent params: ${formatValidationErrors(validateAgentParams.errors)}`,
        ),
      );
      return;
    }
    const request = p as {
      message: string;
      agentId?: string;
      to?: string;
      replyTo?: string;
      sessionId?: string;
      sessionKey?: string;
      thinking?: string;
      deliver?: boolean;
      attachments?: Array<{
        type?: string;
        mimeType?: string;
        fileName?: string;
        content?: unknown;
      }>;
      channel?: string;
      replyChannel?: string;
      accountId?: string;
      replyAccountId?: string;
      threadId?: string;
      groupId?: string;
      groupChannel?: string;
      groupSpace?: string;
      lane?: string;
      extraSystemPrompt?: string;
      idempotencyKey: string;
      timeout?: number;
      label?: string;
      spawnedBy?: string;
      inputProvenance?: InputProvenance;
    };
    const cfg = loadConfig();
    const idem = request.idempotencyKey;
    const groupIdRaw = typeof request.groupId === "string" ? request.groupId.trim() : "";
    const groupChannelRaw =
      typeof request.groupChannel === "string" ? request.groupChannel.trim() : "";
    const groupSpaceRaw = typeof request.groupSpace === "string" ? request.groupSpace.trim() : "";
    let resolvedGroupId: string | undefined = groupIdRaw || undefined;
    let resolvedGroupChannel: string | undefined = groupChannelRaw || undefined;
    let resolvedGroupSpace: string | undefined = groupSpaceRaw || undefined;
    let spawnedByValue =
      typeof request.spawnedBy === "string" ? request.spawnedBy.trim() : undefined;
    const inputProvenance = normalizeInputProvenance(request.inputProvenance);
    const cached = context.dedupe.get(`agent:${idem}`);
    if (cached) {
      respond(cached.ok, cached.payload, cached.error, {
        cached: true,
      });
      return;
    }
    const normalizedAttachments =
      request.attachments
        ?.map((a) => ({
          type: typeof a?.type === "string" ? a.type : undefined,
          mimeType: typeof a?.mimeType === "string" ? a.mimeType : undefined,
          fileName: typeof a?.fileName === "string" ? a.fileName : undefined,
          content:
            typeof a?.content === "string"
              ? a.content
              : ArrayBuffer.isView(a?.content)
                ? Buffer.from(
                    a.content.buffer,
                    a.content.byteOffset,
                    a.content.byteLength,
                  ).toString("base64")
                : undefined,
        }))
        .filter((a) => a.content) ?? [];

    let message = request.message.trim();
    let images: Array<{ type: "image"; data: string; mimeType: string }> = [];
    if (normalizedAttachments.length > 0) {
      try {
        const parsed = await parseMessageWithAttachments(message, normalizedAttachments, {
          maxBytes: 5_000_000,
          log: context.logGateway,
        });
        message = parsed.message.trim();
        images = parsed.images;
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
    }

    // Inject timestamp into messages that don't already have one.
    // Channel messages (Discord, Telegram, etc.) get timestamps via envelope
    // formatting in a separate code path — they never reach this handler.
    // See: https://github.com/moltbot/moltbot/issues/3658
    message = injectTimestamp(message, timestampOptsFromConfig(cfg));

    const isKnownGatewayChannel = (value: string): boolean => isGatewayMessageChannel(value);
    const channelHints = [request.channel, request.replyChannel]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const rawChannel of channelHints) {
      const normalized = normalizeMessageChannel(rawChannel);
      if (normalized && normalized !== "last" && !isKnownGatewayChannel(normalized)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent params: unknown channel: ${String(normalized)}`,
          ),
        );
        return;
      }
    }

    const agentIdRaw = typeof request.agentId === "string" ? request.agentId.trim() : "";
    const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
    if (agentId) {
      const knownAgents = listAgentIds(cfg);
      if (!knownAgents.includes(agentId)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent params: unknown agent id "${request.agentId}"`,
          ),
        );
        return;
      }
    }

    const requestedSessionKeyRaw =
      typeof request.sessionKey === "string" && request.sessionKey.trim()
        ? request.sessionKey.trim()
        : undefined;
    const requestedSessionKey =
      requestedSessionKeyRaw ??
      resolveExplicitAgentSessionKey({
        cfg,
        agentId,
      });
    if (agentId && requestedSessionKeyRaw) {
      const sessionAgentId = resolveAgentIdFromSessionKey(requestedSessionKeyRaw);
      if (sessionAgentId !== agentId) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent params: agent "${request.agentId}" does not match session key agent "${sessionAgentId}"`,
          ),
        );
        return;
      }
    }
    let resolvedSessionId = request.sessionId?.trim() || undefined;
    let sessionEntry: SessionEntry | undefined;
    let bestEffortDeliver = false;
    let cfgForAgent: ReturnType<typeof loadConfig> | undefined;

    if (requestedSessionKey) {
      const { cfg, storePath, entry, canonicalKey } = loadSessionEntry(requestedSessionKey);
      cfgForAgent = cfg;
      const now = Date.now();
      const sessionId = entry?.sessionId ?? randomUUID();
      const labelValue = request.label?.trim() || entry?.label;
      spawnedByValue = spawnedByValue || entry?.spawnedBy;
      let inheritedGroup:
        | { groupId?: string; groupChannel?: string; groupSpace?: string }
        | undefined;
      if (spawnedByValue && (!resolvedGroupId || !resolvedGroupChannel || !resolvedGroupSpace)) {
        try {
          const parentEntry = loadSessionEntry(spawnedByValue)?.entry;
          inheritedGroup = {
            groupId: parentEntry?.groupId,
            groupChannel: parentEntry?.groupChannel,
            groupSpace: parentEntry?.space,
          };
        } catch {
          inheritedGroup = undefined;
        }
      }
      resolvedGroupId = resolvedGroupId || inheritedGroup?.groupId;
      resolvedGroupChannel = resolvedGroupChannel || inheritedGroup?.groupChannel;
      resolvedGroupSpace = resolvedGroupSpace || inheritedGroup?.groupSpace;
      const deliveryFields = normalizeSessionDeliveryFields(entry);
      const nextEntry: SessionEntry = {
        sessionId,
        updatedAt: now,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        reasoningLevel: entry?.reasoningLevel,
        systemSent: entry?.systemSent,
        sendPolicy: entry?.sendPolicy,
        skillsSnapshot: entry?.skillsSnapshot,
        deliveryContext: deliveryFields.deliveryContext,
        lastChannel: deliveryFields.lastChannel ?? entry?.lastChannel,
        lastTo: deliveryFields.lastTo ?? entry?.lastTo,
        lastAccountId: deliveryFields.lastAccountId ?? entry?.lastAccountId,
        modelOverride: entry?.modelOverride,
        providerOverride: entry?.providerOverride,
        label: labelValue,
        spawnedBy: spawnedByValue,
        channel: entry?.channel ?? request.channel?.trim(),
        groupId: resolvedGroupId ?? entry?.groupId,
        groupChannel: resolvedGroupChannel ?? entry?.groupChannel,
        space: resolvedGroupSpace ?? entry?.space,
        cliSessionIds: entry?.cliSessionIds,
        claudeCliSessionId: entry?.claudeCliSessionId,
      };
      sessionEntry = nextEntry;
      const sendPolicy = resolveSendPolicy({
        cfg,
        entry,
        sessionKey: requestedSessionKey,
        channel: entry?.channel,
        chatType: entry?.chatType,
      });
      if (sendPolicy === "deny") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "send blocked by session policy"),
        );
        return;
      }
      resolvedSessionId = sessionId;
      const canonicalSessionKey = canonicalKey;
      const agentId = resolveAgentIdFromSessionKey(canonicalSessionKey);
      const mainSessionKey = resolveAgentMainSessionKey({ cfg, agentId });
      if (storePath) {
        await updateSessionStore(storePath, (store) => {
          store[canonicalSessionKey] = nextEntry;
        });
      }
      if (canonicalSessionKey === mainSessionKey || canonicalSessionKey === "global") {
        context.addChatRun(idem, {
          sessionKey: requestedSessionKey,
          clientRunId: idem,
        });
        bestEffortDeliver = true;
      }
      registerAgentRunContext(idem, { sessionKey: requestedSessionKey });
    }

    const runId = idem;
    const connId = typeof client?.connId === "string" ? client.connId : undefined;
    const wantsToolEvents = hasGatewayClientCap(
      client?.connect?.caps,
      GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
    );
    if (connId && wantsToolEvents) {
      context.registerToolEventRecipient(runId, connId);
      // Register for any other active runs *in the same session* so
      // late-joining clients (e.g. page refresh mid-response) receive
      // in-progress tool events without leaking cross-session data.
      for (const [activeRunId, active] of context.chatAbortControllers) {
        if (activeRunId !== runId && active.sessionKey === requestedSessionKey) {
          context.registerToolEventRecipient(activeRunId, connId);
        }
      }
    }

    const wantsDelivery = request.deliver === true;
    const explicitTo =
      typeof request.replyTo === "string" && request.replyTo.trim()
        ? request.replyTo.trim()
        : typeof request.to === "string" && request.to.trim()
          ? request.to.trim()
          : undefined;
    const explicitThreadId =
      typeof request.threadId === "string" && request.threadId.trim()
        ? request.threadId.trim()
        : undefined;
    const deliveryPlan = resolveAgentDeliveryPlan({
      sessionEntry,
      requestedChannel: request.replyChannel ?? request.channel,
      explicitTo,
      explicitThreadId,
      accountId: request.replyAccountId ?? request.accountId,
      wantsDelivery,
    });

    const resolvedChannel = deliveryPlan.resolvedChannel;
    const deliveryTargetMode = deliveryPlan.deliveryTargetMode;
    const resolvedAccountId = deliveryPlan.resolvedAccountId;
    let resolvedTo = deliveryPlan.resolvedTo;

    if (!resolvedTo && isDeliverableMessageChannel(resolvedChannel)) {
      const cfgResolved = cfgForAgent ?? cfg;
      const fallback = resolveAgentOutboundTarget({
        cfg: cfgResolved,
        plan: deliveryPlan,
        targetMode: "implicit",
        validateExplicitTarget: false,
      });
      if (fallback.resolvedTarget?.ok) {
        resolvedTo = fallback.resolvedTo;
      }
    }

    const deliver = request.deliver === true && resolvedChannel !== INTERNAL_MESSAGE_CHANNEL;

    const accepted = {
      runId,
      status: "accepted" as const,
      acceptedAt: Date.now(),
    };
    // Store an in-flight ack so retries do not spawn a second run.
    context.dedupe.set(`agent:${idem}`, {
      ts: Date.now(),
      ok: true,
      payload: accepted,
    });
    respond(true, accepted, undefined, { runId });

    const resolvedThreadId = explicitThreadId ?? deliveryPlan.resolvedThreadId;

    void agentCommand(
      {
        message,
        images,
        to: resolvedTo,
        sessionId: resolvedSessionId,
        sessionKey: requestedSessionKey,
        thinking: request.thinking,
        deliver,
        deliveryTargetMode,
        channel: resolvedChannel,
        accountId: resolvedAccountId,
        threadId: resolvedThreadId,
        runContext: {
          messageChannel: resolvedChannel,
          accountId: resolvedAccountId,
          groupId: resolvedGroupId,
          groupChannel: resolvedGroupChannel,
          groupSpace: resolvedGroupSpace,
          currentThreadTs: resolvedThreadId != null ? String(resolvedThreadId) : undefined,
        },
        groupId: resolvedGroupId,
        groupChannel: resolvedGroupChannel,
        groupSpace: resolvedGroupSpace,
        spawnedBy: spawnedByValue,
        timeout: request.timeout?.toString(),
        bestEffortDeliver,
        messageChannel: resolvedChannel,
        runId,
        lane: request.lane,
        extraSystemPrompt: request.extraSystemPrompt,
        inputProvenance,
      },
      defaultRuntime,
      context.deps,
    )
      .then((result) => {
        const payload = {
          runId,
          status: "ok" as const,
          summary: "completed",
          result,
        };
        context.dedupe.set(`agent:${idem}`, {
          ts: Date.now(),
          ok: true,
          payload,
        });
        // Send a second res frame (same id) so TS clients with expectFinal can wait.
        // Swift clients will typically treat the first res as the result and ignore this.
        respond(true, payload, undefined, { runId });
      })
      .catch((err) => {
        const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
        const payload = {
          runId,
          status: "error" as const,
          summary: String(err),
        };
        context.dedupe.set(`agent:${idem}`, {
          ts: Date.now(),
          ok: false,
          payload,
          error,
        });
        respond(false, payload, error, {
          runId,
          error: formatForLog(err),
        });
      });
  },
  "agent.execute": async ({ params, respond, context, client, req }) => {
    const p = params;
    if (!validateAgentExecuteParams(p)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.EXTERNAL_INVALID_REQUEST,
          `invalid agent.execute params: ${formatValidationErrors(validateAgentExecuteParams.errors)}`,
        ),
      );
      return;
    }

    const request = p as {
      tenantId: string;
      agentScope: string;
      sessionKey: string;
      agentId: string;
      operation: "chat" | "run";
      mode?: "stream" | "unary";
      input: Record<string, unknown>;
      traceId: string;
      protocolVersion: "v1" | "v2";
      idempotencyKey: string;
      timeout?: number;
      thinking?: string;
      deliver?: boolean;
      channel?: string;
      to?: string;
    };
    const requestId = req.id;

    const sessionKey = request.sessionKey.trim();
    if (
      !isSessionKeyWithinTenantScope({
        tenantId: request.tenantId,
        agentScope: request.agentScope,
        sessionKey,
      })
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.EXTERNAL_TENANT_SCOPE_MISMATCH,
          "sessionKey is outside tenant/agent scope",
          {
            details: {
              requestId,
              tenantId: request.tenantId,
              agentScope: request.agentScope,
              sessionKey,
              traceId: request.traceId,
            },
            retryable: false,
          },
        ),
      );
      return;
    }

    const message = resolveExecuteInputMessage(request.input ?? {}, request.operation);
    if (!message) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.EXTERNAL_INVALID_REQUEST,
          "agent.execute requires input.message or input.prompt (chat) / non-empty input (run)",
          { retryable: false, details: { requestId, traceId: request.traceId } },
        ),
      );
      return;
    }

    const mode = request.mode ?? (request.operation === "run" ? "unary" : "stream");

    if (request.operation === "run" && mode === "unary") {
      const runId = request.idempotencyKey.trim();
      const cached = context.dedupe.get(`agent:${runId}`);
      if (cached) {
        respond(cached.ok, cached.payload, cached.error, { cached: true });
        return;
      }

      const cfg = loadConfig();
      const knownAgents = listAgentIds(cfg);
      const normalizedAgentId = normalizeAgentId(request.agentId.trim());
      if (!knownAgents.includes(normalizedAgentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.EXTERNAL_INVALID_REQUEST, `unknown agent id "${request.agentId}"`, {
            retryable: false,
            details: { requestId, traceId: request.traceId },
          }),
        );
        return;
      }

      const runStartedAt = Date.now();
      registerAgentRunContext(runId, { sessionKey });
      try {
        const result = await agentCommand(
          {
            message,
            sessionKey,
            agentId: normalizedAgentId,
            thinking: request.thinking,
            deliver: request.deliver === true,
            channel: request.channel,
            to: request.to,
            timeout: request.timeout?.toString(),
            runId,
            lane: "external-run",
            extraSystemPrompt:
              typeof request.input.extraSystemPrompt === "string"
                ? request.input.extraSystemPrompt
                : undefined,
          },
          defaultRuntime,
          context.deps,
        );
        const runEndedAt = Date.now();
        const payload = {
          runId,
          status: "ok" as const,
          mode,
          operation: request.operation,
          tenantId: request.tenantId,
          agentScope: request.agentScope,
          sessionKey,
          traceId: request.traceId,
          requestId,
          protocolVersion: request.protocolVersion,
          metrics: {
            acceptedAtMs: runStartedAt,
            firstTokenMs: null,
            totalMs: runEndedAt - runStartedAt,
            toolCount: null,
            executionMode: "unary",
          },
          result,
        };
        context.dedupe.set(`agent:${runId}`, {
          ts: Date.now(),
          ok: true,
          payload,
        });
        respond(true, payload, undefined, { runId });
      } catch (err) {
        const error = errorShape(
          ErrorCodes.EXTERNAL_INTERNAL_ERROR,
          String(err instanceof Error ? err.message : err),
          { retryable: true, details: { requestId, traceId: request.traceId } },
        );
        const payload = {
          runId,
          status: "error" as const,
          mode,
          operation: request.operation,
          tenantId: request.tenantId,
          agentScope: request.agentScope,
          sessionKey,
          traceId: request.traceId,
          requestId,
        };
        context.dedupe.set(`agent:${runId}`, {
          ts: Date.now(),
          ok: false,
          payload,
          error,
        });
        respond(false, payload, error, { runId, error: formatForLog(err) });
      }
      return;
    }

    const legacyParams = {
      message,
      agentId: request.agentId,
      sessionKey,
      idempotencyKey: request.idempotencyKey,
      thinking: request.thinking,
      deliver: request.deliver,
      channel: request.channel,
      to: request.to,
      timeout: request.timeout,
      lane: request.operation === "run" ? "external-run" : "external-chat",
      extraSystemPrompt:
        typeof request.input.extraSystemPrompt === "string"
          ? request.input.extraSystemPrompt
          : undefined,
    };

    await agentHandlers.agent({
      req: {
        type: "req",
        id: (Math.random() * 1_000_000_000).toFixed(0),
        method: "agent",
        params: legacyParams,
      },
      params: legacyParams,
      respond,
      context,
      client,
      isWebchatConnect: () => false,
    });
  },
  "agent.identity.get": ({ params, respond }) => {
    if (!validateAgentIdentityParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agent.identity.get params: ${formatValidationErrors(
            validateAgentIdentityParams.errors,
          )}`,
        ),
      );
      return;
    }
    const p = params;
    const agentIdRaw = typeof p.agentId === "string" ? p.agentId.trim() : "";
    const sessionKeyRaw = typeof p.sessionKey === "string" ? p.sessionKey.trim() : "";
    let agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
    if (sessionKeyRaw) {
      const resolved = resolveAgentIdFromSessionKey(sessionKeyRaw);
      if (agentId && resolved !== agentId) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent.identity.get params: agent "${agentIdRaw}" does not match session key agent "${resolved}"`,
          ),
        );
        return;
      }
      agentId = resolved;
    }
    const cfg = loadConfig();
    const identity = resolveAssistantIdentity({ cfg, agentId });
    const avatarValue =
      resolveAssistantAvatarUrl({
        avatar: identity.avatar,
        agentId: identity.agentId,
        basePath: cfg.gateway?.controlUi?.basePath,
      }) ?? identity.avatar;
    respond(true, { ...identity, avatar: avatarValue }, undefined);
  },
  "agent.wait": async ({ params, respond }) => {
    if (!validateAgentWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agent.wait params: ${formatValidationErrors(validateAgentWaitParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const runId = p.runId.trim();
    const timeoutMs =
      typeof p.timeoutMs === "number" && Number.isFinite(p.timeoutMs)
        ? Math.max(0, Math.floor(p.timeoutMs))
        : 30_000;

    const snapshot = await waitForAgentJob({
      runId,
      timeoutMs,
    });
    if (!snapshot) {
      respond(true, {
        runId,
        status: "timeout",
      });
      return;
    }
    respond(true, {
      runId,
      status: snapshot.status,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt,
      error: snapshot.error,
    });
  },
};
