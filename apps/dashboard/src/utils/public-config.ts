import type { Features } from "@midday/features";

/**
 * Configuration the browser needs, resolved from env on the server at request
 * time and passed down through `PublicConfigProvider`. Nothing here is inlined
 * at build time, so one dashboard image can serve any domain/feature set.
 *
 * Only add values that are safe to expose publicly.
 */
export type PublicConfig = {
  /** APP_ENV (development, test, staging, production). */
  environment: string;
  appUrl: string;
  apiUrl: string;
  features: Features;
  /** Where inbound email is received; null when forwarding is not configured. */
  inboxEmail: { domain: string; localPart: string | null } | null;
  desktopScheme: string;
  /** Supabase storage/realtime (until S2/S7 replace it). Auth is better-auth on the API. */
  supabase: { url: string; publishableKey: string } | null;
  sentry: { dsn: string; environment: string; release?: string } | null;
  openpanelClientId: string | null;
  /** logo.dev publishable token; logos fall back to initials when null. */
  logoDevToken: string | null;
  plaidEnvironment: string;
  teller: { applicationId: string; environment?: string } | null;
  stripePublishableKey: string | null;
  googleMapsApiKey: string | null;
  whatsappNumber: string | null;
  telegramBotUsername: string | null;
  sendblueNumber: string | null;
};
