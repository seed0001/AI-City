import type { Mood, TownEntity } from "../types";

const STORAGE_KEY = "ai-city-sim-settings";
const CURRENT_VERSION = 1 as const;

export type CharacterPersonaOverride = {
  displayName?: string;
  role?: string;
  /** One of: calm | annoyed | friendly | nervous | angry */
  mood?: string;
  /** Comma- or semicolon-separated trait tags */
  traits?: string;
  /** Extra background / voice for the model (not shown in-world unless you sync) */
  personaNotes?: string;
  /** `SpeechSynthesisVoice.voiceURI` or empty = automatic per-id voice */
  voiceUri?: string;
};

export type AiSimSettings = {
  version: typeof CURRENT_VERSION;
  globalNpcSystemSuffix: string;
  globalPlayerSystemSuffix: string;
  ttsEnabled: boolean;
  ttsRate: number;
  ttsPitch: number;
  perCharacter: Record<string, CharacterPersonaOverride>;
};

const MOODS: readonly Mood[] = [
  "calm",
  "annoyed",
  "friendly",
  "nervous",
  "angry",
];

function defaultSettings(): AiSimSettings {
  return {
    version: CURRENT_VERSION,
    globalNpcSystemSuffix: "",
    globalPlayerSystemSuffix: "",
    ttsEnabled: true,
    ttsRate: 1,
    ttsPitch: 1,
    perCharacter: {},
  };
}

let cache: AiSimSettings | null = null;
const listeners = new Set<() => void>();

function normalize(raw: unknown): AiSimSettings {
  const b = defaultSettings();
  if (!raw || typeof raw !== "object") return b;
  const o = raw as Record<string, unknown>;
  if (typeof o.globalNpcSystemSuffix === "string")
    b.globalNpcSystemSuffix = o.globalNpcSystemSuffix;
  if (typeof o.globalPlayerSystemSuffix === "string")
    b.globalPlayerSystemSuffix = o.globalPlayerSystemSuffix;
  if (typeof o.ttsEnabled === "boolean") b.ttsEnabled = o.ttsEnabled;
  if (typeof o.ttsRate === "number" && o.ttsRate > 0 && o.ttsRate < 2.5)
    b.ttsRate = o.ttsRate;
  if (typeof o.ttsPitch === "number" && o.ttsPitch >= 0 && o.ttsPitch < 2.5)
    b.ttsPitch = o.ttsPitch;
  if (o.perCharacter && typeof o.perCharacter === "object" && o.perCharacter) {
    b.perCharacter = { ...b.perCharacter };
    for (const [k, v] of Object.entries(o.perCharacter as Record<string, unknown>)) {
      if (v && typeof v === "object")
        b.perCharacter[k] = { ...(v as CharacterPersonaOverride) };
    }
  }
  return b;
}

export function getAiSettings(): AiSimSettings {
  if (cache) return cache;
  if (typeof localStorage === "undefined") {
    cache = defaultSettings();
    return cache;
  }
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    cache = normalize(s ? (JSON.parse(s) as unknown) : undefined);
  } catch {
    cache = defaultSettings();
  }
  return cache!;
}

export function setAiSettings(
  update: Partial<Omit<AiSimSettings, "perCharacter">> & {
    perCharacter?: Record<string, CharacterPersonaOverride | undefined>;
  }
): AiSimSettings {
  const base = getAiSettings();
  const cur = { ...base, perCharacter: { ...base.perCharacter } };
  if (update.globalNpcSystemSuffix !== undefined)
    cur.globalNpcSystemSuffix = update.globalNpcSystemSuffix;
  if (update.globalPlayerSystemSuffix !== undefined)
    cur.globalPlayerSystemSuffix = update.globalPlayerSystemSuffix;
  if (update.ttsEnabled !== undefined) cur.ttsEnabled = update.ttsEnabled;
  if (update.ttsRate !== undefined) cur.ttsRate = update.ttsRate;
  if (update.ttsPitch !== undefined) cur.ttsPitch = update.ttsPitch;
  if (update.perCharacter) {
    for (const [k, v] of Object.entries(update.perCharacter)) {
      if (v === undefined) delete cur.perCharacter[k];
      else cur.perCharacter[k] = { ...cur.perCharacter[k], ...v };
    }
  }
  cur.version = CURRENT_VERSION;
  cache = cur;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
    } catch {
      /* ignore quota */
    }
  }
  for (const L of listeners) L();
  return cur;
}

export function resetAiSettingsToDefaults(): AiSimSettings {
  cache = defaultSettings();
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      /* ignore */
    }
  }
  for (const L of listeners) L();
  return cache;
}

export function subscribeAiSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function pruneOverride(o: CharacterPersonaOverride): CharacterPersonaOverride | undefined {
  const t: CharacterPersonaOverride = {};
  if (o.displayName?.trim()) t.displayName = o.displayName.trim();
  if (o.role?.trim()) t.role = o.role.trim();
  if (o.mood?.trim()) t.mood = o.mood.trim();
  if (o.traits?.trim()) t.traits = o.traits.trim();
  if (o.personaNotes?.trim()) t.personaNotes = o.personaNotes.trim();
  if (o.voiceUri?.trim()) t.voiceUri = o.voiceUri.trim();
  return Object.keys(t).length > 0 ? t : undefined;
}

/** Merge patch into a character entry; removes the entry if nothing left. */
export function patchCharacterOverride(
  id: string,
  patch: Partial<CharacterPersonaOverride>
): void {
  const prev = getAiSettings().perCharacter[id] ?? {};
  const merged: CharacterPersonaOverride = { ...prev, ...patch };
  (Object.keys(patch) as (keyof CharacterPersonaOverride)[]).forEach((k) => {
    if (patch[k] === undefined) {
      delete merged[k];
    }
  });
  const pruned = pruneOverride(merged);
  setAiSettings({ perCharacter: { [id]: pruned } });
}

function parseMood(s: string | undefined, fallback: Mood): Mood {
  if (!s) return fallback;
  const t = s.trim().toLowerCase() as Mood;
  return (MOODS as readonly string[]).includes(t) ? t : fallback;
}

function parseTraits(traits: string | undefined, fallback: string[]): string[] {
  if (!traits || !traits.trim()) return fallback;
  return traits
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Merged view for LLM scene packets. Engine entity still holds canonical data when fields are unset in settings.
 */
export function getMergedAgentSlice(entity: TownEntity) {
  const o = getAiSettings().perCharacter[entity.id];
  return {
    displayName: o?.displayName?.trim() || entity.displayName,
    role: o?.role?.trim() || entity.role,
    mood: parseMood(o?.mood, entity.mood),
    traits: parseTraits(o?.traits, entity.traits),
    personaNotes: o?.personaNotes?.trim() || undefined,
    gender: entity.gender,
  };
}

export function withSystemSuffix(base: string, kind: "npc" | "player"): string {
  const s = getAiSettings();
  const extra = kind === "npc" ? s.globalNpcSystemSuffix : s.globalPlayerSystemSuffix;
  const t = extra?.trim();
  if (!t) return base;
  return `${base}\n\n--- User tuning ---\n${t}`;
}
