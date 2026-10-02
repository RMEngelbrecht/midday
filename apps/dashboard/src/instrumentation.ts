import * as Sentry from "@sentry/nextjs";

export async function register() {
  // No edge routes: proxy.ts and all routes run on the Node.js runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
