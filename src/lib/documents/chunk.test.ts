import { describe, it, expect } from "vitest";

import { chunkSections } from "./chunk";
import type { DocumentSection } from "./structure";

function section(partial: Partial<DocumentSection> & { content: string }): DocumentSection {
  const words = partial.content.trim().split(/\s+/).filter(Boolean).length;
  return {
    id: partial.id ?? "s1",
    index: partial.index ?? 0,
    title: partial.title ?? "Section",
    level: partial.level ?? 1,
    content: partial.content,
    char_count: partial.content.length,
    word_count: partial.word_count ?? words,
    bullet_count: partial.bullet_count ?? 0,
    start_offset: partial.start_offset ?? 0,
    end_offset: partial.end_offset ?? partial.content.length,
  };
}

describe("chunkSections", () => {
  it("keeps a short section as a single chunk carrying its metadata", () => {
    const sections = [section({ id: "intro", title: "Intro", content: "a short body" })];
    const chunks = chunkSections(sections);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].section_id).toBe("intro");
    expect(chunks[0].section_title).toBe("Intro");
    expect(chunks[0].chunk_index).toBe(0);
  });

  it("assigns globally increasing chunk indexes across sections", () => {
    const sections = [
      section({ id: "a", content: "first section body" }),
      section({ id: "b", content: "second section body" }),
    ];
    const chunks = chunkSections(sections);
    expect(chunks.map((c) => c.chunk_index)).toEqual([0, 1]);
  });

  it("splits a long section into multiple chunks", () => {
    const longBody = Array.from({ length: 40 }, (_, i) => `para ${i} ${"word ".repeat(50)}`).join(
      "\n\n",
    );
    const chunks = chunkSections([section({ id: "big", content: longBody })], {
      targetWords: 200,
      maxWords: 300,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.section_id).toBe("big");
  });

  it("ignores empty sections", () => {
    expect(chunkSections([section({ content: "", word_count: 0 })])).toEqual([]);
  });
});
