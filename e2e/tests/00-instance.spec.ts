import { expect, test } from "./fixtures";
import { API_URL } from "./helpers";

test.describe("instance", () => {
  test("API is healthy and dashboard advertises the instance", async ({
    request,
  }) => {
    const health = await request.get(`${API_URL}/health/dependencies`);
    expect(health.ok()).toBeTruthy();
    const body = await health.json();
    expect(
      body.dependencies.every((d: { healthy: boolean }) => d.healthy),
    ).toBe(true);

    // Desktop app and CLI discover the API from the dashboard URL.
    const instance = await request.get("/api/instance");
    expect(instance.ok()).toBeTruthy();
    expect(await instance.json()).toMatchObject({
      apiUrl: API_URL.replace(/\/$/, ""),
    });
  });

  test("static images load without a session", async ({ request }) => {
    for (const path of ["/assets/bg-login.jpg", "/images/gmail.svg"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toMatch(/^image\//);
    }
  });

  test("unknown routes return a real 404", async ({ request }) => {
    // Signed-in request (storage state), so the proxy lets it through.
    const response = await request.get("/this/page/does/not-exist", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
  });

  test("the session cookie is shared between the API and dashboard hosts", async ({
    context,
  }) => {
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name.endsWith("session_token"));
    expect(session, "better-auth session cookie").toBeDefined();
    // Domain-wide (".lvh.me"), so the dashboard's server-side session check works.
    expect(session?.domain.startsWith(".")).toBe(true);
  });
});
