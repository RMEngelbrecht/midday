import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { discoverInstance, normalizeServerUrl } from "./instance";

describe("normalizeServerUrl", () => {
  test("adds a scheme and strips paths", () => {
    expect(normalizeServerUrl("midday.example.com")).toBe(
      "https://midday.example.com",
    );
    expect(normalizeServerUrl("localhost:3550/")).toBe("http://localhost:3550");
    expect(normalizeServerUrl("https://a.example.com/dash?x=1")).toBe(
      "https://a.example.com",
    );
  });

  test("rejects empty and non-http input", () => {
    expect(() => normalizeServerUrl(" ")).toThrow();
    expect(() => normalizeServerUrl("ftp://x.com")).toThrow();
  });
});

describe("discoverInstance", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/api/instance") {
          return Response.json({
            appUrl: "https://app.example.com/",
            apiUrl: "https://api.example.com",
            desktopScheme: "midday",
            version: "1.2.3",
          });
        }
        return new Response("nope", { status: 404 });
      },
    });
  });
  afterAll(() => server.stop(true));

  test("reads and normalizes the instance document", async () => {
    expect(await discoverInstance(`http://localhost:${server.port}`)).toEqual({
      appUrl: "https://app.example.com",
      apiUrl: "https://api.example.com",
      desktopScheme: "midday",
      version: "1.2.3",
    });
  });

  test("fails clearly for a server without the endpoint", async () => {
    const dead = Bun.serve({
      port: 0,
      fetch: () => new Response("x", { status: 404 }),
    });
    await expect(
      discoverInstance(`http://localhost:${dead.port}`),
    ).rejects.toThrow("did not look like a Midday dashboard");
    dead.stop(true);
  });
});
