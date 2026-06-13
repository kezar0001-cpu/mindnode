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
  // Suggested next explorations (NotebookLM-style), tappable to continue.
  followUps?: string[];
  // Set on a user turn that got no assistant response. `persisted` tells the
  // retry whether the server already stored the turn (regenerate) or not
  // (re-send the text).
  failed?: { persisted: boolean; mode: ChatMode };
};

type ChatPanelProps = {
  open: boolean;
  onClose: () => void;
  focusNode: { id: string; title: string } | null;
  onClearFocus: () => void;
  starter: { prompt: string; nonce: number } | null;
  // Optional hook for after a suggestion is applied. The apply action
  // revalidates the route itself, so no explicit refresh is needed here.
  onApplied?: () => void;
  // Tapping a resolved citation closes the chat and focuses that node.
  onFocusNode?: (nodeId: string) => void;
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
  onFocusNode,
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

  // Escape closes the panel unless the user is typing in the composer.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Keep the conversation scrolled to the newest message.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [messages, open]);

  // Core request runner — used by both fresh sends and retries of a failed
  // turn. `retryPersisted` regenerates the assistant response for a user
  // turn the server already stored, so retrying never duplicates it.
  const deliver = useCallback(
    async (opts: {
      msgId: string;
      mode: ChatMode;
      text?: string;
      retryPersisted?: boolean;
    }) => {
      setSending(true);
      setError(null);
      setMessages((prev) =>
        prev.map((m) => (m.id === opts.msgId ? { ...m, failed: undefined } : m)),
      );

      const markFailed = (persisted: boolean) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === opts.msgId
              ? { ...m, failed: { persisted, mode: opts.mode } }
              : m,
          ),
        );
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            opts.retryPersisted
              ? {
                  retry: true,
                  selected_node_id: focusNode?.id,
                  conversation_id: conversationId,
                  mode: opts.mode,
                }
              : {
                  message: opts.text,
                  selected_node_id: focusNode?.id,
                  conversation_id: conversationId,
                  mode: opts.mode,
                },
          ),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          if (json.conversation_id) setConversationId(json.conversation_id);
          markFailed(
            json.user_message_persisted === true || opts.retryPersisted === true,
          );
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
          followUps: Array.isArray(json.follow_up_topics)
            ? (json.follow_up_topics as string[])
            : [],
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        markFailed(opts.retryPersisted === true);
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setSending(false);
      }
    },
    [focusNode, conversationId],
  );

  const send = useCallback(
    async (modeOverride?: ChatMode, overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || sending) return;

      const mode: ChatMode = modeOverride ?? (focusNode ? "node_focus" : "global");
      const msgId = localId();
      setMessages((prev) => [
        ...prev,
        { id: msgId, role: "user", content: text, citations: [] },
      ]);
      setInput("");
      await deliver({ msgId, mode, text });
    },
    [input, sending, focusNode, deliver],
  );

  const retryMessage = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg?.failed || sending) return;
      void deliver({
        msgId: messageId,
        mode: msg.failed.mode,
        text: msg.content,
        retryPersisted: msg.failed.persisted,
      });
    },
    [messages, sending, deliver],
  );

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

  const lastMessageId = messages[messages.length - 1]?.id;

  return (
    <>
      {/* No dimming backdrop — the 3D network stays visible and alive behind
          a translucent panel, so chat feels part of the same space. Always
          anchored to the bottom, on every screen size, for a predictable home. */}
      <div
        className={[
          "fixed inset-x-0 bottom-0 z-50 mx-auto flex h-[60vh] flex-col",
          "bg-canvas-surface/90 backdrop-blur-xl",
          "rounded-t-2xl border-t border-canvas-border/70 shadow-2xl shadow-black/40",
          // Constrain and centre on wide screens so it doesn't stretch edge-to-edge.
          "lg:max-w-2xl lg:rounded-t-3xl lg:border-x",
        ].join(" ")}
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
            <div className="mt-2 space-y-3">
              <p className="text-sm text-neutral-300">
                {focusNode
                  ? `Let's think about "${focusNode.title}".`
                  : "I can see your whole network. What do you want to explore?"}
              </p>
              <div className="space-y-1.5">
                {(focusNode
                  ? [
                      `What connects to "${focusNode.title}"?`,
                      `What am I missing about "${focusNode.title}"?`,
                      `Where could "${focusNode.title}" lead next?`,
                    ]
                  : [
                      "What themes connect my recent thoughts?",
                      "What ideas seem isolated and worth linking?",
                      "What should I explore next?",
                    ]
                ).map((t, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => send(undefined, t)}
                    className="flex w-full items-center gap-2 rounded-xl border border-teal-400/25 bg-teal-950/15 px-3 py-2 text-left text-xs text-teal-100 transition-colors hover:bg-teal-950/35"
                  >
                    <span className="text-teal-400">→</span>
                    <span>{t}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id}>
              <MessageBubble message={m} onFocusNode={onFocusNode} />
              {m.role === "user" && m.failed && (
                <div className="mt-1 flex items-center justify-end gap-2 text-[11px]">
                  <span className="text-red-300">
                    {m.failed.persisted
                      ? "No response — your message is saved."
                      : "Message didn’t send."}
                  </span>
                  <button
                    type="button"
                    onClick={() => retryMessage(m.id)}
                    disabled={sending}
                    className="rounded-full border border-red-400/40 px-2.5 py-0.5 font-medium text-red-200 hover:bg-red-950/40 disabled:opacity-40"
                  >
                    Retry
                  </button>
                </div>
              )}
              {m.role === "assistant" && m.suggestion && (
                <SuggestionCard
                  suggestion={m.suggestion}
                  onApplied={() => {
                    updateSuggestionStatus(m.id, "applied");
                    onApplied?.();
                  }}
                  onDismissed={() => updateSuggestionStatus(m.id, "dismissed")}
                />
              )}
              {m.role === "assistant" &&
                m.id === lastMessageId &&
                !sending &&
                (m.followUps?.length ?? 0) > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                      Explore next
                    </p>
                    {m.followUps!.map((t, i) => (
                      <button
                        key={i}
                        type="button"
                        disabled={sending}
                        onClick={() => send(undefined, t)}
                        className="flex w-full items-center gap-2 rounded-xl border border-teal-400/25 bg-teal-950/15 px-3 py-2 text-left text-xs text-teal-100 transition-colors hover:bg-teal-950/35 disabled:opacity-40"
                      >
                        <span className="text-teal-400">→</span>
                        <span>{t}</span>
                      </button>
                    ))}
                  </div>
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
          {/* Mode quick actions */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={sending}
              onClick={() =>
                send(
                  "plan",
                  input.trim() ||
                    (focusNode
                      ? `Develop a staged plan for "${focusNode.title}".`
                      : "Develop a staged plan from my graph and goals."),
                )
              }
              className="rounded-full border border-amber-400/40 bg-amber-950/30 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-950/50 disabled:opacity-40"
            >
              ◇ Develop a plan
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() =>
                send(
                  "graph_review",
                  input.trim() ||
                    "Review my graph and surface avenues I may have missed.",
                )
              }
              className="rounded-full border border-teal-400/40 bg-teal-950/30 px-2.5 py-1 text-[11px] font-medium text-teal-200 hover:bg-teal-950/50 disabled:opacity-40"
            >
              ✦ Find missed avenues
            </button>
          </div>
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
              onClick={() => send()}
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

function MessageBubble({
  message,
  onFocusNode,
}: {
  message: UiMessage;
  onFocusNode?: (nodeId: string) => void;
}) {
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
            {message.citations.map((c, i) => {
              const className = [
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
                c.type === "source"
                  ? "border border-blue-400/40 bg-blue-950/30 text-blue-200"
                  : "border border-violet-400/40 bg-violet-950/30 text-violet-200",
              ].join(" ");
              const content = (
                <>
                  {c.type === "source" ? "📄" : "◆"} {c.label}
                </>
              );
              return c.node_id && onFocusNode ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => onFocusNode(c.node_id!)}
                  className={`${className} hover:brightness-125`}
                  title="Show on canvas"
                >
                  {content}
                </button>
              ) : (
                <span key={i} className={className} title={c.ref}>
                  {content}
                </span>
              );
            })}
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

  const isPlan = changes.is_plan === true;

  if (status === "applied") {
    return (
      <p className="mt-2 text-[11px] text-emerald-300">
        {isPlan ? "✓ Plan added to your canvas." : "✓ Added to your canvas."}
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
          is_plan: changes.is_plan,
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
    <div
      className={[
        "mt-2 rounded-xl border p-3",
        isPlan
          ? "border-amber-400/30 bg-amber-950/15"
          : "border-violet-400/30 bg-violet-950/15",
      ].join(" ")}
    >
      <p
        className={[
          "mb-2 text-[10px] font-semibold uppercase tracking-wider",
          isPlan ? "text-amber-300/80" : "text-violet-300/70",
        ].join(" ")}
      >
        {isPlan ? "◇ Suggested plan" : "Suggested additions"}
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
          className={[
            "rounded-full px-3 py-1 text-[11px] font-medium text-canvas-bg disabled:opacity-40",
            isPlan
              ? "bg-amber-400 hover:bg-amber-300"
              : "bg-violet-400 hover:bg-violet-300",
          ].join(" ")}
        >
          {busy ? "Adding…" : isPlan ? "Add plan" : "Add all"}
        </button>
        <button
          type="button"
          onClick={() => apply(false)}
          disabled={busy}
          className={[
            "rounded-full border px-3 py-1 text-[11px] font-medium disabled:opacity-40",
            isPlan
              ? "border-amber-400/40 text-amber-200 hover:bg-amber-950/40"
              : "border-violet-400/40 text-violet-200 hover:bg-violet-950/40",
          ].join(" ")}
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
