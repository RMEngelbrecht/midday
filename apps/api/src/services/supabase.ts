import { ENV } from "@api/env";
import type { Database } from "@midday/supabase/types";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export async function createClient(accessToken?: string) {
  return createSupabaseClient<Database>(
    ENV.SUPABASE_URL!,
    ENV.SUPABASE_SECRET_KEY!,
    {
      accessToken() {
        return Promise.resolve(accessToken || "");
      },
    },
  );
}

export async function createAdminClient() {
  return createSupabaseClient<Database>(
    ENV.SUPABASE_URL!,
    ENV.SUPABASE_SECRET_KEY!,
  );
}
