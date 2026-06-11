"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { createMemoryEntryAction } from "@/lib/memory/actions";
import {
  MAX_MEMORY_LENGTH,
  initialCreateMemoryEntryState,
} from "@/lib/memory/types";

// Always-visible bottom-centre capture bar for the 3D canvas. A single line
// that expands to a small textarea on focus. On save it hands the memory id
// up so the workspace can request an AI placement and show the preview node.
export function QuickCapture({
  onSuccess,
  busy,
}: {
  onSuccess?: (memoryId: string) => void;
  busy?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    createMemoryEntryAction,
    initialCreateMemoryEntryState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setFocused(false);
      onSuccess?.(state.memoryId);
    }
  }, [state, onSuccess]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className={[
        "rounded-2xl border border-canvas-border/80 bg-canvas-surface/90 backdrop-blur-md",
        "shadow-lg shadow-black/40 transition-all duration-200",
        "p-2",
      ].join(" ")}
    >
      <label htmlFor="quick-capture" className="sr-only">
        Capture a thought
      </label>
      <textarea
        id="quick-capture"
        name="content"
        rows={focused ? 3 : 1}
        maxLength={MAX_MEMORY_LENGTH}
        required
        onFocus={() => setFocused(true)}
        placeholder="What's on your mind?"
        className={[
          "block w-full resize-none rounded-xl bg-transparent px-3 py-2",
          "text-base text-neutral-100 outline-none placeholder:text-neutral-500",
        ].join(" ")}
      />
      <div
        className={[
          "flex items-center justify-between gap-3 px-1",
          focused ? "mt-1" : "h-0 overflow-hidden",
        ].join(" ")}
      >
        <p className="text-xs" aria-live="polite">
          {state.status === "error" ? (
            <span className="text-red-400">{state.error}</span>
          ) : busy ? (
            <span className="text-sky-300">Finding where it belongs…</span>
          ) : (
            <span className="text-neutral-500">Enter a thought to capture.</span>
          )}
        </p>
        <button
          type="submit"
          disabled={pending || busy}
          className="rounded-full bg-neutral-100 px-4 py-1.5 text-sm font-medium text-canvas-bg hover:bg-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Capture"}
        </button>
      </div>
    </form>
  );
}
