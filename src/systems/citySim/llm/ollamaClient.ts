import { getOllamaBasePath, getOllamaModel } from "./ollamaConfig";

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OllamaChatResponse = {
  message?: { role: string; content: string };
  error?: string;
};

/**
 * POST /api/chat with optional JSON mode (Ollama format: json).
 */
export async function ollamaChat(options: {
  messages: OllamaChatMessage[];
  formatJson?: boolean;
  model?: string;
}): Promise<string> {
  const base = getOllamaBasePath();
  const url = `${base}/api/chat`;
  const model = options.model ?? getOllamaModel();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: options.messages,
      stream: false,
      ...(options.formatJson ? { format: "json" } : {}),
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${t.slice(0, 200)}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  if (data.error) throw new Error(data.error);
  const content = data.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Ollama returned empty message");
  }
  return content;
}
