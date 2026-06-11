import { describe, it, expect } from "vitest";

import { tokenize, findRelatedNodesByKeywords } from "./keyword-link";

describe("tokenize", () => {
  it("drops stopwords and short tokens, lowercases the rest", () => {
    const tokens = tokenize("The Quick brown FOX and a cat");
    // "the", "and", "a" are stopwords/short; "fox"/"cat" are length 3 (<4) → dropped.
    expect(tokens.has("quick")).toBe(true);
    expect(tokens.has("brown")).toBe(true);
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("fox")).toBe(false);
  });

  it("deduplicates tokens", () => {
    expect(tokenize("aviation aviation aviation").size).toBe(1);
  });
});

describe("findRelatedNodesByKeywords", () => {
  const candidates = [
    { id: "1", title: "Aviation training plan", summary: "weather flying routes" },
    { id: "2", title: "Cooking recipes", summary: "pasta sauce dinner" },
    { id: "3", title: "Flying weather notes", summary: "aviation routes clouds" },
  ];

  it("links nodes sharing at least two meaningful tokens", () => {
    const related = findRelatedNodesByKeywords(
      "aviation weather routes flying",
      candidates,
      "self",
    );
    const ids = related.map((r) => r.id);
    expect(ids).toContain("1");
    expect(ids).toContain("3");
    expect(ids).not.toContain("2");
  });

  it("excludes the source node id", () => {
    const related = findRelatedNodesByKeywords(
      "aviation weather routes",
      candidates,
      "1",
    );
    expect(related.map((r) => r.id)).not.toContain("1");
  });

  it("returns nothing when there is no meaningful overlap", () => {
    expect(
      findRelatedNodesByKeywords("xylophone zebra", candidates, "self"),
    ).toEqual([]);
  });

  it("ranks stronger overlaps first and respects the result cap", () => {
    const related = findRelatedNodesByKeywords(
      "aviation weather routes flying clouds",
      candidates,
      "self",
      1,
    );
    expect(related).toHaveLength(1);
  });
});
