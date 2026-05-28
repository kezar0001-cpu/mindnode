import "server-only";

const STOPWORDS = new Set([
  "the","and","that","this","with","from","have","will","would","could","should",
  "your","yours","mine","they","them","their","there","then","than","what","when",
  "where","which","while","into","onto","upon","about","over","under","just","like",
  "only","also","some","more","most","much","many","such","because","been","being",
  "very","really","kind","sort","into","make","made","take","took","goes","gone",
  "want","need","know","knew","think","thought","feel","felt","look","looked",
]);

const TOKEN_REGEX = /[a-z0-9]+/g;

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  const matches = lower.match(TOKEN_REGEX) ?? [];
  for (const t of matches) {
    if (t.length < 4) continue;
    if (STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

export type KeywordCandidate = {
  id: string;
  title: string;
  summary: string;
};

export function findRelatedNodesByKeywords(
  text: string,
  candidates: KeywordCandidate[],
  excludeId: string,
  maxResults = 2,
): { id: string; score: number }[] {
  const sourceTokens = tokenize(text);
  if (sourceTokens.size === 0) return [];

  const scored: { id: string; score: number }[] = [];
  for (const c of candidates) {
    if (c.id === excludeId) continue;
    const cTokens = tokenize(`${c.title} ${c.summary}`);
    let overlap = 0;
    for (const t of sourceTokens) {
      if (cTokens.has(t)) overlap++;
    }
    if (overlap < 2) continue;
    if (overlap / sourceTokens.size < 0.2) continue;
    scored.push({ id: c.id, score: overlap });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}
