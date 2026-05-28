import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/auth";

import { signInAction } from "./actions";

// Reads auth cookies on every request; never prerender.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }

  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas-bg p-4 sm:p-6">
      <div className="w-full max-w-sm rounded-md border border-canvas-border bg-canvas-surface p-5 sm:p-6">
        <h1 className="text-xl font-semibold tracking-tight">MindNode</h1>
        <p className="mb-6 mt-1 text-sm text-neutral-500">
          Sign in to continue.
        </p>

        <form action={signInAction} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="email"
              className="block text-xs uppercase tracking-wider text-neutral-400"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              className="w-full rounded border border-canvas-border bg-canvas-bg px-3 py-2.5 text-base outline-none focus:border-neutral-400"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="password"
              className="block text-xs uppercase tracking-wider text-neutral-400"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded border border-canvas-border bg-canvas-bg px-3 py-2.5 text-base outline-none focus:border-neutral-400"
            />
          </div>

          {error ? (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded bg-neutral-100 px-3 py-3 text-sm font-medium text-canvas-bg hover:bg-white"
          >
            Sign in
          </button>
        </form>

        <p className="mt-6 text-xs text-neutral-500">
          Create your user via the Supabase dashboard
          (<span className="text-neutral-300">Auth → Users → Add user</span>),
          then sign in here.
        </p>
      </div>
    </main>
  );
}
