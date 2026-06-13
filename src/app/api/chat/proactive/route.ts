import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveChatContext } from "@/lib/chat/retrieval";
import { generateProactiveResponse } from "@/lib/ai/chat";
import { getLatestConversationId } from "@/lib/chat/queries";

export const dynamic = "force-dynamic";

type ProactiveBody = {
  // A short description of what the user just did, e.g.
  // `added the thought "Pay off credit card debt"`.
  event?: string;
  selected_node_id?: string;
};

// The proactive companion: the user changed their graph on the canvas, and the
// AI reacts as an active guide — grounded in the full network — then persists
// the reaction to the latest conversation so it lives in the chat thread.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const body = (await req.json().catch(() => ({}))) as ProactiveBody;
    const event = (body.event ?? "").trim();
    if (!event) {
      return NextResponse.json(
        { ok: false, error: "event is required." },
        { status: 400 },
      );
    }

    // Use the most recent conversation, or start one so the nudge has a home.
    let conversationId = await getLatestConversationId(supabase, user.id);
    if (!conversationId) {
      const { data: created } = await supabase
        .from("chat_conversations")
        .insert({ user_id: user.id, title: "Companion" })
        .select("id")
        .single();
      conversationId = created?.id ?? null;
    }
    if (!conversationId) {
      return NextResponse.json(
        { ok: false, error: "Could not open a conversation." },
        { status: 500 },
      );
    }

    const context = await retrieveChatContext(supabase, user.id, {
      query: event,
      selectedNodeId: body.selected_node_id,
      excludeConversationId: conversationId,
    });

    const result = await generateProactiveResponse({ event, context });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 502 },
      );
    }

    const { answer, citations, proposed_graph_changes, follow_up_topics } =
      result.response;

    const { data: assistantMsg } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "assistant",
        content: answer,
        citations_json: citations,
        used_context_json: { proactive: true, event },
      })
      .select("id")
      .single();

    await supabase
      .from("chat_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", user.id);

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
      follow_up_topics: follow_up_topics ?? [],
      proposed_graph_changes: hasChanges
        ? { ...proposed_graph_changes, suggestion_id: suggestionId }
        : undefined,
    });
  } catch (err) {
    console.error("Proactive chat failed:", err);
    return NextResponse.json(
      { ok: false, error: "Proactive companion failed." },
      { status: 500 },
    );
  }
}
