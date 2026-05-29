import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SUPPORTED_MIME_TYPES,
  extractTextFromFile,
} from "@/lib/documents/extract";
import { chunkSections } from "@/lib/documents/chunk";
import { parseDocumentStructure } from "@/lib/documents/structure";
import { processDocumentGraph } from "@/lib/documents/process";

// Node runtime — pdf-parse and mammoth are Node-only. force-dynamic so
// auth cookies are read fresh on every request. maxDuration lifted to 60s
// for large AI batches.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const SUPPORTED_EXTENSIONS = new Set(["txt", "md", "pdf", "docx"]);

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function getExt(filename: string): string {
  const dot = filename.toLowerCase().lastIndexOf(".");
  return dot < 0 ? "" : filename.toLowerCase().slice(dot + 1);
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

export async function POST(req: Request) {
  let documentId: string | null = null;
  let supabaseRef: Awaited<ReturnType<typeof createSupabaseServerClient>> | null =
    null;

  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();
    supabaseRef = supabase;

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return fail("Could not read upload.");
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return fail("No file uploaded.");
    }
    if (file.size === 0) {
      return fail("File is empty.");
    }
    if (file.size > MAX_BYTES) {
      return fail("File is too large. Maximum 10MB.");
    }

    const ext = getExt(file.name);
    if (ext === "doc") {
      return fail("Please convert .doc files to .docx for now.");
    }
    const mimeOk =
      SUPPORTED_MIME_TYPES.includes(
        file.type as (typeof SUPPORTED_MIME_TYPES)[number],
      ) || SUPPORTED_EXTENSIONS.has(ext);
    if (!mimeOk) {
      return fail("Unsupported file type. Use .txt, .md, .pdf, or .docx.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 1. Create source_documents row.
    const safeName = safeFilename(file.name) || `upload.${ext || "bin"}`;
    const { data: insertedDoc, error: insertErr } = await supabase
      .from("source_documents")
      .insert({
        user_id: user.id,
        filename: safeName,
        original_filename: file.name,
        mime_type: file.type || "application/octet-stream",
        file_size_bytes: file.size,
        storage_path: "",
        status: "uploaded",
      })
      .select("id")
      .single();
    if (insertErr || !insertedDoc) {
      console.error("Failed to insert source_document:", insertErr?.message);
      return fail("Could not record upload. Please try again.", 500);
    }
    documentId = insertedDoc.id;

    const storagePath = `${user.id}/${documentId}/${safeName}`;

    // 2. Upload to private storage bucket.
    const { error: uploadErr } = await supabase.storage
      .from("mindnode-documents")
      .upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadErr) {
      console.error("Storage upload failed:", uploadErr.message);
      await supabase
        .from("source_documents")
        .update({
          status: "failed",
          error_message: `Storage upload failed: ${uploadErr.message}`,
        })
        .eq("id", documentId)
        .eq("user_id", user.id);
      return fail("Could not store file. Please try again.", 500);
    }

    await supabase
      .from("source_documents")
      .update({ status: "extracting", storage_path: storagePath })
      .eq("id", documentId)
      .eq("user_id", user.id);

    // 3. Extract text.
    const extraction = await extractTextFromFile({
      buffer,
      filename: file.name,
      mimeType: file.type || "",
    });
    if ("error" in extraction) {
      await supabase
        .from("source_documents")
        .update({ status: "failed", error_message: extraction.error })
        .eq("id", documentId)
        .eq("user_id", user.id);
      return fail(extraction.error);
    }

    const safeMetadata = JSON.parse(JSON.stringify(extraction.metadata));
    await supabase
      .from("source_documents")
      .update({
        status: "extracted",
        extracted_text: extraction.text,
        text_char_count: extraction.text.length,
        metadata: safeMetadata,
      })
      .eq("id", documentId)
      .eq("user_id", user.id);

    // 4. Parse structure → sections, then chunk per section.
    const { document_title, sections } = parseDocumentStructure(extraction.text);
    if (sections.length === 0) {
      await supabase
        .from("source_documents")
        .update({
          status: "failed",
          error_message: "No usable content found in document.",
        })
        .eq("id", documentId)
        .eq("user_id", user.id);
      return fail("No usable content found in document.");
    }

    const chunks = chunkSections(sections);
    if (chunks.length === 0) {
      await supabase
        .from("source_documents")
        .update({
          status: "failed",
          error_message: "No usable content after chunking.",
        })
        .eq("id", documentId)
        .eq("user_id", user.id);
      return fail("No usable content found in document.");
    }

    // 5. Mark processing and record section/chunk counts up-front.
    await supabase
      .from("source_documents")
      .update({
        status: "processing",
        section_count: sections.length,
        chunk_count: chunks.length,
      })
      .eq("id", documentId)
      .eq("user_id", user.id);

    // 6. Two-pass graph extraction (sections + chunks written inside).
    const result = await processDocumentGraph({
      documentId,
      userId: user.id,
      filename: file.name,
      documentTitle: document_title,
      sections,
      chunks,
    });

    const warnings = result.warnings;
    const finalStatus = warnings.length > 0 ? "processed_with_warnings" : "processed";
    await supabase
      .from("source_documents")
      .update({
        status: finalStatus,
        document_root_node_id: result.document_root_node_id,
        nodes_created: result.nodes_created,
        edges_created: result.edges_created,
        diagnostics: JSON.parse(JSON.stringify(result.diagnostics)),
        warnings: warnings,
      })
      .eq("id", documentId)
      .eq("user_id", user.id);

    revalidatePath("/");

    return NextResponse.json({
      ok: true,
      document_id: documentId,
      section_count: result.section_count,
      chunk_count: result.chunk_count,
      nodes_created: result.nodes_created,
      edges_created: result.edges_created,
      notes_created: result.notes_created,
      warnings_count: warnings.length,
      status: finalStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Document upload pipeline failed:", err);
    if (documentId && supabaseRef) {
      await supabaseRef
        .from("source_documents")
        .update({ status: "failed", error_message: message })
        .eq("id", documentId);
    }
    return NextResponse.json(
      { ok: false, error: "Could not process the document." },
      { status: 500 },
    );
  }
}
