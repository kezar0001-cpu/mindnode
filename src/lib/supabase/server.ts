import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

// Server-side client using the service-role key.
// Bypasses RLS (none defined yet) and must never reach the browser.
// `server-only` makes any client-bundle import a build-time error.
export function createSupabaseServerClient() {
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
