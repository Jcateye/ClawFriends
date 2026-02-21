import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, sendMethodNotAllowed } from "./http-common.js";

const SWAGGER_UI_DIST_CDN = "https://unpkg.com/swagger-ui-dist@5";

type JsonSchema = Record<string, unknown>;

function resolveGatewayOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? "localhost";
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string" && forwardedProto.trim()
      ? forwardedProto.split(",")[0]?.trim()
      : undefined;
  const scheme = proto === "https" ? "https" : "http";
  return `${scheme}://${host}`;
}

/**
 * External contract schema for `agent.execute` over Gateway WS.
 *
 * Note: OpenAPI does not model WS RPC methods natively, so this schema is
 * referenced from `/ws` via `x-openclaw-websocket.methods`.
 */
const AgentExecuteRequestSchema: JsonSchema = {
  type: "object",
  required: [
    "tenantId",
    "agentScope",
    "sessionKey",
    "agentId",
    "operation",
    "input",
    "traceId",
    "protocolVersion",
    "idempotencyKey",
  ],
  properties: {
    tenantId: {
      type: "string",
      description: "External tenant identifier.",
      example: "tenant-acme",
    },
    agentScope: {
      type: "string",
      description: "Per-tenant logical agent scope.",
      example: "butler",
    },
    sessionKey: {
      type: "string",
      description:
        "Scoped session key. Preferred format: tenant:<tenantId>:scope:<agentScope>:<channel>.",
      example: "tenant:tenant-acme:scope:butler:contact:zhangsan",
    },
    agentId: {
      type: "string",
      description: "OpenClaw internal agent id.",
      example: "main",
    },
    operation: {
      type: "string",
      enum: ["chat", "run"],
      description: "Execution mode. chat=conversation, run=task-style execution.",
    },
    mode: {
      type: "string",
      enum: ["stream", "unary"],
      description: "Optional transport mode. run defaults to unary, chat defaults to stream.",
    },
    input: {
      type: "object",
      additionalProperties: true,
      description: "Input payload. Common fields: input.message or input.prompt.",
      example: {
        message: "帮我总结这个联系人最近沟通重点",
      },
    },
    traceId: {
      type: "string",
      description: "End-to-end trace id from caller.",
      example: "trace-2026-02-19-001",
    },
    protocolVersion: {
      type: "string",
      enum: ["v1", "v2"],
      description: "External contract version.",
      example: "v2",
    },
    idempotencyKey: {
      type: "string",
      description: "Deduplication key for caller retries.",
      example: "idem-chat-001",
    },
    timeout: {
      type: "integer",
      minimum: 0,
      description: "Optional timeout in seconds.",
      example: 90,
    },
    thinking: {
      type: "string",
      description: "Optional reasoning profile override.",
      example: "low",
    },
    deliver: {
      type: "boolean",
      description: "Whether to deliver response to external channel integration.",
      example: false,
    },
    channel: {
      type: "string",
      description: "Optional outbound channel.",
      example: "webchat",
    },
    to: {
      type: "string",
      description: "Optional outbound recipient.",
      example: "user_123",
    },
  },
  additionalProperties: false,
};

/**
 * External contract schema for `agent.confirm` over Gateway WS.
 */
const AgentConfirmRequestSchema: JsonSchema = {
  type: "object",
  required: ["confirmationId", "approved", "traceId"],
  properties: {
    confirmationId: {
      type: "string",
      description: "Identifier from tool.state.awaiting_input event.",
      example: "approval_8f92b1",
    },
    approved: {
      type: "boolean",
      description: "true=allow-once, false=deny.",
      example: true,
    },
    traceId: {
      type: "string",
      description: "Caller-provided trace id.",
      example: "trace-2026-02-19-approve-001",
    },
  },
  additionalProperties: false,
};

function buildOpenApiDocument(origin: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "OpenClaw Gateway External Contract",
      version: "v2",
      description:
        "External integration surface for control plane and agent execution. Includes HTTP and WebSocket RPC contract notes.",
    },
    servers: [
      {
        url: origin,
        description: "Current gateway endpoint",
      },
    ],
    tags: [
      {
        name: "control-plane",
        description: "Control plane APIs for skills and runtime governance.",
      },
      {
        name: "agent-execution",
        description: "External agent execution contract over Gateway WebSocket RPC.",
      },
    ],
    paths: {
      "/skills/reload": {
        post: {
          tags: ["control-plane"],
          summary: "Reload skill plan for tenant scope",
          description:
            "External control-plane endpoint. v2 requires traceId, loadActions and unloadActions.",
          operationId: "skillsReload",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SkillsReloadRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Accepted (idempotent).",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SkillsReloadSuccess" },
                },
              },
            },
            "400": {
              description: "Invalid request or unsupported protocol.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ExternalErrorResponse" },
                },
              },
            },
            "401": {
              description: "Unauthorized.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ExternalErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/ws": {
        get: {
          tags: ["agent-execution"],
          summary: "Gateway WebSocket RPC endpoint",
          description:
            "Use WebSocket framing (`req/res/event`) and invoke methods `agent.execute` and `agent.confirm`.",
          operationId: "gatewayWebSocket",
          security: [{ BearerAuth: [] }],
          responses: {
            "101": {
              description: "Switching Protocols",
            },
          },
          "x-openclaw-websocket": {
            protocol: "json-rpc-like over WebSocket frames",
            methods: {
              "agent.execute": {
                request: { $ref: "#/components/schemas/AgentExecuteRequest" },
                lifecycleEvents: [
                  "agent.start",
                  "agent.delta",
                  "agent.message",
                  "tool.state",
                  "context.patch",
                  "agent.end",
                  "error",
                ],
                notes: [
                  "chat defaults to stream mode",
                  "run defaults to unary mode",
                  "sessionKey must match tenant scope contract",
                ],
              },
              "agent.confirm": {
                request: { $ref: "#/components/schemas/AgentConfirmRequest" },
                notes: [
                  "Use confirmationId from tool.state.awaiting_input",
                  "approved=true maps to allow-once, false maps to deny",
                ],
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "OpenClaw gateway token",
        },
      },
      schemas: {
        SkillsReloadRequest: {
          type: "object",
          required: [
            "tenantId",
            "agentScope",
            "desiredHash",
            "skills",
            "protocolVersion",
            "traceId",
            "loadActions",
            "unloadActions",
          ],
          properties: {
            tenantId: { type: "string", example: "tenant-acme" },
            agentScope: { type: "string", example: "butler" },
            desiredHash: {
              type: "string",
              description: "Desired skill plan hash.",
              example: "sha256:8f4b...",
            },
            protocolVersion: {
              type: "string",
              enum: ["v1", "v2"],
              example: "v2",
            },
            traceId: { type: "string", example: "trace-2026-02-19-001" },
            skills: {
              type: "array",
              items: {
                type: "object",
                required: ["key", "version", "checksum"],
                properties: {
                  key: { type: "string", example: "contact_memory" },
                  version: { type: "string", example: "v1" },
                  checksum: { type: "string", example: "sha256:ab12..." },
                  exportPath: { type: "string", example: "extensions/contact_memory" },
                },
                additionalProperties: false,
              },
            },
            loadActions: {
              type: "array",
              items: { type: "string" },
              example: ["load:contact_memory@v1"],
            },
            unloadActions: {
              type: "array",
              items: { type: "string" },
              example: ["unload:legacy_contact_memory@v0"],
            },
          },
          additionalProperties: false,
        },
        SkillsReloadSuccess: {
          type: "object",
          required: [
            "ok",
            "executionMode",
            "tenantId",
            "agentScope",
            "desiredHash",
            "acceptedAtMs",
            "requestId",
            "summary",
          ],
          properties: {
            ok: { type: "boolean", const: true },
            executionMode: { type: "string", const: "control-plane-only" },
            tenantId: { type: "string" },
            agentScope: { type: "string" },
            desiredHash: { type: "string" },
            acceptedAtMs: { type: "number" },
            requestId: { type: "string" },
            summary: {
              type: "object",
              required: [
                "protocolVersion",
                "traceId",
                "skillsCount",
                "loadActions",
                "unloadActions",
              ],
              properties: {
                protocolVersion: { type: "string", enum: ["v1", "v2"] },
                traceId: { type: ["string", "null"] },
                skillsCount: { type: "integer" },
                loadActions: { type: "integer" },
                unloadActions: { type: "integer" },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        ExternalErrorResponse: {
          type: "object",
          required: ["ok", "code", "message", "retryable", "traceId", "requestId"],
          properties: {
            ok: { type: "boolean", const: false },
            code: {
              type: "string",
              enum: [
                "invalid_request",
                "unauthorized",
                "forbidden",
                "tenant_scope_mismatch",
                "protocol_version_unsupported",
                "tool_confirmation_required",
                "upstream_timeout",
                "rate_limited",
                "internal_error",
              ],
            },
            message: { type: "string" },
            retryable: { type: "boolean" },
            traceId: { type: ["string", "null"] },
            requestId: { type: "string" },
          },
          additionalProperties: false,
        },
        AgentExecuteRequest: AgentExecuteRequestSchema,
        AgentConfirmRequest: AgentConfirmRequestSchema,
      },
    },
    externalDocs: {
      description: "Gateway protocol and runbook",
      url: "https://docs.openclaw.ai/gateway/protocol",
    },
  };
}

function renderSwaggerUiHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenClaw Gateway API Docs</title>
    <link rel="stylesheet" href="${SWAGGER_UI_DIST_CDN}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI_DIST_CDN}/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        displayRequestDuration: true,
      });
    </script>
  </body>
</html>`;
}

export async function handleOpenApiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/openapi.json") {
    if (req.method !== "GET") {
      sendMethodNotAllowed(res, "GET");
      return true;
    }
    sendJson(res, 200, buildOpenApiDocument(resolveGatewayOrigin(req)));
    return true;
  }

  if (url.pathname === "/swagger" || url.pathname === "/swagger/") {
    if (req.method !== "GET") {
      sendMethodNotAllowed(res, "GET");
      return true;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(renderSwaggerUiHtml());
    return true;
  }

  return false;
}
