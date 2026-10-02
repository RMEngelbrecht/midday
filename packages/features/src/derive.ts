/**
 * Optional services are enabled by the presence of their env keys. This module
 * maps env presence to a typed `Features` object. It is pure so it can be
 * tested without loading env; `getFeatures()` in ./index applies it to ENV.
 */

export type MailDriver = "smtp" | "console";
export type InboundEmailDriver = "postmark" | "imap";
export type StorageDriver = "local" | "s3";

export type BankingFeatures = {
  plaid: boolean;
  teller: boolean;
  simplefin: boolean;
  enablebanking: boolean;
};

export type BankProvider = keyof BankingFeatures;

/** Bank providers whose credentials are configured, in a stable order. */
export function enabledBankProviders(banking: BankingFeatures): BankProvider[] {
  return (Object.keys(banking) as BankProvider[]).filter((p) => banking[p]);
}

export type IntegrationFeatures = {
  slack: boolean;
  xero: boolean;
  quickbooks: boolean;
  fortnox: boolean;
  gmail: boolean;
  outlook: boolean;
  composio: boolean;
  stripe: boolean;
  whatsapp: boolean;
  telegram: boolean;
  sendblue: boolean;
};

/** Social sign-in providers configured on the API's better-auth instance. */
export type AuthProviderFeatures = {
  google: boolean;
  github: boolean;
  apple: boolean;
  microsoft: boolean;
};

export type Features = {
  ai: boolean;
  auth: AuthProviderFeatures;
  banking: BankingFeatures;
  mail: MailDriver;
  storage: StorageDriver;
  /** How inbound email arrives; false hides the forwarding address UI. */
  inboundEmail: InboundEmailDriver | false;
  integrations: IntegrationFeatures;
  analytics: boolean;
  sentry: boolean;
};

export const FEATURE_ENV_KEYS = [
  "AUTH_GOOGLE_CLIENT_ID",
  "AUTH_GOOGLE_CLIENT_SECRET",
  "AUTH_GITHUB_CLIENT_ID",
  "AUTH_GITHUB_CLIENT_SECRET",
  "AUTH_APPLE_CLIENT_ID",
  "AUTH_APPLE_CLIENT_SECRET",
  "AUTH_MICROSOFT_CLIENT_ID",
  "AUTH_MICROSOFT_CLIENT_SECRET",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "TELLER_APPLICATION_ID",
  "TELLER_CERT_BASE64",
  "TELLER_KEY_BASE64",
  "SIMPLEFIN_ENABLED",
  "ENABLEBANKING_APPLICATION_ID",
  "ENABLE_BANKING_KEY_CONTENT",
  "SMTP_URL",
  "IMAP_URL",
  "INBOX_EMAIL_DOMAIN",
  "INBOX_WEBHOOK_USERNAME",
  "INBOX_WEBHOOK_PASSWORD",
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_SIGNING_SECRET",
  "XERO_CLIENT_ID",
  "XERO_CLIENT_SECRET",
  "QUICKBOOKS_CLIENT_ID",
  "QUICKBOOKS_CLIENT_SECRET",
  "FORTNOX_CLIENT_ID",
  "FORTNOX_CLIENT_SECRET",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "OUTLOOK_CLIENT_ID",
  "OUTLOOK_CLIENT_SECRET",
  "COMPOSIO_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_CONNECT_CLIENT_ID",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "SENDBLUE_API_KEY",
  "SENDBLUE_API_SECRET",
  "OPENPANEL_CLIENT_ID",
  "OPENPANEL_SECRET_KEY",
  "SENTRY_DSN",
  "STORAGE_DRIVER",
  "S3_BUCKET",
] as const;

export type FeatureEnvKey = (typeof FEATURE_ENV_KEYS)[number];
export type FeatureEnv = Partial<Record<FeatureEnvKey, string | undefined>>;

export function deriveFeatures(env: FeatureEnv): Features {
  const all = (...keys: FeatureEnvKey[]) =>
    keys.every((key) => Boolean(env[key]?.trim()));

  return {
    ai: all("OPENAI_API_KEY") || all("GOOGLE_GENERATIVE_AI_API_KEY"),
    auth: {
      google: all("AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET"),
      github: all("AUTH_GITHUB_CLIENT_ID", "AUTH_GITHUB_CLIENT_SECRET"),
      apple: all("AUTH_APPLE_CLIENT_ID", "AUTH_APPLE_CLIENT_SECRET"),
      microsoft: all(
        "AUTH_MICROSOFT_CLIENT_ID",
        "AUTH_MICROSOFT_CLIENT_SECRET",
      ),
    },
    banking: {
      plaid: all("PLAID_CLIENT_ID", "PLAID_SECRET"),
      teller: all(
        "TELLER_APPLICATION_ID",
        "TELLER_CERT_BASE64",
        "TELLER_KEY_BASE64",
      ),
      simplefin: // ENV coerces this key to a boolean, so stringify before comparing
        String(env.SIMPLEFIN_ENABLED ?? "")
          .trim()
          .toLowerCase() === "true",
      enablebanking: all(
        "ENABLEBANKING_APPLICATION_ID",
        "ENABLE_BANKING_KEY_CONTENT",
      ),
    },
    mail: all("SMTP_URL") ? "smtp" : "console",
    storage:
      env.STORAGE_DRIVER === "local" || env.STORAGE_DRIVER === "s3"
        ? env.STORAGE_DRIVER
        : all("S3_BUCKET")
          ? "s3"
          : "local",
    inboundEmail: all("INBOX_EMAIL_DOMAIN", "IMAP_URL")
      ? "imap"
      : all(
            "INBOX_EMAIL_DOMAIN",
            "INBOX_WEBHOOK_USERNAME",
            "INBOX_WEBHOOK_PASSWORD",
          )
        ? "postmark"
        : false,
    integrations: {
      slack: all(
        "SLACK_CLIENT_ID",
        "SLACK_CLIENT_SECRET",
        "SLACK_SIGNING_SECRET",
      ),
      xero: all("XERO_CLIENT_ID", "XERO_CLIENT_SECRET"),
      quickbooks: all("QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"),
      fortnox: all("FORTNOX_CLIENT_ID", "FORTNOX_CLIENT_SECRET"),
      gmail: all("GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"),
      outlook: all("OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET"),
      composio: all("COMPOSIO_API_KEY"),
      stripe: all("STRIPE_SECRET_KEY", "STRIPE_CONNECT_CLIENT_ID"),
      whatsapp: all("WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"),
      telegram: all("TELEGRAM_BOT_TOKEN"),
      sendblue: all("SENDBLUE_API_KEY", "SENDBLUE_API_SECRET"),
    },
    analytics: all("OPENPANEL_CLIENT_ID", "OPENPANEL_SECRET_KEY"),
    sentry: all("SENTRY_DSN"),
  };
}
