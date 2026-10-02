import "server-only";
import { getFeatures } from "@midday/features";
import { ENV } from "@/env";
import type { PublicConfig } from "./public-config";

export function getPublicConfig(): PublicConfig {
  const features = getFeatures();

  return {
    environment: ENV.APP_ENV,
    appUrl: ENV.APP_URL,
    apiUrl: ENV.API_URL,
    features,
    desktopScheme: ENV.DESKTOP_SCHEME,
    supabase:
      ENV.SUPABASE_URL && ENV.SUPABASE_PUBLISHABLE_KEY
        ? {
            url: ENV.SUPABASE_URL,
            publishableKey: ENV.SUPABASE_PUBLISHABLE_KEY,
          }
        : null,
    sentry: ENV.SENTRY_DSN
      ? {
          dsn: ENV.SENTRY_DSN,
          environment: ENV.APP_ENV,
          release: ENV.GIT_COMMIT_SHA,
        }
      : null,
    openpanelClientId: features.analytics
      ? (ENV.OPENPANEL_CLIENT_ID ?? null)
      : null,
    plaidEnvironment: ENV.PLAID_ENVIRONMENT,
    teller: ENV.TELLER_APPLICATION_ID
      ? {
          applicationId: ENV.TELLER_APPLICATION_ID,
          environment: ENV.TELLER_ENVIRONMENT,
        }
      : null,
    stripePublishableKey: ENV.STRIPE_PUBLISHABLE_KEY ?? null,
    googleMapsApiKey: ENV.GOOGLE_MAPS_API_KEY ?? null,
    whatsappNumber: ENV.WHATSAPP_NUMBER ?? null,
    telegramBotUsername: ENV.TELEGRAM_BOT_USERNAME ?? null,
    sendblueNumber: ENV.SENDBLUE_FROM_NUMBER ?? null,
  };
}
