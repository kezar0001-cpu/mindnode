"use client";

import { useActionState, useEffect, useRef } from "react";

import { createMemoryEntryAction } from "@/lib/memory/actions";
import {
  MAX_MEMORY_LENGTH,
  initialCreateMemoryEntryState,
} from "@/lib/memory/types";

export function ThoughtInputForm({ onSuccess }: { onSuccess?: () => void }) {
  const [state, formAction, pending] = useActionState(
    createMemoryEntryAction,
    initialCreateMemoryEntryState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      onSuccess?.();
    }
  }, [state, onSuccess]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <label htmlFor="content" className="sr-only">
        Thought
      </label>
      <textarea
        id="content"
        name="content"
        rows={4}
        maxLength={MAX_MEMORY_LENGTH}
        required
        placeholder="What's on your mind?"
        className="block w-full resize-y rounded border border-canvas-border bg-canvas-bg p-3 text-base outline-none focus:border-neutral-400"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs" aria-live="polite">
          {state.status === "error" ? (
            <span className="text-red-400">{state.error}</span>
          ) : state.status === "success" ? (
            <span className="text-emerald-400">Saved.</span>
          ) : (
            <span className="text-neutral-500">
              Up to {MAX_MEMORY_LENGTH.toLocaleString()} characters.
            </span>
          )}
        </p>

        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-canvas-bg hover:bg-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
