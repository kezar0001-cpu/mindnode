import "server-only";

import {
  explorationSuggestionsSchema,
  type ExplorationSuggestions,
} from "./schema";

type ProviderMessage = {
  role: "system" | "user";
  content: string;
};

type ChatCompletionChoice = {
  message?: {
    content?: string | null;
  };
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[];
  error?: {
    message?: string;
  };
};

function getProviderConfig() {
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  if (!apiKey) {
    throw new Error("AI_PROVIDER_API_KEY is not configured.");
  }

  return {
    apiKey,
    model: process.env.AI_PROVIDER_MODEL || "gpt-4o-mini",
  };
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("AI provider returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("AI provider returned malformed JSON.");
    }
    return JSON.parse(match[0]);
  }
}

export async function requestExplorationSuggestions(
  messages: ProviderMessage[],
): Promise<ExplorationSuggestions> {
  const { apiKey, model } = getProviderConfig();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.75,
      response_format: { type: "json_object" },
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "AI provider request failed.");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI provider returned an empty response.");
  }

  const parsed = parseJsonObject(content);
  const validated = explorationSuggestionsSchema.parse(parsed);

  if (validated.suggestions.length === 0) {
    throw new Error("AI provider returned no suggestions.");
  }

  return validated;
}
