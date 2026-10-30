import { describe, expect, it } from "bun:test";
import { isAllowedDcrRedirectUri } from "./oauth-redirect";

describe("isAllowedDcrRedirectUri", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:3334/oauth/callback",
    "http://127.0.0.1:9999/callback",
    "http://[::1]:9999/callback",
    "cursor://anysphere.cursor-retrieval/oauth/callback",
  ])("allows %s", (uri) => {
    expect(isAllowedDcrRedirectUri(uri)).toBe(true);
  });

  it.each([
    "http://example.com/callback",
    "http://localhost.evil.com/callback",
    "http://127.0.0.1.evil.com/callback",
    "http://localhost@evil.com/callback",
    "not a url",
  ])("rejects %s", (uri) => {
    expect(isAllowedDcrRedirectUri(uri)).toBe(false);
  });
});
