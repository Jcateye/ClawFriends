import type { ErrorShape } from "./types.js";

export const ErrorCodes = {
  NOT_LINKED: "NOT_LINKED",
  NOT_PAIRED: "NOT_PAIRED",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAVAILABLE: "UNAVAILABLE",
  // External contract (snake_case) for platform-facing APIs.
  EXTERNAL_INVALID_REQUEST: "invalid_request",
  EXTERNAL_UNAUTHORIZED: "unauthorized",
  EXTERNAL_FORBIDDEN: "forbidden",
  EXTERNAL_TENANT_SCOPE_MISMATCH: "tenant_scope_mismatch",
  EXTERNAL_PROTOCOL_VERSION_UNSUPPORTED: "protocol_version_unsupported",
  EXTERNAL_TOOL_CONFIRMATION_REQUIRED: "tool_confirmation_required",
  EXTERNAL_UPSTREAM_TIMEOUT: "upstream_timeout",
  EXTERNAL_RATE_LIMITED: "rate_limited",
  EXTERNAL_INTERNAL_ERROR: "internal_error",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function errorShape(
  code: ErrorCode,
  message: string,
  opts?: { details?: unknown; retryable?: boolean; retryAfterMs?: number },
): ErrorShape {
  return {
    code,
    message,
    ...opts,
  };
}
