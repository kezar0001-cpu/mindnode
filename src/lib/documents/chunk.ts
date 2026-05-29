// Section-aware chunker. Pure function, no IO. Each chunk carries the
// section metadata it came from so the AI sees the full section context.
// Hard cap of 60 chunks per document to keep AI cost predictable.

import type { DocumentSection } from "./structure";

export type SectionChunk = {
  section_id: string;
  section_title: string;
  section_level: number;
  section_index: number;
  chunk_index: number;
  content: string;
  word_count: number;
  token_estimate: number;
};

type ChunkOptions = {
  targetWords?: number;
  maxWords?: number;
};

// Smaller target produces more focused chunks → more granular AI extraction.
const DEFAULT_TARGET = 600;
const DEFAULT_MAX = 900;
const HARD_CHUNK_CAP = 120;

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

function splitSentences(paragraph: string): string[] {
  const parts = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [paragraph.trim()];
}

function packSection(
  section: DocumentSection,
  targetWords: number,
  maxWords: number,
): { content: string; word_count: number }[] {
  const out: { content: string; word_count: number }[] = [];
  const total = section.word_count;
  if (total === 0) return out;
  if (total <= maxWords) {
    out.push({ content: section.content, word_count: total });
    return out;
  }

  const paragraphs = section.content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  let buffer: string[] = [];
  let bufferWords = 0;

  const flush = () => {
    if (buffer.length === 0 || bufferWords === 0) return;
    out.push({
      content: buffer.join("\n\n").trim(),
      word_count: bufferWords,
    });
    buffer = [];
    bufferWords = 0;
  };

  const addUnit = (unit: string) => {
    const w = countWords(unit);
    if (w === 0) return;
    if (w > maxWords) {
      flush();
      out.push({ content: unit, word_count: w });
      return;
    }
    if (bufferWords + w > maxWords) {
      flush();
      buffer = [unit];
      bufferWords = w;
      return;
    }
    buffer.push(unit);
    bufferWords += w;
    if (bufferWords >= targetWords) flush();
  };

  for (const para of paragraphs) {
    const w = countWords(para);
    if (w === 0) continue;
    if (w > maxWords) {
      // Break oversized paragraphs by sentence.
      for (const s of splitSentences(para)) addUnit(s);
      continue;
    }
    addUnit(para);
  }
  flush();

  return out;
}

export function chunkSections(
  sections: DocumentSection[],
  opts?: ChunkOptions,
): SectionChunk[] {
  const targetWords = opts?.targetWords ?? DEFAULT_TARGET;
  const maxWords = opts?.maxWords ?? DEFAULT_MAX;

  const out: SectionChunk[] = [];
  let globalIndex = 0;

  for (const section of sections) {
    const packed = packSection(section, targetWords, maxWords);
    for (const p of packed) {
      out.push({
        section_id: section.id,
        section_title: section.title,
        section_level: section.level,
        section_index: section.index,
        chunk_index: globalIndex,
        content: p.content,
        word_count: p.word_count,
        token_estimate: Math.ceil(p.word_count * 1.3),
      });
      globalIndex += 1;
      if (out.length >= HARD_CHUNK_CAP) return out;
    }
  }

  return out;
}
