// Paragraph-aware chunker for document text. Pure function, no DB/IO.
// Greedy packing with a soft target and a hard ceiling. Hard cap of 30
// chunks per document for the MVP — long documents are truncated rather
// than blowing up the AI bill.

export type DocumentChunk = {
  content: string;
  token_estimate: number;
};

type ChunkOptions = {
  targetWords?: number;
  maxWords?: number;
};

const DEFAULT_TARGET = 1500;
const DEFAULT_MAX = 1800;
const HARD_CHUNK_CAP = 30;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function splitSentences(paragraph: string): string[] {
  // Split on sentence boundaries while keeping the punctuation attached.
  // Falls back to the whole paragraph if regex finds no boundaries.
  const parts = paragraph.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [paragraph.trim()];
}

function pushChunk(
  out: DocumentChunk[],
  buffer: string[],
  bufferWords: number,
): void {
  if (buffer.length === 0 || bufferWords === 0) return;
  const content = buffer.join("\n\n").trim();
  if (!content) return;
  out.push({
    content,
    token_estimate: Math.ceil(bufferWords * 1.3),
  });
}

export function chunkText(text: string, opts?: ChunkOptions): DocumentChunk[] {
  const targetWords = opts?.targetWords ?? DEFAULT_TARGET;
  const maxWords = opts?.maxWords ?? DEFAULT_MAX;

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: DocumentChunk[] = [];
  let buffer: string[] = [];
  let bufferWords = 0;

  const flushUnit = (unit: string) => {
    const w = countWords(unit);
    if (w === 0) return;

    // If a single unit alone exceeds maxWords, push current buffer then
    // emit the oversized unit as its own chunk.
    if (w > maxWords) {
      pushChunk(chunks, buffer, bufferWords);
      buffer = [];
      bufferWords = 0;
      chunks.push({ content: unit, token_estimate: Math.ceil(w * 1.3) });
      return;
    }

    if (bufferWords + w > maxWords) {
      pushChunk(chunks, buffer, bufferWords);
      buffer = [unit];
      bufferWords = w;
      return;
    }

    buffer.push(unit);
    bufferWords += w;

    if (bufferWords >= targetWords) {
      pushChunk(chunks, buffer, bufferWords);
      buffer = [];
      bufferWords = 0;
    }
  };

  for (const para of paragraphs) {
    const w = countWords(para);
    if (w === 0) continue;
    if (w > maxWords) {
      // Break oversized paragraphs by sentence so we still have a shot
      // at coherent chunks.
      const sentences = splitSentences(para);
      for (const s of sentences) flushUnit(s);
      continue;
    }
    flushUnit(para);
  }

  pushChunk(chunks, buffer, bufferWords);

  return chunks.slice(0, HARD_CHUNK_CAP);
}
