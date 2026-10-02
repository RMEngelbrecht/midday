import { describe, expect, it } from "bun:test";
import { deriveFeatures } from "@midday/features";
import { optionalProbes } from "./probes";

const names = (env: Parameters<typeof deriveFeatures>[0]) =>
  optionalProbes(deriveFeatures(env), {}).map((d) => d.name);

describe("optionalProbes", () => {
  it("probes nothing when nothing is configured", () => {
    expect(names({})).toEqual([]);
  });

  it("probes only configured banking providers", () => {
    expect(names({ PLAID_CLIENT_ID: "a", PLAID_SECRET: "b" })).toEqual([
      "plaid",
    ]);
  });
});
