import { describe, expect, it } from "bun:test";
import { createTracker } from "./server";

describe("createTracker", () => {
  it("is a no-op and never creates a client without OPENPANEL_* keys", () => {
    let created = 0;
    const tracker = createTracker({ APP_ENV: "production" }, () => {
      created++;
      throw new Error("must not be created");
    });

    expect(() => tracker.track({ event: "x" })).not.toThrow();
    expect(created).toBe(0);
  });

  it("is a no-op with only one of the keys", () => {
    const tracker = createTracker(
      { APP_ENV: "production", OPENPANEL_CLIENT_ID: "id" },
      () => {
        throw new Error("must not be created");
      },
    );

    expect(() => tracker.track({ event: "x" })).not.toThrow();
  });

  it("sends events in production when configured", () => {
    const sent: string[] = [];
    const tracker = createTracker(
      {
        APP_ENV: "production",
        OPENPANEL_CLIENT_ID: "id",
        OPENPANEL_SECRET_KEY: "secret",
      },
      () => ({
        track: (event: string) => {
          sent.push(event);
          return Promise.resolve();
        },
      }),
    );

    tracker.track({ event: "hello" });
    expect(sent).toEqual(["hello"]);
  });
});
