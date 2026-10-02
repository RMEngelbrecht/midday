import { getClientPublicConfig } from "@/components/public-config-provider";

function getConfiguredToken() {
  try {
    return getClientPublicConfig().logoDevToken;
  } catch {
    return null;
  }
}

/**
 * logo.dev URL for a website, or "" when LOGO_DEV_TOKEN is not configured (the
 * avatar then falls back to initials). Server code without PublicConfig passes
 * the token explicitly.
 */
export function getWebsiteLogo(
  website?: string | null,
  token: string | null | undefined = getConfiguredToken(),
) {
  if (!website || !token) return "";

  return `https://img.logo.dev/${website}?token=${token}&size=180&retina=true`;
}
