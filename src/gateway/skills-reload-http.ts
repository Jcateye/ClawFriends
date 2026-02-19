import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import { readJsonBody } from "./hooks.js";
import { sendJson } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";

const log = createSubsystemLogger("gateway/skills-reload");
const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

type SkillsReloadErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "tenant_scope_mismatch"
  | "protocol_version_unsupported"
  | "tool_confirmation_required"
  | "upstream_timeout"
  | "rate_limited"
  | "internal_error";

type SkillsReloadSkill = {
  key: string;
  version: string;
  checksum: string;
  exportPath?: string;
};

type SkillsReloadBody = {
  tenantId?: unknown;
  agentScope?: unknown;
  desiredHash?: unknown;
  skills?: unknown;
  loadActions?: unknown;
  unloadActions?: unknown;
  traceId?: unknown;
  protocolVersion?: unknown;
};

type SkillsReloadOkResponse = {
  ok: true;
  executionMode: "control-plane-only";
  tenantId: string;
  agentScope: string;
  desiredHash: string;
  acceptedAtMs: number;
  requestId: string;
  summary: {
    protocolVersion: "v1" | "v2";
    traceId: string | null;
    skillsCount: number;
    loadActions: number;
    unloadActions: number;
  };
};

const idempotencyCache = new Map<
  string,
  {
    cachedAtMs: number;
    response: SkillsReloadOkResponse;
  }
>();

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseSkills(value: unknown): SkillsReloadSkill[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const parsed: SkillsReloadSkill[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") {
      return null;
    }
    const item = row as Record<string, unknown>;
    const key = asNonEmptyString(item.key);
    const version = asNonEmptyString(item.version);
    const checksum = asNonEmptyString(item.checksum);
    if (!key || !version || !checksum) {
      return null;
    }
    parsed.push({
      key,
      version,
      checksum,
      exportPath: typeof item.exportPath === "string" ? item.exportPath : undefined,
    });
  }
  return parsed;
}

function parseActions(value: unknown): string[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parsed: string[] = [];
  for (const row of value) {
    const action = asNonEmptyString(row);
    if (!action) {
      return null;
    }
    parsed.push(action);
  }
  return parsed;
}

function makeRequestId() {
  return randomUUID();
}

function sendSkillsReloadError(params: {
  res: ServerResponse;
  status: number;
  code: SkillsReloadErrorCode;
  message: string;
  requestId: string;
  retryable?: boolean;
  traceId?: string;
}) {
  sendJson(params.res, params.status, {
    ok: false,
    code: params.code,
    message: params.message,
    retryable: params.retryable ?? false,
    traceId: params.traceId ?? null,
    requestId: params.requestId,
  });
}

function pruneIdempotencyCache(nowMs: number) {
  for (const [key, entry] of idempotencyCache.entries()) {
    if (nowMs - entry.cachedAtMs > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}

function buildIdempotencyKey(params: {
  tenantId: string;
  agentScope: string;
  desiredHash: string;
  protocolVersion: "v1" | "v2";
}) {
  return `${params.tenantId}::${params.agentScope}::${params.desiredHash}::${params.protocolVersion}`;
}

export async function handleSkillsReloadHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { auth: ResolvedGatewayAuth; maxBodyBytes?: number; trustedProxies?: string[] },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/skills/reload") {
    return false;
  }

  const cfg = loadConfig();
  const token = getBearerToken(req);
  const authResult = await authorizeGatewayConnect({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
  });
  if (!authResult.ok) {
    sendSkillsReloadError({
      res,
      status: 401,
      code: "unauthorized",
      message: "Unauthorized",
      requestId: makeRequestId(),
    });
    return true;
  }

  if (req.method !== "POST") {
    sendSkillsReloadError({
      res,
      status: 405,
      code: "invalid_request",
      message: "skills.reload requires POST",
      requestId: makeRequestId(),
    });
    return true;
  }

  const body = await readJsonBody(req, opts.maxBodyBytes ?? DEFAULT_BODY_BYTES);
  if (!body.ok) {
    sendSkillsReloadError({
      res,
      status: body.error === "payload too large" ? 413 : 400,
      code: "invalid_request",
      message: body.error,
      requestId: makeRequestId(),
    });
    return true;
  }
  const payload = (body.value ?? {}) as SkillsReloadBody;

  const tenantId = asNonEmptyString(payload.tenantId);
  const agentScope = asNonEmptyString(payload.agentScope);
  const desiredHash = asNonEmptyString(payload.desiredHash);
  const skills = parseSkills(payload.skills);
  if (!tenantId || !agentScope || !desiredHash || !skills) {
    sendSkillsReloadError({
      res,
      status: 400,
      code: "invalid_request",
      message:
        "skills.reload requires tenantId, agentScope, desiredHash and skills[] with key/version/checksum",
      requestId: makeRequestId(),
    });
    return true;
  }

  const protocolVersion =
    typeof payload.protocolVersion === "string" && payload.protocolVersion.trim()
      ? payload.protocolVersion.trim()
      : "v1";
  if (protocolVersion !== "v1" && protocolVersion !== "v2") {
    sendSkillsReloadError({
      res,
      status: 400,
      code: "protocol_version_unsupported",
      message: "skills.reload protocolVersion must be v1 or v2",
      requestId: makeRequestId(),
    });
    return true;
  }

  const loadActions = parseActions(payload.loadActions);
  const unloadActions = parseActions(payload.unloadActions);
  if (!loadActions || !unloadActions) {
    sendSkillsReloadError({
      res,
      status: 400,
      code: "invalid_request",
      message: "skills.reload loadActions/unloadActions must be string arrays",
      requestId: makeRequestId(),
    });
    return true;
  }

  const traceIdRaw = payload.traceId;
  const traceId =
    typeof traceIdRaw === "string" && traceIdRaw.trim() ? traceIdRaw.trim() : undefined;

  if (
    protocolVersion === "v2" &&
    (payload.loadActions === undefined || payload.unloadActions === undefined)
  ) {
    sendSkillsReloadError({
      res,
      status: 400,
      code: "invalid_request",
      message: "skills.reload loadActions/unloadActions are required for protocolVersion=v2",
      requestId: makeRequestId(),
      traceId,
    });
    return true;
  }

  if (protocolVersion === "v2" && !traceId) {
    sendSkillsReloadError({
      res,
      status: 400,
      code: "invalid_request",
      message: "skills.reload traceId is required for protocolVersion=v2",
      requestId: makeRequestId(),
    });
    return true;
  }

  const resolvedProtocolVersion = protocolVersion as "v1" | "v2";
  const idempotencyKey = buildIdempotencyKey({
    tenantId,
    agentScope,
    desiredHash,
    protocolVersion: resolvedProtocolVersion,
  });

  const nowMs = Date.now();
  pruneIdempotencyCache(nowMs);
  const cached = idempotencyCache.get(idempotencyKey);
  if (cached) {
    sendJson(res, 200, cached.response);
    return true;
  }

  const requestId = makeRequestId();
  const acceptedAtMs = nowMs;
  const summary: SkillsReloadOkResponse["summary"] = {
    protocolVersion: resolvedProtocolVersion,
    traceId: traceId ?? null,
    skillsCount: skills.length,
    loadActions: loadActions.length,
    unloadActions: unloadActions.length,
  };

  log.info(
    `skills.reload accepted tenant=${tenantId} scope=${agentScope} desiredHash=${desiredHash} protocol=${protocolVersion} traceId=${traceId ?? "none"}`,
  );

  const response: SkillsReloadOkResponse = {
    ok: true,
    executionMode: "control-plane-only",
    tenantId,
    agentScope,
    desiredHash,
    acceptedAtMs,
    requestId,
    summary,
  };

  idempotencyCache.set(idempotencyKey, { cachedAtMs: nowMs, response });
  sendJson(res, 200, response);
  return true;
}
