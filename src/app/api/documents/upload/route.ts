import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/supabase/auth";
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

type UploadStatus = "processed" | "processed_with_warnings" | "failed";

type UploadResponse = {
  ok: boolean;
  document_id?: string;
  section_count: number;
  chunk_count: number;
  nodes_created: number;
  edges_created: number;
  notes_created: number;
  warnings_count: number;
  warnings: string[];
  status: UploadStatus;
  error?: string;
};

function logUpload(stage: string, details: Record<string, unknown> = {}) {
  console.info(`[documents/upload] ${stage}`, details);
}

function jsonResponse(payload: UploadResponse, init?: ResponseInit) {
  logUpload("final JSON response", {
    httpStatus: init?.status ?? 200,
    documentId: payload.document_id,
    ok: payload.ok,
    status: payload.status,
    sections: payload.section_count,
    chunks: payload.chunk_count,
    nodes: payload.nodes_created,
    edges: payload.edges_created,
    warnings: payload.warnings_count,
    error: payload.error,
  });
  return NextResponse.json(payload, init);
}

function fail(error: string, status = 400, documentId?: string | null) {
  return jsonResponse(
    {
      ok: false,
      document_id: documentId ?? undefined,
      section_count: 0,
      chunk_count: 0,
      nodes_created: 0,
      edges_created: 0,
      notes_created: 0,
      warnings_count: 0,
      warnings: [],
      status: "failed",
      error,
    },
    { status },
  );
}

function getExt(filename: string): string {
  const dot = filename.toLowerCase().lastIndexOf(".");
  return dot < 0 ? "" : filename.toLowerCase().slice(dot + 1);
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

async function summarizePartialDocument(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  documentId: string,
) {
  const { data: document } = await supabase
    .from("source_documents")
    .select("document_root_node_id, section_count, chunk_count")
    .eq("id", documentId)
    .maybeSingle();
  const { count: sectionNodeCount } = await supabase
    .from("document_sections")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .not("node_id", "is", null);
  const { count: noteCount } = await supabase
    .from("document_notes")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId);

  const nodesCreated =
    (document?.document_root_node_id ? 1 : 0) +
    (sectionNodeCount ?? 0) +
    (noteCount ?? 0);

  return {
    section_count: document?.section_count ?? 0,
    chunk_count: document?.chunk_count ?? 0,
    nodes_created: nodesCreated,
    edges_created: 0,
    notes_created: noteCount ?? 0,
  };
}

export async function POST(req: Request) {
  let documentId: string | null = null;
  let supabaseRef: Awaited<
    ReturnType<typeof createSupabaseServerClient>
  > | null = null;

  try {
    const user = await getCurrentUser();
    if (!user) {
      return fail("Please sign in before uploading a document.", 401);
    }
    const supabase = await createSupabaseServerClient();
    supabaseRef = supabase;
    logUpload("request accepted", { userId: user.id });

    logUpload("reading multipart form data");
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

    logUpload("validated uploaded file", {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: file.size,
      extension: ext,
    });

    const buffer = Buffer.from(await file.arrayBuffer());

    // 1. Create source_documents row.
    const safeName = safeFilename(file.name) || `upload.${ext || "bin"}`;
    logUpload("creating source_documents row", { filename: file.name });
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
    logUpload("source_documents row created", { documentId });

    const storagePath = `${user.id}/${documentId}/${safeName}`;

    // 2. Upload to private storage bucket.
    logUpload("uploading file to storage", { documentId, storagePath });
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

    logUpload("storage upload completed", { documentId, storagePath });
    await supabase
      .from("source_documents")
      .update({ status: "extracting", storage_path: storagePath })
      .eq("id", documentId)
      .eq("user_id", user.id);

    // 3. Extract text.
    logUpload("starting text extraction", { documentId });
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

    logUpload("text extraction completed", {
      documentId,
      characters: extraction.text.length,
      metadata: extraction.metadata,
    });
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
    logUpload("parsing document sections", { documentId });
    const { document_title, sections } = parseDocumentStructure(
      extraction.text,
    );
    logUpload("section parsing completed", {
      documentId,
      documentTitle: document_title,
      sections: sections.length,
    });
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

    logUpload("chunking document sections", {
      documentId,
      sections: sections.length,
    });
    const chunks = chunkSections(sections);
    logUpload("chunking completed", { documentId, chunks: chunks.length });
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
    logUpload("marking document as processing", {
      documentId,
      sections: sections.length,
      chunks: chunks.length,
    });
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
    logUpload("starting graph processing", {
      documentId,
      sections: sections.length,
      chunks: chunks.length,
    });
    const result = await processDocumentGraph({
      documentId,
      userId: user.id,
      filename: file.name,
      documentTitle: document_title,
      sections,
      chunks,
    });

    logUpload("graph processing completed", {
      documentId,
      sections: result.section_count,
      chunks: result.chunk_count,
      nodes: result.nodes_created,
      edges: result.edges_created,
      notes: result.notes_created,
      warnings: result.warnings.length,
    });

    const warnings = [...result.warnings];
    let finalStatus: Exclude<UploadStatus, "failed"> =
      warnings.length > 0 ? "processed_with_warnings" : "processed";

    logUpload("updating final document status", { documentId, finalStatus });
    const { error: finalStatusErr } = await supabase
      .from("source_documents")
      .update({
        status: finalStatus,
        document_root_node_id: result.document_root_node_id,
        nodes_created: result.nodes_created,
        edges_created: result.edges_created,
        diagnostics: JSON.parse(JSON.stringify(result.diagnostics)),
        warnings,
        error_message: null,
      })
      .eq("id", documentId)
      .eq("user_id", user.id);

    if (finalStatusErr) {
      warnings.push(`Final status update failed: ${finalStatusErr.message}`);
      finalStatus = "processed_with_warnings";
      logUpload("final status update failed after graph success", {
        documentId,
        error: finalStatusErr.message,
      });
      await supabase
        .from("source_documents")
        .update({
          status: finalStatus,
          document_root_node_id: result.document_root_node_id,
          nodes_created: result.nodes_created,
          edges_created: result.edges_created,
          diagnostics: JSON.parse(JSON.stringify(result.diagnostics)),
          warnings,
          error_message: warnings.join("\n"),
        })
        .eq("id", documentId)
        .eq("user_id", user.id);
    }

    try {
      revalidatePath("/");
    } catch (revalidateErr) {
      const revalidateMessage =
        revalidateErr instanceof Error
          ? revalidateErr.message
          : "Unknown revalidation error";
      warnings.push(`Graph refresh revalidation failed: ${revalidateMessage}`);
      finalStatus = "processed_with_warnings";
      logUpload("non-critical revalidation failed after graph success", {
        documentId,
        error: revalidateMessage,
      });
      await supabase
        .from("source_documents")
        .update({
          status: finalStatus,
          warnings,
          error_message: warnings.join("\n"),
        })
        .eq("id", documentId)
        .eq("user_id", user.id);
    }

    logUpload("final status update completed", { documentId, finalStatus });
    return jsonResponse({
      ok: true,
      document_id: documentId,
      section_count: result.section_count,
      chunk_count: result.chunk_count,
      nodes_created: result.nodes_created,
      edges_created: result.edges_created,
      notes_created: result.notes_created,
      warnings_count: warnings.length,
      warnings,
      status: finalStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[documents/upload] pipeline failed", {
      documentId,
      error: err,
    });
    if (documentId && supabaseRef) {
      try {
        const partial = await summarizePartialDocument(supabaseRef, documentId);
        if (partial.nodes_created > 0) {
          const warnings = [
            `Processing stopped after creating graph data: ${message}`,
          ];
          logUpload(
            "marking partial graph success as processed_with_warnings",
            {
              documentId,
              ...partial,
            },
          );
          await supabaseRef
            .from("source_documents")
            .update({
              status: "processed_with_warnings",
              error_message: warnings.join("\n"),
              warnings,
              section_count: partial.section_count,
              chunk_count: partial.chunk_count,
              nodes_created: partial.nodes_created,
              edges_created: partial.edges_created,
            })
            .eq("id", documentId);
          return jsonResponse({
            ok: true,
            document_id: documentId,
            section_count: partial.section_count,
            chunk_count: partial.chunk_count,
            nodes_created: partial.nodes_created,
            edges_created: partial.edges_created,
            notes_created: partial.notes_created,
            warnings_count: warnings.length,
            warnings,
            status: "processed_with_warnings",
          });
        }

        logUpload("marking document as failed", { documentId, error: message });
        await supabaseRef
          .from("source_documents")
          .update({ status: "failed", error_message: message })
          .eq("id", documentId);
      } catch (cleanupErr) {
        console.error("[documents/upload] failed to update error status", {
          documentId,
          error: cleanupErr,
        });
      }
    }
    return fail("Could not process the document.", 500, documentId);
  }
}
