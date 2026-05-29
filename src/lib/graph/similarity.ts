// Conservative similarity helper used to link freshly extracted document
// nodes to existing graph nodes. Token-overlap based — no embeddings.

export type ExistingNodeForSimilarity = {
  id: string;
  title: string;
  summary: string;
  category: string;
};

const STOPWORDS = new Set<string>([
  "a","an","the","and","or","but","for","to","of","in","on","at","by","from","with",
  "this","that","these","those","is","was","are","were","be","been","has","have","had",
  "will","would","can","could","should","do","does","did","it","its","as","also","just",
  "only","more","most","very","much","many","some","any","all","no","not","into","about",
  "after","before","between","both","each","other","our","your","their","them","they",
  "he","she","his","her","you","we","us","what","which","when","where","who","why","how",
  "like","get","got","getting","make","made","take","took","go","going","gone","come","came",
]);

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    if (raw.length < 4) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

function unionTokens(...texts: string[]): Set<string> {
  const acc = new Set<string>();
  for (const t of texts) {
    for (const tok of tokenize(t)) acc.add(tok);
  }
  return acc;
}

export function findRelatedExistingNodes(args: {
  candidate: { title: string; summary: string; category: string; tags?: string[] };
  existing: ExistingNodeForSimilarity[];
  maxResults?: number;
}): { id: string; score: number }[] {
  const max = args.maxResults ?? 2;
  if (args.existing.length === 0) return [];

  const candTokens = unionTokens(
    args.candidate.title,
    args.candidate.summary,
    (args.candidate.tags ?? []).join(" "),
  );
  if (candTokens.size === 0) return [];
  const candCategory = args.candidate.category.toLowerCase().trim();
  const candTags = new Set(
    (args.candidate.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean),
  );

  const scored: { id: string; score: number; shared: number }[] = [];
  for (const ex of args.existing) {
    const exTokens = unionTokens(ex.title, ex.summary);
    let shared = 0;
    for (const t of exTokens) {
      if (candTokens.has(t)) shared += 1;
    }
    let score = shared;
    if (ex.category && candCategory && ex.category.toLowerCase().trim() === candCategory) {
      score += 2;
    }
    // Bonus if any existing token appears in candidate tags.
    let tagHit = false;
    for (const t of exTokens) {
      if (candTags.has(t)) {
        tagHit = true;
        break;
      }
    }
    if (tagHit) score += 3;

    // Require ≥2 shared meaningful tokens, or 1 shared + category match.
    const passes =
      shared >= 2 ||
      (shared >= 1 &&
        ex.category &&
        candCategory &&
        ex.category.toLowerCase().trim() === candCategory);
    if (!passes) continue;
    if (score < 3) continue;
    scored.push({ id: ex.id, score, shared });
  }

  scored.sort((a, b) => b.score - a.score || b.shared - a.shared);
  return scored.slice(0, max).map(({ id, score }) => ({ id, score }));
}
