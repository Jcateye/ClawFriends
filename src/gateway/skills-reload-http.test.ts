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
  it("returns structured unauthorized error without auth token", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/skills/reload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as {
        ok: boolean;
        code: string;
        message: string;
        retryable: boolean;
        traceId: string | null;
        requestId: string;
      };
      expect(body.ok).toBe(false);
      expect(body.code).toBe("unauthorized");
      expect(body.retryable).toBe(false);
      expect(body.traceId).toBeNull();
      expect(typeof body.requestId).toBe("string");
      expect(body.requestId.length).toBeGreaterThan(0);
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
      const body = (await res.json()) as {
        ok: boolean;
        code: string;
        requestId: string;
      };
      expect(body.ok).toBe(false);
      expect(body.code).toBe("invalid_request");
      expect(typeof body.requestId).toBe("string");
    } finally {
      await server.close();
    }
  });

  it("returns 400 when v2 omits loadActions/unloadActions", async () => {
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
          agentScope: "agent-1",
          desiredHash: "hash-123",
          protocolVersion: "v2",
          traceId: "trace-1",
          skills: [{ key: "k", version: "v1", checksum: "c1" }],
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe("invalid_request");
      expect(body.message).toContain("loadActions/unloadActions are required");
    } finally {
      await server.close();
    }
  });

  it("returns 400 with protocol_version_unsupported for bad protocol", async () => {
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
          agentScope: "agent-1",
          desiredHash: "hash-123",
          protocolVersion: "v3",
          skills: [{ key: "k", version: "v1", checksum: "c1" }],
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("protocol_version_unsupported");
    } finally {
      await server.close();
    }
  });

  it("keeps v1 backwards compatible when load/unload actions are omitted", async () => {
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
          agentScope: "agent-1",
          desiredHash: "hash-v1",
          protocolVersion: "v1",
          skills: [{ key: "k", version: "v1", checksum: "c1" }],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; summary: { protocolVersion: string } };
      expect(body.ok).toBe(true);
      expect(body.summary.protocolVersion).toBe("v1");
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
        requestId: string;
      };
      expect(body.ok).toBe(true);
      expect(body.executionMode).toBe("control-plane-only");
      expect(body.tenantId).toBe("tenant-1");
      expect(body.agentScope).toBe("agent-1");
      expect(body.desiredHash).toBe(desiredHash);
      expect(typeof body.acceptedAtMs).toBe("number");
      expect(typeof body.requestId).toBe("string");
    } finally {
      await server.close();
    }
  });

  it("is idempotent for repeated key and returns identical requestId/acceptedAtMs", async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      const token = resolveGatewayToken();
      const payload = {
        tenantId: "tenant-idempotent",
        agentScope: "agent-idempotent",
        desiredHash: "hash-idempotent",
        protocolVersion: "v2",
        traceId: "trace-idempotent",
        skills: [
          {
            key: "contact_insight",
            version: "v1",
            checksum: "checksum-v1",
          },
        ],
        loadActions: ["load:contact_insight@v1"],
        unloadActions: [],
      };
      const firstRes = await fetch(`http://127.0.0.1:${port}/skills/reload`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      expect(firstRes.status).toBe(200);
      const firstBody = (await firstRes.json()) as {
        requestId: string;
        acceptedAtMs: number;
      };

      const secondRes = await fetch(`http://127.0.0.1:${port}/skills/reload`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      expect(secondRes.status).toBe(200);
      const secondBody = (await secondRes.json()) as {
        requestId: string;
        acceptedAtMs: number;
      };
      expect(secondBody.requestId).toBe(firstBody.requestId);
      expect(secondBody.acceptedAtMs).toBe(firstBody.acceptedAtMs);
    } finally {
      await server.close();
    }
  });
});
