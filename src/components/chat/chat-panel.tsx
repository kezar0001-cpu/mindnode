"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  applyChatGraphSuggestionAction,
  dismissChatGraphSuggestionAction,
} from "@/lib/chat/actions";
import type {
  ChatCitation,
  ChatMode,
  ProposedGraphChanges,
} from "@/types";

type Suggestion = {
  suggestionId: string | null;
  changes: ProposedGraphChanges;
  status: "pending" | "applied" | "dismissed";
};

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: ChatCitation[];
  suggestion?: Suggestion;
};

type ChatPanelProps = {
  open: boolean;
  onClose: () => void;
  focusNode: { id: string; title: string } | null;
  onClearFocus: () => void;
  starter: { prompt: string; nonce: number } | null;
  onApplied: () => void;
};

let localIdSeq = 0;
function localId(): string {
  localIdSeq += 1;
  return `local-${Date.now()}-${localIdSeq}`;
}

export function ChatPanel({
  open,
  onClose,
  focusNode,
  onClearFocus,
  starter,
  onApplied,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate the latest conversation the first time the panel opens.
  useEffect(() => {
    if (!open || hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat", { method: "GET" });
        const json = await res.json();
        if (cancelled || !json.ok) {
          setHydrated(true);
          return;
        }
        const pendingByMsg = new Map<string, Suggestion>();
        const standalone: Suggestion[] = [];
        for (const s of json.pending_suggestions ?? []) {
          const suggestion: Suggestion = {
            suggestionId: s.id,
            changes: s.changes,
            status: "pending",
          };
          if (s.message_id) pendingByMsg.set(s.message_id, suggestion);
          else standalone.push(suggestion);
        }
        const loaded: UiMessage[] = (json.messages ?? []).map(
          (m: {
            id: string;
            role: "user" | "assistant";
            content: string;
            citations: ChatCitation[];
          }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            citations: m.citations ?? [],
            suggestion: pendingByMsg.get(m.id),
          }),
        );
        // Attach any standalone pending suggestions to the last assistant turn.
        if (standalone.length > 0) {
          for (let i = loaded.length - 1; i >= 0; i--) {
            if (loaded[i].role === "assistant" && !loaded[i].suggestion) {
              loaded[i].suggestion = standalone[0];
              break;
            }
          }
        }
        setMessages(loaded);
        setConversationId(json.conversation_id ?? null);
        setHydrated(true);
      } catch {
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, hydrated]);

  // Prefill the input when opened from a node action.
  useEffect(() => {
    if (!open || !starter) return;
    setInput(starter.prompt);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [open, starter]);

  // Keep the conversation scrolled to the newest message.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [messages, open]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: UiMessage = {
      id: localId(),
      role: "user",
      content: text,
      citations: [],
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setError(null);

    const mode: ChatMode = focusNode ? "node_focus" : "global";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          selected_node_id: focusNode?.id,
          conversation_id: conversationId,
          mode,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Chat failed.");
        return;
      }
      setConversationId(json.conversation_id ?? conversationId);

      const changes = json.proposed_graph_changes as
        | (ProposedGraphChanges & { suggestion_id?: string | null })
        | undefined;
      const suggestion: Suggestion | undefined = changes
        ? {
            suggestionId: changes.suggestion_id ?? null,
            changes: { nodes: changes.nodes ?? [], edges: changes.edges ?? [] },
            status: "pending",
          }
        : undefined;

      const assistantMsg: UiMessage = {
        id: localId(),
        role: "assistant",
        content: json.answer ?? "",
        citations: (json.citations ?? []) as ChatCitation[],
        suggestion,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSending(false);
    }
  }, [input, sending, focusNode, conversationId]);

  const updateSuggestionStatus = useCallback(
    (messageId: string, status: Suggestion["status"]) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.suggestion
            ? { ...m, suggestion: { ...m.suggestion, status } }
            : m,
        ),
      );
    },
    [],
  );

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300"
      />
      <div
        className={[
          "fixed bottom-0 left-0 right-0 z-50 flex flex-col",
          "rounded-t-2xl border-t border-canvas-border bg-canvas-surface",
        ].join(" ")}
        style={{ height: "82vh", maxHeight: "82vh" }}
      >
        {/* Grab handle + header */}
        <div className="shrink-0 px-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-700" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-neutral-200">Companion</p>
              {focusNode && (
                <span className="inline-flex items-center gap-1 rounded-full border border-teal-400/40 bg-teal-950/30 px-2 py-0.5 text-[11px] text-teal-200">
                  <span className="line-clamp-1 max-w-[140px]">{focusNode.title}</span>
                  <button
                    type="button"
                    onClick={onClearFocus}
                    aria-label="Clear focus"
                    className="text-teal-300 hover:text-teal-100"
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-neutral-400 hover:text-neutral-200"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.length === 0 && !sending && (
            <div className="mt-4 space-y-2 text-center">
              <p className="text-sm text-neutral-300">
                Ask about your graph and sources.
              </p>
              <p className="text-xs text-neutral-500">
                {focusNode
                  ? `Focused on "${focusNode.title}". Ask anything about it.`
                  : "Try: “What themes connect my recent thoughts?”"}
              </p>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id}>
              <MessageBubble message={m} />
              {m.role === "assistant" && m.suggestion && (
                <SuggestionCard
                  suggestion={m.suggestion}
                  onApplied={() => {
                    updateSuggestionStatus(m.id, "applied");
                    onApplied();
                  }}
                  onDismissed={() => updateSuggestionStatus(m.id, "dismissed")}
                />
              )}
            </div>
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-teal-400" />
              Thinking…
            </div>
          )}
        </div>

        {error && (
          <div className="mx-5 mb-2 rounded-lg border border-red-500/40 bg-red-950/60 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {/* Composer */}
        <div
          className="shrink-0 border-t border-canvas-border bg-canvas-surface px-4 py-3"
          style={{ paddingBottom: "max(12px, calc(env(safe-area-inset-bottom) + 8px))" }}
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={focusNode ? "Ask about this node…" : "Ask your companion…"}
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-canvas-border bg-canvas-bg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-teal-300"
            />
            <button
              type="button"
              onClick={send}
              disabled={!input.trim() || sending}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-300 text-canvas-bg transition-colors hover:bg-teal-200 disabled:opacity-40"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8h11M8 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function MessageBubble({ message }: { message: UiMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-teal-300 text-canvas-bg"
            : "border border-canvas-border bg-canvas-bg text-neutral-200",
        ].join(" ")}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        {!isUser && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-canvas-border pt-2">
            {message.citations.map((c, i) => (
              <span
                key={i}
                className={[
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
                  c.type === "source"
                    ? "border border-blue-400/40 bg-blue-950/30 text-blue-200"
                    : "border border-violet-400/40 bg-violet-950/30 text-violet-200",
                ].join(" ")}
                title={c.ref}
              >
                {c.type === "source" ? "📄" : "◆"} {c.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onApplied,
  onDismissed,
}: {
  suggestion: Suggestion;
  onApplied: () => void;
  onDismissed: () => void;
}) {
  const { changes, status, suggestionId } = suggestion;
  const [nodeChecked, setNodeChecked] = useState<boolean[]>(
    () => changes.nodes.map(() => true),
  );
  const [edgeChecked, setEdgeChecked] = useState<boolean[]>(
    () => changes.edges.map(() => true),
  );
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  if (status === "applied") {
    return (
      <p className="mt-2 text-[11px] text-emerald-300">
        ✓ Added to your canvas.
      </p>
    );
  }
  if (status === "dismissed") {
    return (
      <p className="mt-2 text-[11px] text-neutral-500">Suggestion dismissed.</p>
    );
  }

  const apply = async (all: boolean) => {
    setBusy(true);
    setCardError(null);
    const selected: ProposedGraphChanges = all
      ? changes
      : {
          nodes: changes.nodes.filter((_, i) => nodeChecked[i]),
          edges: changes.edges.filter((_, i) => edgeChecked[i]),
        };
    if (selected.nodes.length === 0 && selected.edges.length === 0) {
      setCardError("Select at least one item.");
      setBusy(false);
      return;
    }
    const result = await applyChatGraphSuggestionAction({
      suggestionId: suggestionId ?? undefined,
      changes: selected,
    });
    setBusy(false);
    if (!result.success) {
      setCardError(result.error ?? "Could not add to canvas.");
      return;
    }
    onApplied();
  };

  const dismiss = async () => {
    setBusy(true);
    if (suggestionId) await dismissChatGraphSuggestionAction(suggestionId);
    setBusy(false);
    onDismissed();
  };

  return (
    <div className="mt-2 rounded-xl border border-violet-400/30 bg-violet-950/15 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-violet-300/70">
        Suggested additions
      </p>

      {changes.nodes.length > 0 && (
        <ul className="space-y-1.5">
          {changes.nodes.map((n, i) => (
            <li key={`n-${i}`} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={nodeChecked[i]}
                onChange={(e) =>
                  setNodeChecked((prev) =>
                    prev.map((v, j) => (j === i ? e.target.checked : v)),
                  )
                }
                className="mt-0.5 accent-violet-400"
              />
              <div className="min-w-0">
                <p className="text-xs font-medium text-neutral-200">
                  {n.title}
                  <span className="ml-1 text-[10px] text-neutral-500">[{n.category}]</span>
                </p>
                <p className="line-clamp-2 text-[11px] text-neutral-400">{n.summary}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {changes.edges.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-violet-400/20 pt-2">
          {changes.edges.map((e, i) => (
            <li key={`e-${i}`} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={edgeChecked[i]}
                onChange={(ev) =>
                  setEdgeChecked((prev) =>
                    prev.map((v, j) => (j === i ? ev.target.checked : v)),
                  )
                }
                className="mt-0.5 accent-violet-400"
              />
              <p className="text-[11px] text-neutral-300">
                {e.source_title}{" "}
                <span className="text-violet-300">--[{e.relationship_type}]--&gt;</span>{" "}
                {e.target_title}
              </p>
            </li>
          ))}
        </ul>
      )}

      {cardError && <p className="mt-2 text-[11px] text-red-400">{cardError}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => apply(true)}
          disabled={busy}
          className="rounded-full bg-violet-400 px-3 py-1 text-[11px] font-medium text-canvas-bg hover:bg-violet-300 disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add all"}
        </button>
        <button
          type="button"
          onClick={() => apply(false)}
          disabled={busy}
          className="rounded-full border border-violet-400/40 px-3 py-1 text-[11px] font-medium text-violet-200 hover:bg-violet-950/40 disabled:opacity-40"
        >
          Add selected
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="rounded-full px-3 py-1 text-[11px] text-neutral-400 hover:text-neutral-200 disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
