import { ENV } from "@api/env";
import * as Sentry from "@sentry/bun";

if (ENV.APP_ENV === "production" && ENV.SENTRY_DSN) {
  Sentry.init({
    dsn: ENV.SENTRY_DSN,

    release: ENV.GIT_COMMIT_SHA,

    environment: ENV.APP_ENV,

    integrations: [Sentry.consoleLoggingIntegration({ levels: ["error"] })],

    sendDefaultPii: true,
    enableLogs: true,

    // Sample 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,

    // Drop noisy transactions that don't provide value
    beforeSendTransaction(event) {
      const url = event.request?.url || event.transaction || "";

      if (
        url.includes("/health") ||
        url.includes("/openapi") ||
        event.request?.method === "OPTIONS"
      ) {
        return null;
      }

      return event;
    },

    // Filter out expected client errors from error reporting
    beforeSend(event) {
      // Don't send network/timeout errors from health checks
      const message = event.exception?.values?.[0]?.value || "";
      if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT")) {
        // Only drop if it's from a health check context
        const transaction = event.transaction || "";
        if (transaction.includes("/health")) {
          return null;
        }
      }

      return event;
    },
  });
}
