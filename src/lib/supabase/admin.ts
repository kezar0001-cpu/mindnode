import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

// Admin client using the service-role key.
// Bypasses RLS — only use it from server-side code that needs to act
// outside the current user's scope (e.g. running the AI suggestion
// pipeline against multiple users' data in batch). Must never reach
// the browser. `server-only` makes any client-bundle import a
// build-time error.
//
// For normal user actions, use `createSupabaseServerClient()` from
// ./server.ts, which uses the anon key and the user's session cookie
// so RLS is enforced.
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
