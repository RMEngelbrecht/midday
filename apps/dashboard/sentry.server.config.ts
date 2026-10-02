// This file configures the initialization of Sentry on the server.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { ENV } from "./src/env";

if (ENV.SENTRY_DSN) {
  Sentry.init({
    dsn: ENV.SENTRY_DSN,
    environment: ENV.APP_ENV,
    release: ENV.GIT_COMMIT_SHA,
    enabled: ENV.APP_ENV === "production",

    // Lower trace sampling in production to save quota
    tracesSampleRate: 0.1,

    // Enable logs to be sent to Sentry
    enableLogs: true,

    debug: false,
  });
}
