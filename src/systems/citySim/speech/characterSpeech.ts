/**
 * Uses the browser Web Speech API (SpeechSynthesis). In Microsoft Edge on Windows,
 * voices often include "Microsoft … Online (Natural)" — closest to Edge TTS in the web app.
 * Other browsers get the best English voice available.
 */

import { getAiSettings } from "../settings/aiSimSettings";

function getEnglishVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
}

/** Prefer Microsoft / Edge neural voices when listed. */
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

/** Sorted list for settings UI (all installed voices). */
export function getAvailableVoicesList(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return [...speechSynthesis.getVoices()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/** Stable different voice per NPC id, with optional per-character override. */
export function pickVoiceForSpeaker(speakerId: string): SpeechSynthesisVoice | null {
  const uri = getAiSettings().perCharacter[speakerId]?.voiceUri?.trim();
  if (uri) {
    const hit = findVoiceByUri(uri);
    if (hit) return hit;
  }
  const pool = pickVoicePool();
  if (!pool.length) return null;
  let h = 0;
  for (let i = 0; i < speakerId.length; i++) h = (h * 31 + speakerId.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % pool.length;
  return pool[idx] ?? null;
}

export function initSpeechVoices(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const sync = () => {
    void speechSynthesis.getVoices();
  };
  sync();
  speechSynthesis.onvoiceschanged = sync;
}

export function speakAiLine(speakerId: string, text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  if (!getAiSettings().ttsEnabled) return;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;

  const s = getAiSettings();
  const voice = pickVoiceForSpeaker(speakerId);
  const u = new SpeechSynthesisUtterance(clean);
  if (voice) u.voice = voice;
  u.rate = Math.max(0.4, Math.min(2, s.ttsRate));
  u.pitch = Math.max(0, Math.min(2, s.ttsPitch));
  speechSynthesis.speak(u);
}

export function stopAllSpeech(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  speechSynthesis.cancel();
}
