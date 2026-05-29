import "server-only";

import mammoth from "mammoth";
// pdf-parse's index has debug code that explodes on cold start under Next.js,
// so we import the inner module path directly. See src/types/pdf-parse.d.ts.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const MAX_EXTRACT_CHARS = 250_000;

export const SUPPORTED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type ExtractResult = {
  text: string;
  metadata: Record<string, unknown>;
};

export type ExtractError = { error: string };

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getExtension(filename: string): string {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "";
  return lower.slice(dot + 1);
}

async function extractTxt(buffer: Buffer): Promise<ExtractResult | ExtractError> {
  try {
    const text = new TextDecoder("utf-8").decode(buffer);
    return { text, metadata: {} };
  } catch {
    return { error: "Failed to extract text from this file." };
  }
}

async function extractPdf(buffer: Buffer): Promise<ExtractResult | ExtractError> {
  try {
    const data = await pdfParse(buffer);
    return {
      text: typeof data.text === "string" ? data.text : "",
      metadata: { pages: data.numpages },
    };
  } catch {
    return { error: "Failed to extract PDF text." };
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractResult | ExtractError> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: result.value ?? "",
      metadata: { messages: result.messages?.length ?? 0 },
    };
  } catch {
    return { error: "Failed to extract docx text." };
  }
}

export async function extractTextFromFile(input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<ExtractResult | ExtractError> {
  const ext = getExtension(input.filename);
  const mime = input.mimeType.toLowerCase();

  // Friendly bounce for legacy .doc binary format.
  if (ext === "doc" && mime !== "application/pdf") {
    return { error: "Please convert .doc files to .docx for now." };
  }

  let raw: ExtractResult | ExtractError;
  if (
    ext === "txt" ||
    ext === "md" ||
    mime === "text/plain" ||
    mime === "text/markdown"
  ) {
    raw = await extractTxt(input.buffer);
  } else if (ext === "pdf" || mime === "application/pdf") {
    raw = await extractPdf(input.buffer);
  } else if (
    ext === "docx" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    raw = await extractDocx(input.buffer);
  } else {
    return { error: "Unsupported file type. Use .txt, .md, .pdf, or .docx." };
  }

  if ("error" in raw) return raw;

  let text = normalize(raw.text);
  const metadata: Record<string, unknown> = { ...raw.metadata };

  if (text.length === 0) {
    return {
      error: "No extractable text found. OCR support will be added later.",
    };
  }

  if (text.length > MAX_EXTRACT_CHARS) {
    text = text.slice(0, MAX_EXTRACT_CHARS);
    metadata.truncated = true;
    metadata.max_chars = MAX_EXTRACT_CHARS;
  }

  return { text, metadata };
}
