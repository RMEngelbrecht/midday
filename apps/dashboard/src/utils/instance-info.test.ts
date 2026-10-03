import { describe, expect, it } from "bun:test";
import { buildInstanceInfo } from "./instance-info";

describe("buildInstanceInfo", () => {
  it("returns the configured URLs without trailing slashes", () => {
    expect(
      buildInstanceInfo({
        appUrl: "https://app.example.com/",
        apiUrl: "https://api.example.com",
        desktopScheme: "midday",
        release: "abc123",
      }),
    ).toEqual({
      appUrl: "https://app.example.com",
      apiUrl: "https://api.example.com",
      desktopScheme: "midday",
      version: "abc123",
    });
  });

  it("falls back to dev when no release is stamped", () => {
    expect(
      buildInstanceInfo({
        appUrl: "http://localhost:3001",
        apiUrl: "http://localhost:3003",
        desktopScheme: "midday",
      }).version,
    ).toBe("dev");
  });
});
