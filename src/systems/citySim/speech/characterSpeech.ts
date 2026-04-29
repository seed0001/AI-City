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

/**
 * Global serial queue: every {@link speakAiLine} call chains here so playback
 * never overlaps, even across conversations. Each promise in the chain
 * resolves when the corresponding utterance/audio fully ends, errors out,
 * or hits its safety timeout.
 */
let speechQueue: Promise<void> = Promise.resolve();
let queueDepth = 0;

/** Whether anything is currently queued or playing. */
export function isSpeaking(): boolean {
  return queueDepth > 0;
}

/** Generous per-line timeout proportional to text length (clamped). */
function computeTimeoutMs(text: string, rate: number): number {
  const safeRate = rate > 0.1 ? rate : 1.0;
  const baseMsPerChar = 95 / safeRate;
  const raw = text.length * baseMsPerChar + 1500;
  return Math.min(60_000, Math.max(6_000, raw));
}

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

/**
 * Try Edge TTS; resolves true on full audio end, false if the request or
 * playback fails (so the caller can fall back to Web Speech). Always
 * resolves; never rejects.
 */
async function playEdgeTtsAwait(
  speakerId: string,
  text: string,
  ttsVoiceId: string | undefined,
  timeoutMs: number
): Promise<boolean> {
  let res: Response;
  try {
    const voice = resolveEdgeVoiceId(ttsVoiceId, speakerId);
    res = await fetch("/api/edge-tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;

  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    return false;
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentEdgeAudio?.pause();
  currentEdgeAudio = audio;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      audio.onpause = null;
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      if (currentEdgeAudio === audio) currentEdgeAudio = null;
    };
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(success);
    };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    // External cancellation (stopAllSpeech) calls .pause(); treat that as
    // "done" so awaited promises release immediately.
    audio.onpause = () => {
      if (!audio.ended) finish(true);
    };
    const timer = setTimeout(() => {
      try {
        audio.pause();
      } catch {
        // ignore
      }
      finish(true);
    }, timeoutMs);
    audio.addEventListener("ended", () => clearTimeout(timer));
    audio.addEventListener("error", () => clearTimeout(timer));
    audio.addEventListener("pause", () => clearTimeout(timer));

    audio.play().catch(() => finish(false));
  });
}

/**
 * Web Speech speak that resolves on `onend`, on `onerror`, or after a safety
 * timeout. Never rejects; the simulation must keep ticking even if TTS breaks.
 */
function speakWebSpeechAwait(
  speakerId: string,
  text: string,
  ttsVoiceId: string | undefined,
  timeoutMs: number
): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve();
  }
  const s = getAiSettings();
  const voice = pickVoiceForSpeaker(speakerId, ttsVoiceId);
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = Math.max(0.4, Math.min(2, s.ttsRate));
    u.pitch = Math.max(0, Math.min(2, s.ttsPitch));
    u.onend = () => finish();
    u.onerror = () => finish();
    const timer = setTimeout(finish, timeoutMs);
    try {
      speechSynthesis.speak(u);
    } catch {
      finish();
    }
  });
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
 * Speak one line for a character. Returns a Promise that resolves only when
 * playback fully ends — for both Edge TTS (`audio.onended`) and Web Speech
 * (`utterance.onend`). Errors (including network failure, audio decode error,
 * or Web Speech rejection) and a safety timeout also resolve the promise so
 * the simulation never freezes.
 *
 * Calls are serialized through a global queue so two NPC voices never overlap.
 *
 * @param ttsVoiceId - from `TownEntity.ttsVoiceId` for NPCs
 */
export function speakAiLine(
  speakerId: string,
  text: string,
  ttsVoiceId?: string
): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!getAiSettings().ttsEnabled) return Promise.resolve();

  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return Promise.resolve();

  const settings = getAiSettings();
  const timeoutMs = computeTimeoutMs(clean, settings.ttsRate || 1.0);

  queueDepth += 1;
  const job = speechQueue.then(async () => {
    try {
      const ok = await playEdgeTtsAwait(speakerId, clean, ttsVoiceId, timeoutMs);
      if (!ok) {
        await speakWebSpeechAwait(speakerId, clean, ttsVoiceId, timeoutMs);
      }
    } catch {
      // never reject
    } finally {
      queueDepth = Math.max(0, queueDepth - 1);
    }
  });

  // Keep the chain alive even if a job throws, so subsequent lines still play.
  speechQueue = job.catch(() => undefined);
  return job;
}

export function stopAllSpeech(): void {
  if (typeof window === "undefined") return;
  try {
    speechSynthesis.cancel();
  } catch {
    // ignore
  }
  try {
    currentEdgeAudio?.pause();
  } catch {
    // ignore
  }
  currentEdgeAudio = null;
  // Reset the queue; in-flight jobs will resolve via their cleanup paths.
  speechQueue = Promise.resolve();
  queueDepth = 0;
}
