import { describe, expect, test } from "bun:test";
import { inboundFromParsedMail, type ParsedMailLike } from "./mail-parser";

const base = (over: Partial<ParsedMailLike>): ParsedMailLike => ({
  messageId: "<m1@example.com>",
  subject: "Invoice",
  from: { value: [{ address: "billing@vendor.com", name: "Vendor" }] },
  headers: new Map(),
  attachments: [
    {
      filename: "inv.pdf",
      contentType: "application/pdf",
      size: 3,
      content: Buffer.from("abc"),
    },
  ],
  ...over,
});

const config = { domain: "example.com" };

describe("inboundFromParsedMail", () => {
  test("maps To with plus-addressing", () => {
    const mail = inboundFromParsedMail(
      base({ to: { value: [{ address: "inbox+abc123@example.com" }] } }),
      config,
      "fallback",
    );
    expect(mail?.inboxId).toBe("abc123");
    expect(mail?.from).toEqual({ name: "Vendor", email: "billing@vendor.com" });
    expect(mail?.attachments[0]).toEqual({
      Name: "inv.pdf",
      Content: "YWJj",
      ContentType: "application/pdf",
      ContentLength: 3,
    });
  });

  test("falls back to Delivered-To when To is not an inbox address", () => {
    const mail = inboundFromParsedMail(
      base({
        to: { value: [{ address: "accounts@company.org" }] },
        headers: new Map([["delivered-to", "abc123@example.com"]]),
      }),
      config,
      "fallback",
    );
    expect(mail?.inboxId).toBe("abc123");
  });

  test("uses X-Original-To", () => {
    const mail = inboundFromParsedMail(
      base({
        to: { value: [{ address: "list@company.org" }] },
        headers: new Map([["x-original-to", ["zzz111@example.com"]]]),
      }),
      config,
      "fallback",
    );
    expect(mail?.inboxId).toBe("zzz111");
  });

  test("null when no recipient matches", () => {
    expect(
      inboundFromParsedMail(
        base({ to: { value: [{ address: "x@other.org" }] } }),
        config,
        "f",
      ),
    ).toBeNull();
  });

  test("falls back to the given message id", () => {
    const mail = inboundFromParsedMail(
      base({
        messageId: undefined,
        to: { value: [{ address: "abc123@example.com" }] },
      }),
      config,
      "imap-7",
    );
    expect(mail?.messageId).toBe("imap-7");
  });
});
