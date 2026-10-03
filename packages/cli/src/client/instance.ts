export interface InstanceInfo {
  appUrl: string;
  apiUrl: string;
  desktopScheme: string;
  version: string;
}

/** "midday.example.com" -> "https://midday.example.com"; local hosts default to http. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Server URL is empty");

  const hasScheme = trimmed.includes("://");
  const hostPart = (trimmed.split(/[/?#]/)[0] ?? "").replace(/^.*@/, "");
  const hostname = hostPart.replace(/:\d+$/, "");
  const local =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1";

  const url = new URL(
    hasScheme ? trimmed : `${local ? "http" : "https"}://${trimmed}`,
  );
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must start with http:// or https://");
  }
  return url.origin;
}

/** Fetch `<server>/api/instance` from the dashboard to discover the API URL. */
export async function discoverInstance(server: string): Promise<InstanceInfo> {
  const origin = normalizeServerUrl(server);
  let response: Response;
  try {
    response = await fetch(`${origin}/api/instance`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(
      `Could not reach ${origin}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `${origin} did not look like a Midday dashboard (HTTP ${response.status})`,
    );
  }

  const body = (await response.json().catch(() => null)) as Partial<
    Record<keyof InstanceInfo, unknown>
  > | null;
  if (
    !body ||
    typeof body.appUrl !== "string" ||
    typeof body.apiUrl !== "string"
  ) {
    throw new Error(`${origin} did not look like a Midday dashboard`);
  }

  return {
    appUrl: normalizeServerUrl(body.appUrl),
    apiUrl: normalizeServerUrl(body.apiUrl),
    desktopScheme: String(body.desktopScheme ?? ""),
    version: String(body.version ?? ""),
  };
}
