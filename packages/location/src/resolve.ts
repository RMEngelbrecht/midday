export type HeaderGetter = { get: (name: string) => string | null };

export type LocationDefaults = {
  country?: string | null;
  timezone?: string | null;
};

/**
 * Parse the primary locale from an Accept-Language header value.
 * Returns the first language tag (e.g. "en-US" from "en-US,en;q=0.9").
 */
export function parseLocale(acceptLanguage: string | null): string {
  return parsePrimaryLocale(acceptLanguage) ?? "en-US";
}

function parsePrimaryLocale(acceptLanguage: string | null | undefined) {
  const primary = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim();
  return primary && primary !== "*" ? primary : null;
}

/** ISO 3166 region of the primary Accept-Language tag ("sv-SE" -> "SE"). */
export function parseCountryFromLocale(
  acceptLanguage: string | null | undefined,
): string | null {
  const tag = parsePrimaryLocale(acceptLanguage);
  const region = tag
    ?.split("-")
    .find((part, i) => i > 0 && /^[a-z]{2}$/i.test(part));

  return region ? region.toUpperCase() : null;
}

/**
 * Resolve country, timezone and locale without depending on a CDN.
 * Cloudflare `cf-*` headers win when present; otherwise the country comes from
 * Accept-Language and country/timezone fall back to the configured defaults.
 * Values are null when nothing is known, so callers can fall back to user or
 * team settings.
 */
export function resolveGeo(
  headers: HeaderGetter,
  defaults: LocationDefaults = {},
) {
  const acceptLanguage = headers.get("accept-language");

  return {
    country:
      headers.get("cf-ipcountry") ||
      parseCountryFromLocale(acceptLanguage) ||
      defaults.country ||
      null,
    timezone: headers.get("cf-timezone") || defaults.timezone || null,
    locale: parsePrimaryLocale(acceptLanguage),
  };
}
