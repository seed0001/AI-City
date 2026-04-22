import { EDGE_TTS_VOICE_OPTIONS } from "./speech/edgeTtsVoiceCatalog";
import { getAiSettings } from "./settings/aiSimSettings";
import type { TownEntity } from "./types";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function voiceLabelFor(voiceId: string): string {
  return EDGE_TTS_VOICE_OPTIONS.find((o) => o.id === voiceId)?.label ?? "a chosen voice";
}

/** In-world: food, rest, and social survival without exposing engine field names. */
export function formatSurvivalUrgencyLine(e: TownEntity): string {
  const food =
    e.hunger < 0.32
      ? "fed enough for now"
      : e.hunger < 0.68
        ? "needs a meal soon"
        : "running on empty";
  const rest =
    e.energy > 0.52
      ? "alert"
      : e.energy > 0.28
        ? "worn down"
        : "running on fumes";
  const socialUrge = 1 - e.socialTolerance;
  const connect =
    socialUrge < 0.35
      ? "okay being alone a while"
      : socialUrge < 0.6
        ? "wants a real conversation"
        : "needs people today";
  return `Survival in town: ${food}; ${rest}; ${connect}.`;
}

function lifeMaturityPhrase(adaptation: number, days: number): string {
  if (days <= 0 && adaptation < 0.12) return "still mapping the place";
  if (days < 2) return "absorbing the town's pace";
  if (adaptation < 0.28) return "finding a rhythm here";
  if (adaptation < 0.55) return "settling in";
  if (adaptation < 0.8) return "a familiar face in the mix";
  return "part of the fabric here";
}

export function formatLifeInTownLine(e: TownEntity): string {
  const a = e.lifeAdaptation;
  const d = e.townDaysLived;
  const pct = Math.round(a * 100);
  return `Day count here: ${d} · ${lifeMaturityPhrase(a, d)} (roots ~${pct}%).`;
}

export function formatVoiceAndPersonaLine(e: TownEntity): string {
  const v = voiceLabelFor(e.ttsVoiceId);
  const t = e.traits.length ? e.traits.join(", ") : "quiet";
  return `Hears their own words in the ${v} register; demeanor: ${t}.`;
}

export function formatOtherRolesLine(e: TownEntity): string | undefined {
  const o = e.townRoleOptions.filter((r) => r && r !== e.role);
  if (!o.length) return undefined;
  return `Might have lived as, or been drawn toward: ${o.join("; ")}.`;
}

/**
 * When the in-game calendar flips, advance roots and let role drift (if user
 * did not lock role in settings).
 */
export function onSimCalendarNewDay(
  e: TownEntity,
  oldDayKey: string | null,
  newDayKey: string
): void {
  if (e.controllerType !== "ai") return;
  e.lastSimDayKey = newDayKey;

  if (oldDayKey == null) {
    e.townDaysLived = 0;
  } else {
    e.townDaysLived += 1;
  }

  const lastFul = e.dailyPlan && e.dailyPlan.dayKey === oldDayKey ? e.dailyPlan.fulfillment : 0.35;
  e.lifeAdaptation = clamp01(
    e.lifeAdaptation +
      0.025 +
      e.memoryIds.length * 0.012 +
      lastFul * 0.045 +
      (e.townDaysLived > 0 ? 0.01 : 0) +
      Math.random() * 0.02
  );

  if (e.townDaysLived > 0) {
    maybeDriftTownRole(e);
  }
}

function maybeDriftTownRole(e: TownEntity): void {
  const o = getAiSettings().perCharacter[e.id];
  if (o?.role?.trim()) return;

  const pool = e.townRoleOptions.filter((r) => r && r !== e.role);
  if (pool.length === 0) return;

  const p =
    0.04 +
    e.lifeAdaptation * 0.12 +
    (e.townDaysLived > 2 ? 0.04 : 0) +
    e.memoryIds.length * 0.006;
  if (Math.random() > Math.min(0.28, p)) return;

  e.role = pick(pool);
}

/** After a conversation that touched daily needs, small adaptation bump. */
export function nudgeLifeAfterSocialExchange(e: TownEntity): void {
  if (e.controllerType !== "ai") return;
  e.lifeAdaptation = clamp01(e.lifeAdaptation + 0.01 + Math.random() * 0.008);
}

/** Shorthand for world context + scene packets. */
export function buildLlmLifeFields(e: TownEntity): {
  survivalUrgencyLine: string;
  lifeInTownLine: string;
  voiceAndPersonaLine: string;
  otherPossibleRolesLine?: string;
} {
  const other = formatOtherRolesLine(e);
  return {
    survivalUrgencyLine: formatSurvivalUrgencyLine(e),
    lifeInTownLine: formatLifeInTownLine(e),
    voiceAndPersonaLine: formatVoiceAndPersonaLine(e),
    ...(other ? { otherPossibleRolesLine: other } : {}),
  };
}
