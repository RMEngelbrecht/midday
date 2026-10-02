// Sentry is initialized at runtime by PublicConfigProvider once the DSN is
// known (it is runtime config, not inlined at build time).
import * as Sentry from "@sentry/nextjs";

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
