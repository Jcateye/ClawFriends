import { beforeEach, describe, expect, it } from "vitest";
import { testState } from "./test-helpers.mocks.js";
import { getFreePort, installGatewayTestHooks, startGatewayServer } from "./test-helpers.server.js";

installGatewayTestHooks({ scope: "suite" });

beforeEach(() => {
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  delete process.env.OPENCLAW_GATEWAY_PASSWORD;
});

const resolveGatewayToken = (): string => {
  const token = (testState.gatewayAuth as { token?: string } | undefined)?.token;
  if (!token) {
    throw new Error("test gateway token missing");
  }
  return token;
};

describe("POST /skills/reload", () => {
  it("returns 401 without auth token", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/skills/reload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("returns 405 for non-POST methods", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      const token = resolveGatewayToken();
      const res = await fetch(`http://127.0.0.1:${port}/skills/reload`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(405);
    } finally {
      await server.close();
    }
  });

  it("returns 400 for invalid payload", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      const token = resolveGatewayToken();
      const res = await fetch(`http://127.0.0.1:${port}/skills/reload`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenantId: "tenant-1",
        }),
      });
      expect(res.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("returns 200 with control-plane-only response for valid v2 payload", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      const token = resolveGatewayToken();
      const desiredHash = "hash-123";
      const res = await fetch(`http://127.0.0.1:${port}/skills/reload`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenantId: "tenant-1",
          agentScope: "agent-1",
          desiredHash,
          protocolVersion: "v2",
          traceId: "trace-1",
          skills: [
            {
              key: "contact_insight",
              version: "v1",
              checksum: "checksum-v1",
              exportPath: "/tmp/contact_insight/v1.json",
            },
          ],
          loadActions: ["load:contact_insight@v1"],
          unloadActions: [],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        executionMode: string;
        tenantId: string;
        agentScope: string;
        desiredHash: string;
        acceptedAtMs: number;
      };
      expect(body.ok).toBe(true);
      expect(body.executionMode).toBe("control-plane-only");
      expect(body.tenantId).toBe("tenant-1");
      expect(body.agentScope).toBe("agent-1");
      expect(body.desiredHash).toBe(desiredHash);
      expect(typeof body.acceptedAtMs).toBe("number");
    } finally {
      await server.close();
    }
  });
});
