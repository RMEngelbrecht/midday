import { ENV } from "@api/env";
import { resolveGeo } from "@midday/location/resolve";
import type { HonoRequest } from "hono";

export function getGeoContext(req: HonoRequest) {
  const headers = req.header();

  // Client-sent headers take priority, then Cloudflare geo headers when present,
  // then Accept-Language and the DEFAULT_* env. Null when nothing is known so
  // callers can fall back to user/team settings.
  const fallback = resolveGeo(
    { get: (name) => headers[name] ?? null },
    { country: ENV.DEFAULT_COUNTRY, timezone: ENV.DEFAULT_TIMEZONE },
  );
  const country = headers["x-user-country"]?.toUpperCase() ?? fallback.country;
  const locale = headers["x-user-locale"] ?? fallback.locale;
  const timezone = headers["x-user-timezone"] ?? fallback.timezone;
  const city = headers["cf-ipcity"] ?? null;
  const region = headers["cf-region"] ?? null;
  const continent = headers["cf-ipcontinent"] ?? null;
  const ip = headers["cf-connecting-ip"] ?? headers["x-forwarded-for"] ?? null;

  return {
    country,
    city,
    region,
    continent,
    locale,
    timezone,
    ip,
  };
}
