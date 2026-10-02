import { headers } from "next/headers";
import flags from "./country-flags";
import { currencies } from "./currencies";
import { ENV } from "./env";
import {
  type HeaderGetter,
  type LocationDefaults,
  parseLocale,
  resolveGeo,
} from "./resolve";
import timezones from "./timezones.json";

export { parseLocale } from "./resolve";

const FALLBACK_COUNTRY = "SE";
const FALLBACK_TIMEZONE = "Europe/Berlin";

/**
 * Extract all location values from a resolved headers object.
 * Cloudflare headers are used when present, otherwise Accept-Language and the
 * DEFAULT_COUNTRY / DEFAULT_TIMEZONE env defaults.
 */
export function getLocationHeaders(
  headersList: HeaderGetter,
  defaults: LocationDefaults = {
    country: ENV.DEFAULT_COUNTRY,
    timezone: ENV.DEFAULT_TIMEZONE,
  },
): {
  country: string;
  timezone: string;
  locale: string;
} {
  const geo = resolveGeo(headersList, defaults);

  return {
    country: geo.country || FALLBACK_COUNTRY,
    timezone: geo.timezone || FALLBACK_TIMEZONE,
    locale: parseLocale(headersList.get("accept-language")),
  };
}

export async function getCountryCode() {
  return getLocationHeaders(await headers()).country;
}

export async function getTimezone() {
  return getLocationHeaders(await headers()).timezone;
}

export async function getLocale() {
  return getLocationHeaders(await headers()).locale;
}

export function getTimezones() {
  return timezones;
}
export async function getCurrency() {
  const countryCode = await getCountryCode();

  return currencies[countryCode as keyof typeof currencies];
}

export async function getDateFormat() {
  const country = await getCountryCode();

  // US uses MM/dd/yyyy
  if (country === "US") {
    return "MM/dd/yyyy";
  }

  // China, Japan, Korea, Taiwan use yyyy-MM-dd
  if (["CN", "JP", "KR", "TW"].includes(country)) {
    return "yyyy-MM-dd";
  }
  // Most Latin American, African, and some Asian countries use dd/MM/yyyy
  if (["AU", "NZ", "IN", "ZA", "BR", "AR"].includes(country)) {
    return "dd/MM/yyyy";
  }

  // Default to yyyy-MM-dd for other countries
  return "yyyy-MM-dd";
}

export async function getCountry() {
  const country = await getCountryCode();

  // Type guard to ensure country is a key of flags
  if (country && Object.hasOwn(flags, country)) {
    return flags[country as keyof typeof flags];
  }

  return undefined;
}
