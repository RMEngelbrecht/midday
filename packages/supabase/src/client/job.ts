import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import type { Database } from "../types/db";

export const createClient = () =>
  createSupabaseClient<Database>(ENV.SUPABASE_URL!, ENV.SUPABASE_SECRET_KEY!);
