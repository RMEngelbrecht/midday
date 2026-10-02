import { describe, expect, test } from "bun:test";
import { findInboxId, formatInboxAddress, parseInboxId } from "./address";

describe("formatInboxAddress", () => {
  test("plain address", () => {
    expect(formatInboxAddress("egr34f", { domain: "inbox.example.com" })).toBe(
      "egr34f@inbox.example.com",
    );
  });

  test("plus-addressing with local part", () => {
    expect(
      formatInboxAddress("egr34f", {
        domain: "example.com",
        localPart: "inbox",
      }),
    ).toBe("inbox+egr34f@example.com");
  });

  test("null without a domain", () => {
    expect(formatInboxAddress("egr34f", {})).toBeNull();
  });
});

describe("parseInboxId", () => {
  const config = { domain: "inbox.example.com" };

  test("plain address", () => {
    expect(parseInboxId("egr34f@inbox.example.com", config)).toBe("egr34f");
  });

  test("display name and case", () => {
    expect(parseInboxId('"Inbox" <EGR34F@Inbox.Example.com>', config)).toBe(
      "egr34f",
    );
  });

  test("plus-addressing", () => {
    expect(parseInboxId("inbox+egr34f@inbox.example.com", config)).toBe(
      "egr34f",
    );
  });

  test("wrong domain is ignored when a domain is configured", () => {
    expect(parseInboxId("egr34f@other.com", config)).toBeUndefined();
    expect(parseInboxId("egr34f@other.com")).toBe("egr34f");
  });

  test("rejects non-id local parts", () => {
    expect(parseInboxId("john.doe@inbox.example.com", config)).toBeUndefined();
    expect(parseInboxId("nonsense", config)).toBeUndefined();
  });
});

describe("findInboxId", () => {
  const config = { domain: "example.com" };

  test("uses the first matching recipient (To before Delivered-To)", () => {
    expect(
      findInboxId(
        ["someone@else.org", "inbox+abc123@example.com", "zzz999@example.com"],
        config,
      ),
    ).toBe("abc123");
  });

  test("falls back to Delivered-To when To is a list address", () => {
    expect(
      findInboxId(
        ["team@elsewhere.org", undefined, "abc123@example.com"],
        config,
      ),
    ).toBe("abc123");
  });

  test("undefined when nothing matches", () => {
    expect(findInboxId(["a@b.org"], config)).toBeUndefined();
  });
});
