import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveChatContext, type RetrievedContext } from "@/lib/chat/retrieval";
import { generateChatResponse } from "@/lib/ai/chat";
import { generateConversationSummary } from "@/lib/ai/chat-summary";
import {
  syncChunkEmbeddings,
  syncNodeEmbeddings,
} from "@/lib/ai/embedding-sync";
import {
  getLatestConversationId,
  listMessages,
  listPendingSuggestions,
} from "@/lib/chat/queries";
import type { ChatCitation, ChatMode } from "@/types";

export const dynamic = "force-dynamic";

const VALID_MODES: ChatMode[] = [
  "global",
  "node_focus",
  "document_focus",
  "graph_review",
  "plan",
];

type ChatBody = {
  message?: string;
  selected_node_id?: string;
  conversation_id?: string;
  mode?: ChatMode;
  // Retry of a turn whose user message is already persisted: regenerate the
  // assistant response for the conversation's last user message instead of
  // inserting a duplicate user turn.
  retry?: boolean;
};

// Attach node/document ids to AI citations by matching their labels against
// the retrieved context, so the UI can make them tappable. Loose contains
// matching in both directions tolerates the model shortening labels.
function resolveCitations(
  citations: ChatCitation[],
  context: RetrievedContext,
): ChatCitation[] {
  const contextNodes = [
    ...(context.selectedNode ? [context.selectedNode] : []),
    ...context.neighborNodes,
    ...context.relevantNodes,
  ];
  const labelMatches = (label: string, candidate: string) => {
    const a = label.toLowerCase().trim();
    const b = candidate.toLowerCase().trim();
    return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
  };
  return citations.map((c) => {
    if (c.type === "node") {
      const match = contextNodes.find((n) => labelMatches(c.label, n.title));
      return match ? { ...c, node_id: match.id } : c;
    }
    const match = context.chunks.find((ch) => labelMatches(c.label, ch.filename));
    if (!match) return c;
    return {
      ...c,
      document_id: match.document_id,
      node_id: match.document_root_node_id ?? undefined,
    };
  });
}

// GET — hydrate the chat panel with the latest conversation, its messages,
// and any still-pending graph suggestions. Always returns JSON.
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const url = new URL(req.url);
    const requested = url.searchParams.get("conversation_id");

    let conversationId = requested;
    if (conversationId) {
      const { data: owned } = await supabase
        .from("chat_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!owned) conversationId = null;
    }
    if (!conversationId) {
      conversationId = await getLatestConversationId(supabase, user.id);
    }

    if (!conversationId) {
      return NextResponse.json({
        ok: true,
        conversation_id: null,
        messages: [],
        pending_suggestions: [],
      });
    }

    const [messages, pending] = await Promise.all([
      listMessages(supabase, user.id, conversationId),
      listPendingSuggestions(supabase, user.id, conversationId),
    ]);

    return NextResponse.json({
      ok: true,
      conversation_id: conversationId,
      messages,
      pending_suggestions: pending,
    });
  } catch (err) {
    console.error("Chat GET failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not load conversation." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const body = (await req.json().catch(() => ({}))) as ChatBody;
    const isRetry = body.retry === true;
    let message = (body.message ?? "").trim();
    if (!message && !isRetry) {
      return NextResponse.json(
        { ok: false, error: "Message is required." },
        { status: 400 },
      );
    }
    if (message.length > 4000) {
      return NextResponse.json(
        { ok: false, error: "Message is too long." },
        { status: 400 },
      );
    }
    if (isRetry && !body.conversation_id) {
      return NextResponse.json(
        { ok: false, error: "conversation_id is required to retry." },
        { status: 400 },
      );
    }

    const mode: ChatMode = VALID_MODES.includes(body.mode as ChatMode)
      ? (body.mode as ChatMode)
      : body.selected_node_id
        ? "node_focus"
        : "global";

    // Resolve (or create) the conversation, keeping its rolling summary.
    let conversationId = body.conversation_id ?? null;
    let previousSummary: string | null = null;
    if (conversationId) {
      const { data: owned } = await supabase
        .from("chat_conversations")
        .select("id, summary")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!owned) conversationId = null;
      else previousSummary = owned.summary ?? null;
    }
    if (isRetry && !conversationId) {
      return NextResponse.json(
        { ok: false, error: "Conversation not found." },
        { status: 404 },
      );
    }
    if (!conversationId) {
      const { data: created, error } = await supabase
        .from("chat_conversations")
        .insert({
          user_id: user.id,
          title: message.slice(0, 60),
        })
        .select("id")
        .single();
      if (error || !created) {
        return NextResponse.json(
          { ok: false, error: "Could not start conversation." },
          { status: 500 },
        );
      }
      conversationId = created.id;
    }

    // Prior turns for continuity (oldest first, trimmed to the last 8).
    const priorMessages = await listMessages(supabase, user.id, conversationId);

    // On retry, regenerate for the conversation's last persisted user turn —
    // it must not appear in history too, since it's passed as `message`.
    let historySource = priorMessages;
    if (isRetry) {
      const lastUserIndex = priorMessages.map((m) => m.role).lastIndexOf("user");
      if (lastUserIndex === -1) {
        return NextResponse.json(
          { ok: false, error: "Nothing to retry." },
          { status: 400 },
        );
      }
      message = priorMessages[lastUserIndex].content;
      historySource = priorMessages.slice(0, lastUserIndex);
    }
    const history = historySource
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));

    // Persist the user turn before generation, so a provider failure can
    // never lose what the user typed. Retries skip this — their user turn
    // is already stored.
    if (!isRetry) {
      const { error: userInsertError } = await supabase
        .from("chat_messages")
        .insert({
          conversation_id: conversationId,
          user_id: user.id,
          role: "user",
          content: message,
          used_context_json: {
            selected_node_id: body.selected_node_id ?? null,
            mode,
          },
        });
      if (userInsertError) {
        return NextResponse.json(
          { ok: false, error: "Could not save your message." },
          { status: 500 },
        );
      }
    }

    // Opportunistic embedding backfill: covers nodes/chunks created before
    // embeddings existed or while the provider was unavailable. Capped and
    // best-effort so it never blocks the chat for long.
    await Promise.all([
      syncNodeEmbeddings(supabase, user.id, { limit: 64 }),
      syncChunkEmbeddings(supabase, user.id, { limit: 64 }),
    ]).catch((err) => {
      console.error("Embedding backfill failed:", err);
    });

    // Retrieve grounding context (hybrid vector + keyword).
    const context = await retrieveChatContext(supabase, user.id, {
      query: message,
      selectedNodeId: body.selected_node_id,
      excludeConversationId: conversationId,
    });

    // Generate the grounded answer. The user turn is already persisted, so a
    // failure here is retryable without retyping or duplicating the message.
    const result = await generateChatResponse({ message, context, mode, history });
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          conversation_id: conversationId,
          user_message_persisted: true,
        },
        { status: 502 },
      );
    }
    const { answer, citations, proposed_graph_changes, follow_up_topics } =
      result.response;
    const resolvedCitations = resolveCitations(citations, context);

    const usedNodes = [
      ...(context.selectedNode
        ? [{ id: context.selectedNode.id, title: context.selectedNode.title }]
        : []),
      ...context.neighborNodes.map((n) => ({ id: n.id, title: n.title })),
      ...context.relevantNodes.map((n) => ({ id: n.id, title: n.title })),
    ];
    const seenDocs = new Set<string>();
    const usedSources: {
      document_id: string;
      filename: string;
      root_node_id: string | null;
    }[] = [];
    for (const c of context.chunks) {
      if (seenDocs.has(c.document_id)) continue;
      seenDocs.add(c.document_id);
      usedSources.push({
        document_id: c.document_id,
        filename: c.filename,
        root_node_id: c.document_root_node_id,
      });
    }

    // Persist the assistant turn (the user turn was stored before generation).
    const { data: assistantMsg } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "assistant",
        content: answer,
        citations_json: resolvedCitations,
        used_context_json: { used_nodes: usedNodes, used_sources: usedSources },
      })
      .select("id")
      .single();

    // Refresh the rolling summary (chat memory) and bump the conversation.
    // Summary failure is non-fatal — the turn is already persisted.
    const updatedSummary = await generateConversationSummary({
      previousSummary,
      userMessage: message,
      assistantAnswer: answer,
    });
    await supabase
      .from("chat_conversations")
      .update({
        updated_at: new Date().toISOString(),
        ...(updatedSummary ? { summary: updatedSummary } : {}),
      })
      .eq("id", conversationId)
      .eq("user_id", user.id);

    // Persist proposed graph changes as a pending suggestion (never auto-applied).
    let suggestionId: string | null = null;
    const hasChanges =
      proposed_graph_changes &&
      ((proposed_graph_changes.nodes?.length ?? 0) > 0 ||
        (proposed_graph_changes.edges?.length ?? 0) > 0);
    if (hasChanges) {
      const { data: suggestion } = await supabase
        .from("chat_graph_suggestions")
        .insert({
          conversation_id: conversationId,
          message_id: assistantMsg?.id ?? null,
          user_id: user.id,
          suggestion_json: proposed_graph_changes,
          status: "pending",
        })
        .select("id")
        .single();
      suggestionId = suggestion?.id ?? null;
    }

    return NextResponse.json({
      ok: true,
      conversation_id: conversationId,
      answer,
      citations: resolvedCitations,
      used_nodes: usedNodes,
      used_sources: usedSources,
      retrieval_mode: context.retrievalMode,
      follow_up_topics: follow_up_topics ?? [],
      proposed_graph_changes: hasChanges
        ? { ...proposed_graph_changes, suggestion_id: suggestionId }
        : undefined,
    });
  } catch (err) {
    console.error("Chat POST failed:", err);
    return NextResponse.json(
      { ok: false, error: "Chat failed." },
      { status: 500 },
    );
  }
}
