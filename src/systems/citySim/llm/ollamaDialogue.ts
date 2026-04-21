/**
 * Llama via Ollama: one chat completion → strict JSON for dialogue ticks.
 * On any failure, callers should use the provided stub fallback.
 */

import type { NpcConversationScenePacket, StructuredNpcExchangeResult } from "../conversationStructured";
import type { PlayerNpcReplyResult, PlayerNpcScenePacket } from "../conversationPlayer";
import { ollamaChat } from "./ollamaClient";
import { isOllamaDialogueEnabled } from "./ollamaConfig";

function extractJsonValue(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return JSON.parse(fence[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  return JSON.parse(trimmed);
}

const NPC_SYSTEM = `You are a dialogue engine for a small-town simulation. Output ONLY valid JSON (no markdown, no narration outside JSON).
Rules:
- Write exactly two spoken lines per tick: first agentA speaks, then agentB. Use speakerId matching the ids in the input.
- Lines are short (under 220 characters each), in-character, distinct voices. No stage directions in "text" — spoken words only.
- emotionUpdates keys must be agent ids. social is a small delta in [-0.15, 0.15].
- relationshipUpdates: one entry { a, b, delta } with delta in [-0.2, 0.2] (trust-like).
- sceneOutcome.continue: true only if another exchange tick makes sense (respect maxTurns in input).
- actionHints keys must be both agent ids; values: linger | leave | goto | avoid | idle.
- memorySummary: one concise sentence for the memory log.`;

function npcUserPayload(packet: NpcConversationScenePacket): string {
  return `Scene JSON (input):\n${JSON.stringify(packet, null, 2)}\n\nReturn JSON matching this TypeScript shape:
{
  "exchange": [{ "speakerId": string, "text": string }],
  "emotionUpdates": { [id: string]: { "mood"?: string, "social"?: number } },
  "relationshipUpdates": [{ "a": string, "b": string, "delta": number }],
  "sceneOutcome": { "continue": boolean, "ended": boolean, "actionHints": { [id: string]: "linger"|"leave"|"goto"|"avoid"|"idle" } },
  "memorySummary": string,
  "topic": string | null
}`;
}

function sanitizeNpcResult(
  raw: unknown,
  packet: NpcConversationScenePacket,
  fallback: StructuredNpcExchangeResult
): StructuredNpcExchangeResult {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const ex = o.exchange;
  if (!Array.isArray(ex) || ex.length < 2) return fallback;

  const idA = packet.agentA.id;
  const idB = packet.agentB.id;
  const exchange = ex.slice(0, 2).map((row, i) => {
    const r = row as { speakerId?: string; text?: string };
    const speakerId =
      r.speakerId === idA || r.speakerId === idB
        ? r.speakerId
        : i === 0
          ? idA
          : idB;
    const text =
      typeof r.text === "string" && r.text.trim()
        ? r.text.trim().slice(0, 400)
        : fallback.exchange[i]!.text;
    return { speakerId, text };
  });

  const sceneOutcome = o.sceneOutcome as StructuredNpcExchangeResult["sceneOutcome"] | undefined;
  const continueVal =
    typeof sceneOutcome?.continue === "boolean"
      ? sceneOutcome.continue
      : fallback.sceneOutcome.continue;

  type ActHint = "linger" | "leave" | "goto" | "avoid" | "idle";
  const hint = (id: string): ActHint => {
    const raw = (sceneOutcome?.actionHints as Record<string, string> | undefined)?.[id];
    const allowed: readonly ActHint[] = ["linger", "leave", "goto", "avoid", "idle"];
    const v = allowed.find((x) => x === raw);
    return (v ?? fallback.sceneOutcome.actionHints[id] ?? "idle") as ActHint;
  };

  return {
    exchange,
    emotionUpdates:
      (o.emotionUpdates as StructuredNpcExchangeResult["emotionUpdates"]) ??
      fallback.emotionUpdates,
    relationshipUpdates: Array.isArray(o.relationshipUpdates)
      ? (o.relationshipUpdates as StructuredNpcExchangeResult["relationshipUpdates"])
      : fallback.relationshipUpdates,
    sceneOutcome: {
      continue: continueVal,
      ended: !continueVal,
      actionHints: {
        [idA]: hint(idA),
        [idB]: hint(idB),
      },
    },
    memorySummary:
      typeof o.memorySummary === "string"
        ? o.memorySummary.slice(0, 500)
        : fallback.memorySummary,
    topic: typeof o.topic === "string" ? o.topic : fallback.topic,
  };
}

export async function fetchNpcNpcExchange(
  packet: NpcConversationScenePacket,
  fallback: StructuredNpcExchangeResult
): Promise<StructuredNpcExchangeResult> {
  if (!isOllamaDialogueEnabled()) return fallback;
  try {
    const content = await ollamaChat({
      messages: [
        { role: "system", content: NPC_SYSTEM },
        { role: "user", content: npcUserPayload(packet) },
      ],
      formatJson: true,
    });
    const parsed = extractJsonValue(content);
    return sanitizeNpcResult(parsed, packet, fallback);
  } catch (e) {
    console.warn("[ollama] NPC exchange failed, using stub:", e);
    return fallback;
  }
}

const PLAYER_SYSTEM = `You write one in-character spoken line for an NPC talking to a town resident (the player character is just another resident, not a "human user"). Output ONLY valid JSON.`;

function sanitizePlayerResult(
  raw: unknown,
  fallback: PlayerNpcReplyResult
): PlayerNpcReplyResult {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const npcLine =
    typeof o.npcLine === "string" && o.npcLine.trim()
      ? o.npcLine.trim().slice(0, 500)
      : fallback.npcLine;
  const tone =
    o.tone === "warm" || o.tone === "neutral" || o.tone === "sharp"
      ? o.tone
      : fallback.tone;
  return {
    npcLine,
    tone,
    trustDelta: typeof o.trustDelta === "number" ? o.trustDelta : fallback.trustDelta,
    tensionDelta:
      typeof o.tensionDelta === "number" ? o.tensionDelta : fallback.tensionDelta,
    memorySummary:
      typeof o.memorySummary === "string"
        ? o.memorySummary.slice(0, 500)
        : fallback.memorySummary,
  };
}

export async function fetchPlayerNpcReply(
  packet: PlayerNpcScenePacket,
  fallback: PlayerNpcReplyResult
): Promise<PlayerNpcReplyResult> {
  if (!isOllamaDialogueEnabled()) return fallback;
  try {
    const content = await ollamaChat({
      messages: [
        { role: "system", content: PLAYER_SYSTEM },
        {
          role: "user",
          content: `Input:\n${JSON.stringify(packet, null, 2)}\n\nReturn JSON: { "npcLine": string, "tone": "warm"|"neutral"|"sharp", "trustDelta": number, "tensionDelta": number, "memorySummary": string }`,
        },
      ],
      formatJson: true,
    });
    const parsed = extractJsonValue(content);
    return sanitizePlayerResult(parsed, fallback);
  } catch (e) {
    console.warn("[ollama] Player↔NPC reply failed, using stub:", e);
    return fallback;
  }
}
