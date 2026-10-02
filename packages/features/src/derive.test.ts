import { describe, expect, it } from "bun:test";
import { deriveFeatures, enabledBankProviders } from "./derive";

describe("deriveFeatures", () => {
  it("disables every optional service when nothing is configured", () => {
    expect(deriveFeatures({})).toEqual({
      ai: false,
      auth: { google: false, github: false, apple: false, microsoft: false },
      banking: {
        plaid: false,
        teller: false,
        enablebanking: false,
        simplefin: false,
      },
      mail: "console",
      storage: "local",
      inboundEmail: false,
      integrations: {
        slack: false,
        xero: false,
        quickbooks: false,
        fortnox: false,
        gmail: false,
        outlook: false,
        composio: false,
        stripe: false,
        whatsapp: false,
        telegram: false,
        sendblue: false,
      },
      analytics: false,
      sentry: false,
    });
  });

  it("requires every key of a multi-key service", () => {
    expect(deriveFeatures({ PLAID_CLIENT_ID: "id" }).banking.plaid).toBe(false);
    expect(
      deriveFeatures({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "secret" }).banking
        .plaid,
    ).toBe(true);
    expect(deriveFeatures({ OPENPANEL_CLIENT_ID: "id" }).analytics).toBe(false);
  });

  it("treats empty and whitespace values as unset", () => {
    expect(deriveFeatures({ OPENAI_API_KEY: "" }).ai).toBe(false);
    expect(
      deriveFeatures({ TELEGRAM_BOT_TOKEN: "  " }).integrations.telegram,
    ).toBe(false);
  });

  it("enables a social sign-in provider only with id and secret", () => {
    expect(deriveFeatures({ AUTH_GITHUB_CLIENT_ID: "id" }).auth.github).toBe(
      false,
    );
    expect(
      deriveFeatures({
        AUTH_GITHUB_CLIENT_ID: "id",
        AUTH_GITHUB_CLIENT_SECRET: "secret",
      }).auth,
    ).toEqual({ google: false, github: true, apple: false, microsoft: false });
  });

  it("enables AI with either provider key", () => {
    expect(deriveFeatures({ OPENAI_API_KEY: "sk" }).ai).toBe(true);
    expect(deriveFeatures({ GOOGLE_GENERATIVE_AI_API_KEY: "g" }).ai).toBe(true);
    expect(deriveFeatures({ AI_PROVIDER: "openai", AI_API_KEY: "k" }).ai).toBe(
      true,
    );
    expect(
      deriveFeatures({
        AI_PROVIDER: "openai-compatible",
        AI_BASE_URL: "http://localhost:11434/v1",
        AI_MODEL_CHAT: "qwen2.5vl",
      }).ai,
    ).toBe(true);
    expect(deriveFeatures({ AI_PROVIDER: "openai" }).ai).toBe(false);
  });

  it("uses SMTP when configured and falls back to console", () => {
    expect(deriveFeatures({ SMTP_URL: "smtp://x" }).mail).toBe("smtp");
    expect(deriveFeatures({}).mail).toBe("console");
  });

  it("selects s3 storage from STORAGE_DRIVER or S3_BUCKET", () => {
    expect(deriveFeatures({ S3_BUCKET: "midday" }).storage).toBe("s3");
    expect(deriveFeatures({ STORAGE_DRIVER: "s3" }).storage).toBe("s3");
    expect(
      deriveFeatures({ STORAGE_DRIVER: "local", S3_BUCKET: "midday" }).storage,
    ).toBe("local");
  });

  it("derives the inbound email driver", () => {
    const domain = { INBOX_EMAIL_DOMAIN: "inbox.example.com" };
    expect(deriveFeatures({}).inboundEmail).toBe(false);
    expect(deriveFeatures({ IMAP_URL: "imaps://u:p@h" }).inboundEmail).toBe(
      false,
    );
    expect(
      deriveFeatures({ ...domain, INBOX_WEBHOOK_USERNAME: "u" }).inboundEmail,
    ).toBe(false);
    expect(
      deriveFeatures({
        ...domain,
        INBOX_WEBHOOK_USERNAME: "u",
        INBOX_WEBHOOK_PASSWORD: "p",
      }).inboundEmail,
    ).toBe("postmark");
    expect(
      deriveFeatures({ ...domain, IMAP_URL: "imaps://u:p@h" }).inboundEmail,
    ).toBe("imap");
  });

  it("enables each integration from its own keys", () => {
    const { integrations } = deriveFeatures({
      SLACK_CLIENT_ID: "a",
      SLACK_CLIENT_SECRET: "b",
      SLACK_SIGNING_SECRET: "c",
      STRIPE_SECRET_KEY: "sk",
      STRIPE_CONNECT_CLIENT_ID: "ca",
      COMPOSIO_API_KEY: "k",
    });
    expect(integrations.slack).toBe(true);
    expect(integrations.stripe).toBe(true);
    expect(integrations.composio).toBe(true);
    expect(integrations.xero).toBe(false);
  });
});

describe("enabledBankProviders", () => {
  it("lists only configured providers", () => {
    expect(enabledBankProviders(deriveFeatures({}).banking)).toEqual([]);
    expect(
      enabledBankProviders(
        deriveFeatures({
          PLAID_CLIENT_ID: "a",
          PLAID_SECRET: "b",
          ENABLEBANKING_APPLICATION_ID: "c",
          ENABLE_BANKING_KEY_CONTENT: "d",
        }).banking,
      ),
    ).toEqual(["plaid", "enablebanking"]);
  });

  it("enables simplefin only when SIMPLEFIN_ENABLED is true (string or boolean)", () => {
    const f = (v: unknown) =>
      deriveFeatures({ SIMPLEFIN_ENABLED: v as string }).banking.simplefin;
    expect(f("true")).toBe(true);
    expect(f(true)).toBe(true);
    expect(f("false")).toBe(false);
    expect(f(false)).toBe(false);
    expect(f(undefined)).toBe(false);
  });
});
