"use client";

import * as Sentry from "@sentry/nextjs";
import { createContext, type ReactNode, useContext } from "react";
import type { PublicConfig } from "@/utils/public-config";

const PublicConfigContext = createContext<PublicConfig | null>(null);

// Module-level copy for non-React client code (stores, upload helpers).
// Config is process-wide on the server, so sharing it across requests is safe.
let currentConfig: PublicConfig | null = null;
let sentryInitialized = false;

function applyConfig(config: PublicConfig) {
  if (currentConfig === config) return;
  currentConfig = config;

  if (typeof window !== "undefined" && config.sentry && !sentryInitialized) {
    sentryInitialized = true;
    Sentry.init({
      dsn: config.sentry.dsn,
      environment: config.sentry.environment,
      release: config.sentry.release,
      enabled: config.sentry.environment === "production",
      tracesSampleRate: 0.1,
      enableLogs: true,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
  }
}

export function PublicConfigProvider({
  config,
  children,
}: {
  config: PublicConfig;
  children: ReactNode;
}) {
  applyConfig(config);

  return (
    <PublicConfigContext.Provider value={config}>
      {children}
    </PublicConfigContext.Provider>
  );
}

export function usePublicConfig(): PublicConfig {
  const config = useContext(PublicConfigContext);
  if (!config) {
    throw new Error("usePublicConfig must be used within PublicConfigProvider");
  }
  return config;
}

/** For non-React client code. Call lazily (not at module load). */
export function getClientPublicConfig(): PublicConfig {
  if (!currentConfig) {
    throw new Error("PublicConfig is not available yet");
  }
  return currentConfig;
}
