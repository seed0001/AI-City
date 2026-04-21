/**
 * Ollama + Llama 3.2 — configure via Vite env.
 * Browser calls same-origin /ollama/* (proxied to localhost:11434) to avoid CORS.
 */

/** Base path for fetch: "" = use /ollama proxy, or full URL if you expose Ollama with CORS. */
export function getOllamaBasePath(): string {
  const raw = import.meta.env.VITE_OLLAMA_BASE as string | undefined;
  if (raw !== undefined && raw !== "") return raw.replace(/\/$/, "");
  return "/ollama";
}

export function getOllamaModel(): string {
  return (import.meta.env.VITE_OLLAMA_MODEL as string | undefined) ?? "llama3.2";
}

/** When not "false", we try Ollama and fall back to local stubs on error. */
export function isOllamaDialogueEnabled(): boolean {
  return import.meta.env.VITE_OLLAMA_ENABLED !== "false";
}
