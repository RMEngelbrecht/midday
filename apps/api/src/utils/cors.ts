/**
 * Endpoints MCP clients call from other origins with bearer tokens: OAuth
 * discovery, registration, token exchange and revocation, and MCP itself.
 * /oauth/authorize is not one of them; it uses the dashboard session.
 */
export function isPublicCorsPath(path: string): boolean {
  return (
    path.startsWith("/.well-known/") ||
    path === "/mcp" ||
    path.startsWith("/mcp/") ||
    path === "/oauth/register" ||
    path === "/oauth/token" ||
    path === "/oauth/revoke"
  );
}
