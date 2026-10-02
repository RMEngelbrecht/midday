import { describe, expect, it } from "bun:test";
import { parseCountryFromLocale, resolveGeo } from "./resolve";

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

describe("resolveGeo", () => {
  it("prefers cf-* headers when present", () => {
    expect(
      resolveGeo(
        h({
          "cf-ipcountry": "DE",
          "cf-timezone": "Europe/Berlin",
          "accept-language": "sv-SE",
        }),
        { country: "US", timezone: "America/New_York" },
      ),
    ).toEqual({ country: "DE", timezone: "Europe/Berlin", locale: "sv-SE" });
  });

  it("derives country and locale from Accept-Language without cf-*", () => {
    const geo = resolveGeo(h({ "accept-language": "sv-SE,sv;q=0.9" }));
    expect(geo.country).toBe("SE");
    expect(geo.locale).toBe("sv-SE");
    expect(geo.timezone).toBeNull();
  });

  it("falls back to configured defaults, then null", () => {
    expect(
      resolveGeo(h({ "accept-language": "en" }), {
        country: "US",
        timezone: "America/Chicago",
      }),
    ).toEqual({ country: "US", timezone: "America/Chicago", locale: "en" });
    expect(resolveGeo(h({}))).toEqual({
      country: null,
      timezone: null,
      locale: null,
    });
  });

  it("parses regions", () => {
    expect(parseCountryFromLocale("zh-Hant-TW")).toBe("TW");
    expect(parseCountryFromLocale("en")).toBeNull();
  });
});
