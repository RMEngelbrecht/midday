import { describe, expect, test } from "bun:test";
import { isPublicCorsPath } from "./cors";

describe("isPublicCorsPath", () => {
  test("OAuth discovery, token endpoints and MCP are open to any origin", () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-authorization-server",
      "/mcp",
      "/oauth/register",
      "/oauth/token",
      "/oauth/revoke",
    ]) {
      expect(isPublicCorsPath(path)).toBe(true);
    }
  });

  test("session endpoints stay limited to the dashboard", () => {
    for (const path of [
      "/oauth/authorize",
      "/trpc/user.me",
      "/api/auth/session",
      "/mcpx",
    ]) {
      expect(isPublicCorsPath(path)).toBe(false);
    }
  });
});
