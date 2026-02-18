import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import {
  readJsonBodyOrError,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
  sendUnauthorized,
} from "./http-common.js";
import { getBearerToken } from "./http-utils.js";

const log = createSubsystemLogger("gateway/skills-reload");
const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;

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
    sendUnauthorized(res);
    return true;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  const payloadUnknown = await readJsonBodyOrError(
    req,
    res,
    opts.maxBodyBytes ?? DEFAULT_BODY_BYTES,
  );
  if (payloadUnknown === undefined) {
    return true;
  }
  const payload = (payloadUnknown ?? {}) as SkillsReloadBody;

  const tenantId = asNonEmptyString(payload.tenantId);
  const agentScope = asNonEmptyString(payload.agentScope);
  const desiredHash = asNonEmptyString(payload.desiredHash);
  const skills = parseSkills(payload.skills);
  if (!tenantId || !agentScope || !desiredHash || !skills) {
    sendInvalidRequest(
      res,
      "skills.reload requires tenantId, agentScope, desiredHash and skills[] with key/version/checksum",
    );
    return true;
  }

  const protocolVersion =
    typeof payload.protocolVersion === "string" && payload.protocolVersion.trim()
      ? payload.protocolVersion.trim()
      : "v1";
  if (protocolVersion !== "v1" && protocolVersion !== "v2") {
    sendInvalidRequest(res, "skills.reload protocolVersion must be v1 or v2");
    return true;
  }

  const loadActions = parseActions(payload.loadActions);
  const unloadActions = parseActions(payload.unloadActions);
  if (!loadActions || !unloadActions) {
    sendInvalidRequest(res, "skills.reload loadActions/unloadActions must be string arrays");
    return true;
  }

  const traceIdRaw = payload.traceId;
  const traceId =
    typeof traceIdRaw === "string" && traceIdRaw.trim() ? traceIdRaw.trim() : undefined;

  if (protocolVersion === "v2" && !traceId) {
    sendInvalidRequest(res, "skills.reload traceId is required for protocolVersion=v2");
    return true;
  }

  const acceptedAtMs = Date.now();
  const summary = {
    protocolVersion,
    traceId: traceId ?? null,
    skillsCount: skills.length,
    loadActions: loadActions.length,
    unloadActions: unloadActions.length,
  };

  log.info(
    `skills.reload accepted tenant=${tenantId} scope=${agentScope} desiredHash=${desiredHash} protocol=${protocolVersion} traceId=${traceId ?? "none"}`,
  );

  sendJson(res, 200, {
    ok: true,
    executionMode: "control-plane-only",
    tenantId,
    agentScope,
    desiredHash,
    acceptedAtMs,
    summary,
  });
  return true;
}
