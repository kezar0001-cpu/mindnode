import "server-only";

import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// User-scoped server client. Reads/writes the Supabase auth cookies
// via next/headers, so RLS engages with the signed-in user's JWT.
// Use this from Server Components, Server Actions, and Route Handlers.
// For service-role admin tasks, see ./admin.ts.
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // setAll is a no-op in Server Component context where the
          // cookie store is read-only. The Next.js middleware refreshes
          // the session cookies on every request.
        }
      },
    },
  });
}
