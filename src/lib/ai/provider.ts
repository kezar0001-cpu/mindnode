import "server-only";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatCompletionResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export async function chatCompletionJson(
  messages: ChatMessage[],
): Promise<ChatCompletionResult> {
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "AI provider not configured." };
  }
  const model = process.env.AI_PROVIDER_MODEL || "gpt-4o-mini";

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
