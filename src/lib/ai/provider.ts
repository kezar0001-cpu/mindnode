import "server-only";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatCompletionResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

// chatCompletionJson — JSON-mode (`{"type":"json_object"}`). Used for free-form
// AI suggestions and as a fallback when Structured Outputs is not available.
export async function chatCompletionJson(
  messages: ChatMessage[],
  modelOverride?: string,
): Promise<ChatCompletionResult> {
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "AI provider not configured." };
  }
  const model =
    (modelOverride && modelOverride.trim()) ||
    process.env.AI_PROVIDER_MODEL ||
    "gpt-4o-mini";

  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    });
  } catch (err) {
    return { ok: false, error: `Network error: ${err instanceof Error ? err.message : "unknown"}` };
  }

  if (!response.ok) {
    return { ok: false, error: `AI provider error (${response.status}).` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "Malformed AI response." };
  }

  const content =
    (body as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    return { ok: false, error: "Empty AI response." };
  }

  return { ok: true, content };
}

// chatCompletionStructured — uses OpenAI Structured Outputs (json_schema, strict).
// Lower temperature for graph extraction so the model stays faithful to source.
export async function chatCompletionStructured(
  messages: ChatMessage[],
  schema: { name: string; jsonSchema: Record<string, unknown> },
  modelOverride?: string,
): Promise<ChatCompletionResult> {
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "AI provider not configured." };
  }
  const model =
    (modelOverride && modelOverride.trim()) ||
    process.env.AI_PROVIDER_MODEL ||
    "gpt-4.1";

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: schema.name, schema: schema.jsonSchema, strict: true },
        },
        temperature: 0.3,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `AI provider error (${response.status}): ${body.slice(0, 200)}`,
      };
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      return { ok: false, error: "Empty AI response." };
    }
    return { ok: true, content };
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}
