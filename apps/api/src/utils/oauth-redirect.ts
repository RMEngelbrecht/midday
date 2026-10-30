const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Redirect URIs allowed for dynamically registered OAuth clients: HTTPS,
 * http on a loopback address (RFC 8252 native apps, including MCP clients) or
 * a custom app scheme. Compares the parsed hostname, because a prefix check
 * would also accept hosts like localhost.example.com.
 */
export function isAllowedDcrRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }

  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return url.protocol === "https:" || /^[a-z][a-z0-9+.-]*:\/\//i.test(uri);
}
