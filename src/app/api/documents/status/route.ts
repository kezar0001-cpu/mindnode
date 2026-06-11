import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Lightweight progress endpoint for the upload sheet: the client sends a
// self-generated upload_token with the (long, synchronous) upload POST and
// polls this in parallel to read the document's real processing status as
// the route advances it through extracting → extracted → processing.
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const token = new URL(req.url).searchParams.get("token");
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "token is required." },
        { status: 400 },
      );
    }

    const { data } = await supabase
      .from("source_documents")
      .select(
        "id, status, section_count, chunk_count, nodes_created, edges_created",
      )
      .eq("user_id", user.id)
      .eq("metadata->>upload_token", token)
      .maybeSingle();

    if (!data) {
      // The row may not exist yet (client polls before the insert lands).
      return NextResponse.json({ ok: true, status: null });
    }

    return NextResponse.json({
      ok: true,
      document_id: data.id,
      status: data.status,
      section_count: data.section_count,
      chunk_count: data.chunk_count,
      nodes_created: data.nodes_created,
      edges_created: data.edges_created,
    });
  } catch (err) {
    console.error("Document status route failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not load status." },
      { status: 500 },
    );
  }
}
