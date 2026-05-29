import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveChatContext } from "@/lib/chat/retrieval";
import { generateChatResponse } from "@/lib/ai/chat";
import {
  getLatestConversationId,
  listMessages,
  listPendingSuggestions,
} from "@/lib/chat/queries";
import type { ChatMode } from "@/types";

export const dynamic = "force-dynamic";

const VALID_MODES: ChatMode[] = [
  "global",
  "node_focus",
  "document_focus",
  "graph_review",
];

type ChatBody = {
  message?: string;
  selected_node_id?: string;
  conversation_id?: string;
  mode?: ChatMode;
};

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
    const message = (body.message ?? "").trim();
    if (!message) {
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

    const mode: ChatMode = VALID_MODES.includes(body.mode as ChatMode)
      ? (body.mode as ChatMode)
      : body.selected_node_id
        ? "node_focus"
        : "global";

    // Resolve (or create) the conversation.
    let conversationId = body.conversation_id ?? null;
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
    const history = priorMessages
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));

    // Retrieve grounding context.
    const context = await retrieveChatContext(supabase, user.id, {
      query: message,
      selectedNodeId: body.selected_node_id,
    });

    // Generate the grounded answer.
    const result = await generateChatResponse({ message, context, mode, history });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    const { answer, citations, proposed_graph_changes } = result.response;

    const usedNodes = [
      ...(context.selectedNode
        ? [{ id: context.selectedNode.id, title: context.selectedNode.title }]
        : []),
      ...context.neighborNodes.map((n) => ({ id: n.id, title: n.title })),
      ...context.relevantNodes.map((n) => ({ id: n.id, title: n.title })),
    ];
    const seenDocs = new Set<string>();
    const usedSources: { document_id: string; filename: string }[] = [];
    for (const c of context.chunks) {
      if (seenDocs.has(c.document_id)) continue;
      seenDocs.add(c.document_id);
      usedSources.push({ document_id: c.document_id, filename: c.filename });
    }

    // Persist the user turn, then the assistant turn.
    await supabase.from("chat_messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: message,
      used_context_json: { selected_node_id: body.selected_node_id ?? null, mode },
    });

    const { data: assistantMsg } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "assistant",
        content: answer,
        citations_json: citations,
        used_context_json: { used_nodes: usedNodes, used_sources: usedSources },
      })
      .select("id")
      .single();

    // Touch the conversation so it sorts to the top.
    await supabase
      .from("chat_conversations")
      .update({ updated_at: new Date().toISOString() })
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
      citations,
      used_nodes: usedNodes,
      used_sources: usedSources,
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
