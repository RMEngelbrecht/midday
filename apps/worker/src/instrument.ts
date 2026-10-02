import * as Sentry from "@sentry/bun";
import { ENV } from "./env";

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

    // Drop noisy transactions (health checks, admin dashboard)
    beforeSendTransaction(event) {
      const url = event.request?.url || event.transaction || "";

      if (url.includes("/health") || url.includes("/admin")) {
        return null;
      }

      return event;
    },
  });
}
