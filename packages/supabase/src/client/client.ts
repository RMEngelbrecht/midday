import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "../types";

type BrowserConfig = { url: string; publishableKey: string };

let browserConfig: BrowserConfig | undefined;

/**
 * Supabase URL/key are runtime configuration (not build-time inlined). The
 * dashboard's PublicConfigProvider calls this before any client component
 * creates a client.
 */
export function configureSupabaseClient(config: BrowserConfig) {
  browserConfig = config;
}

export const createClient = () => {
  if (!browserConfig) {
    throw new Error(
      "Supabase browser client is not configured: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set",
    );
  }

  return createBrowserClient<Database>(
    browserConfig.url,
    browserConfig.publishableKey,
  );
};
