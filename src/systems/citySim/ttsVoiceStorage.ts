const STORAGE_KEY = "ai-city-tts-voices";

export function loadTtsVoiceOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveTtsVoiceOverride(entityId: string, voiceId: string): void {
  if (typeof window === "undefined") return;
  const next = { ...loadTtsVoiceOverrides(), [entityId]: voiceId };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/** Resolved voice for an NPC: localStorage override, else seed default. */
export function getInitialTtsVoiceId(
  entityId: string,
  seedDefault: string
): string {
  const o = loadTtsVoiceOverrides();
  return o[entityId] ?? seedDefault;
}
