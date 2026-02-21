import { beforeEach, describe, expect, it } from "vitest";
import { testState } from "./test-helpers.mocks.js";
import { installGatewayTestHooks, getFreePort, startGatewayServer } from "./test-helpers.server.js";

installGatewayTestHooks({ scope: "suite" });

beforeEach(() => {
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  delete process.env.OPENCLAW_GATEWAY_PASSWORD;
});

describe("Gateway OpenAPI/Swagger HTTP routes", () => {
  it("serves OpenAPI JSON at GET /openapi.json", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/openapi.json`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        openapi?: string;
        paths?: Record<string, unknown>;
        components?: { schemas?: Record<string, unknown> };
      };
      expect(body.openapi).toBe("3.1.0");
      expect(body.paths).toHaveProperty("/skills/reload");
      expect(body.paths).toHaveProperty("/ws");
      expect(body.components?.schemas).toHaveProperty("AgentExecuteRequest");
      expect(body.components?.schemas).toHaveProperty("AgentConfirmRequest");
    } finally {
      await server.close();
    }
  });

  it("serves Swagger UI HTML at GET /swagger", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/swagger`);
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type") ?? "";
      expect(contentType).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("SwaggerUIBundle");
      expect(html).toContain("/openapi.json");
    } finally {
      await server.close();
    }
  });

  it("returns 405 for unsupported methods on OpenAPI routes", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      const resOpenApi = await fetch(`http://127.0.0.1:${port}/openapi.json`, {
        method: "POST",
      });
      expect(resOpenApi.status).toBe(405);

      const resSwagger = await fetch(`http://127.0.0.1:${port}/swagger`, {
        method: "POST",
      });
      expect(resSwagger.status).toBe(405);
    } finally {
      await server.close();
    }
  });

  it("keeps /skills/reload auth requirements unchanged", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/skills/reload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: "tenant-1",
          agentScope: "scope-1",
          desiredHash: "hash-1",
          protocolVersion: "v2",
          traceId: "trace-1",
          skills: [{ key: "k", version: "v1", checksum: "c1" }],
          loadActions: [],
          unloadActions: [],
        }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("unauthorized");
      expect((testState.gatewayAuth as { token?: string } | undefined)?.token).toBeTruthy();
    } finally {
      await server.close();
    }
  });
});
