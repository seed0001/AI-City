/**
 * TTS: Edge TTS in dev (`POST /api/edge-tts`) when available; Web Speech API fallback.
 * Respects AI settings: master toggle, rate/pitch, optional `voiceURI` per character.
 * Per-NPC neural voice: `TownEntity.ttsVoiceId` + debug selector + `localStorage` overrides.
 */

import { getAiSettings } from "../settings/aiSimSettings";
import {
  DEFAULT_NPC_TTS_VOICE,
  EDGE_TTS_VOICE_OPTIONS,
} from "./edgeTtsVoiceCatalog";

export { DEFAULT_NPC_TTS_VOICE, EDGE_TTS_VOICE_OPTIONS } from "./edgeTtsVoiceCatalog";

const FALLBACK_VOICE_IDS = EDGE_TTS_VOICE_OPTIONS.map((o) => o.id);

let currentEdgeAudio: HTMLAudioElement | null = null;

export function resolveEdgeVoiceId(
  ttsVoiceId: string | undefined,
  speakerId: string
): string {
  const v = ttsVoiceId?.trim();
  if (v) return v;
  let h = 0;
  for (let i = 0; i < speakerId.length; i++) {
    h = (h * 31 + speakerId.charCodeAt(i)) | 0;
  }
  return (
    FALLBACK_VOICE_IDS[Math.abs(h) % FALLBACK_VOICE_IDS.length] ??
    DEFAULT_NPC_TTS_VOICE
  );
}

function getEnglishVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("en"));
}

function pickVoicePool(): SpeechSynthesisVoice[] {
  const en = getEnglishVoices();
  const ms = en.filter(
    (v) =>
      /Microsoft|Edge|Natural/i.test(v.name) ||
      v.name.includes("Google US English")
  );
  return ms.length ? ms : en;
}

function findVoiceByUri(uri: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const u = uri.trim();
  if (!u) return null;
  return speechSynthesis.getVoices().find((v) => v.voiceURI === u) ?? null;
}

function looksNeuralName(name: string): boolean {
  return (
    /Microsoft|Natural|Online/i.test(name) && !/Legacy|Basic/i.test(name)
  );
}

/** Sorted list for settings UI (all installed voices). */
export function getAvailableVoicesList(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return [...speechSynthesis.getVoices()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/**
 * Web Speech voice: optional settings `voiceURI` override, else match `ttsVoiceId` short name, else pool hash.
 */
export function pickVoiceForSpeaker(
  speakerId: string,
  ttsVoiceId?: string
): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  void speechSynthesis.getVoices();

  const uri = getAiSettings().perCharacter[speakerId]?.voiceUri?.trim();
  if (uri) {
    const hit = findVoiceByUri(uri);
    if (hit) return hit;
  }

  const shortName = resolveEdgeVoiceId(ttsVoiceId, speakerId);
  const lower = shortName.toLowerCase();
  const all = speechSynthesis.getVoices();

  const byUri = all.find((v) =>
    `${v.voiceURI}\n${v.name}`.toLowerCase().includes(lower)
  );
  if (byUri) return byUri;

  const en = getEnglishVoices();
  const m = shortName.match(/^en-US-(.+?)Neural$/i);
  const token = m?.[1]?.replace(/([a-z])([A-Z])/g, "$1 $2") ?? "";
  const simple = token.split(/[\s-]+/)[0];
  if (simple) {
    const rx = new RegExp(simple, "i");
    const candidates = en.filter(
      (v) => rx.test(v.name) && looksNeuralName(v.name)
    );
    const ms = candidates.find((v) => /Microsoft/i.test(v.name));
    if (ms) return ms;
    if (candidates[0]) return candidates[0];
  }

  const pool = pickVoicePool();
  if (!pool.length) return null;
  let h = 0;
  for (let i = 0; i < speakerId.length; i++) {
    h = (h * 31 + speakerId.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(h) % pool.length] ?? null;
}

async function playEdgeTts(
  speakerId: string,
  text: string,
  ttsVoiceId: string | undefined
): Promise<boolean> {
  try {
    const voice = resolveEdgeVoiceId(ttsVoiceId, speakerId);
    const res = await fetch("/api/edge-tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) return false;

    currentEdgeAudio?.pause();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentEdgeAudio = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentEdgeAudio === audio) currentEdgeAudio = null;
    };
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

function speakWebSpeechFallback(
  speakerId: string,
  text: string,
  ttsVoiceId: string | undefined
): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const s = getAiSettings();
  const voice = pickVoiceForSpeaker(speakerId, ttsVoiceId);
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = Math.max(0.4, Math.min(2, s.ttsRate));
  u.pitch = Math.max(0, Math.min(2, s.ttsPitch));
  speechSynthesis.speak(u);
}

export function initSpeechVoices(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const sync = () => {
    void speechSynthesis.getVoices();
  };
  sync();
  speechSynthesis.onvoiceschanged = sync;
}

/**
 * @param ttsVoiceId - from `TownEntity.ttsVoiceId` for NPCs
 */
export function speakAiLine(
  speakerId: string,
  text: string,
  ttsVoiceId?: string
): void {
  if (typeof window === "undefined") return;
  if (!getAiSettings().ttsEnabled) return;

  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;

  speechSynthesis.cancel();
  currentEdgeAudio?.pause();
  currentEdgeAudio = null;

  void playEdgeTts(speakerId, clean, ttsVoiceId).then((ok) => {
    if (!ok) speakWebSpeechFallback(speakerId, clean, ttsVoiceId);
  });
}

export function stopAllSpeech(): void {
  if (typeof window === "undefined") return;
  speechSynthesis.cancel();
  currentEdgeAudio?.pause();
  currentEdgeAudio = null;
}
