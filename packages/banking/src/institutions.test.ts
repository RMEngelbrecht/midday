import { describe, expect, it } from "bun:test";
import { fetchAllInstitutions } from "./institutions";

describe("fetchAllInstitutions", () => {
  it("does not construct or call any provider when none are enabled", async () => {
    expect(await fetchAllInstitutions([])).toEqual({
      institutions: [],
      errors: [],
      succeededProviders: [],
    });
  });

  it("reports an unconfigured provider as an error instead of crashing", async () => {
    const result = await fetchAllInstitutions(["plaid"]);
    expect(result.errors[0]?.provider).toBe("plaid");
    expect(result.errors[0]?.error).toContain("not configured");
  });
});
