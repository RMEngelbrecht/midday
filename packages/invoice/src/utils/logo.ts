import { getApiUrl } from "@midday/utils/envs";

/**
 * Allowed hosts for logo URLs.
 * Prevents SSRF by only allowing trusted domains.
 */
const ALLOWED_LOGO_HOSTS = new Set([
  "img.logo.dev", // Used for customer website logos
]);

function isAllowedLogoHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  // Logos uploaded to this instance are served from API_URL.
  return (
    ALLOWED_LOGO_HOSTS.has(lower) || lower === new URL(getApiUrl()).hostname
  );
}

export async function isValidLogoUrl(url: string): Promise<boolean> {
  if (!url) return false;

  try {
    const parsed = new URL(url);

    // SSRF protection: only allow trusted hosts
    if (!isAllowedLogoHost(parsed.hostname)) {
      return false;
    }

    // Use HEAD to avoid fetching body, with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}
