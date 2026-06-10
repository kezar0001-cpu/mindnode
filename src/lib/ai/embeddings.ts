import "server-only";

// OpenAI embeddings client. Server-only — the provider key never reaches the
// client. Dimension is pinned to 1536 to match the vector(1536) columns; the
// text-embedding-3-* family supports an explicit `dimensions` parameter.

import { fetchWithRetry } from "./http";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

export const EMBEDDING_DIMENSIONS = 1536;

const DEFAULT_MODEL = "text-embedding-3-small";
// Keep inputs well under the model's token limit; characters are a safe proxy.
const MAX_INPUT_CHARS = 6000;
const BATCH_SIZE = 96;

export type EmbedResult =
  | { ok: true; embeddings: number[][] }
  | { ok: false; error: string };

function embeddingModel(): string {
  const env = process.env.AI_EMBEDDING_MODEL;
  return env && env.trim() ? env.trim() : DEFAULT_MODEL;
}

async function embedBatch(inputs: string[]): Promise<EmbedResult> {
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "AI provider not configured." };
  }

  const result = await fetchWithRetry(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: embeddingModel(),
      input: inputs,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const response = result.response;

  if (!response.ok) {
    return { ok: false, error: `Embedding provider error (${response.status}).` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "Malformed embedding response." };
  }

  const data = (body as { data?: Array<{ index?: number; embedding?: number[] }> })
    ?.data;
  if (!Array.isArray(data) || data.length !== inputs.length) {
    return { ok: false, error: "Incomplete embedding response." };
  }

  // The API returns entries with indexes; sort defensively.
  const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const embeddings: number[][] = [];
  for (const item of sorted) {
    if (!Array.isArray(item.embedding)) {
      return { ok: false, error: "Missing embedding vector in response." };
    }
    embeddings.push(item.embedding);
  }
  return { ok: true, embeddings };
}

// Embeds a list of texts, batching as needed. Empty inputs are replaced with
// a single space so indexes stay aligned with the caller's rows.
export async function embedTexts(texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) return { ok: true, embeddings: [] };
  const prepared = texts.map((t) => {
    const trimmed = t.replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_CHARS);
    return trimmed.length > 0 ? trimmed : " ";
  });

  const all: number[][] = [];
  for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
    const batch = prepared.slice(i, i + BATCH_SIZE);
    const result = await embedBatch(batch);
    if (!result.ok) return result;
    all.push(...result.embeddings);
  }
  return { ok: true, embeddings: all };
}

export async function embedText(
  text: string,
): Promise<{ ok: true; embedding: number[] } | { ok: false; error: string }> {
  const result = await embedTexts([text]);
  if (!result.ok) return result;
  return { ok: true, embedding: result.embeddings[0] };
}

// pgvector accepts the '[0.1,0.2,...]' text representation for both column
// writes and RPC arguments.
export function toVectorLiteral(embedding: number[]): string {
  return JSON.stringify(embedding);
}
