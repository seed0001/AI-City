/**
 * Llama via Ollama: one chat completion → strict JSON for dialogue ticks.
 * On any failure, callers should use the provided stub fallback.
 */

import type { NpcConversationScenePacket, StructuredNpcExchangeResult } from "../conversationStructured";
import type { PlayerNpcReplyResult, PlayerNpcScenePacket } from "../conversationPlayer";
import { ollamaChat } from "./ollamaClient";
import { isOllamaDialogueEnabled } from "./ollamaConfig";
import { withSystemSuffix } from "../settings/aiSimSettings";

function extractJsonValue(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return JSON.parse(fence[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  return JSON.parse(trimmed);
}

const NPC_SYSTEM = `You are continuing an active multi-turn conversation in AI City. You write the next two spoken lines (agentA then agentB) inside an ongoing dialogue session, NOT a one-off scene.

SESSION RULES (HIGHEST PRIORITY):
- This is part of a longer arc. Do NOT reset the scene.
- Do NOT greet unless conversationState.turnIndex == 0 (first turn).
- Respond DIRECTLY to the previous line(s) in recentTurns.
- Keep the same topic unless there is a concrete reason to shift (and if you shift, fill nextTopic).
- If the previous speaker asked a question, ANSWER it.
- If conversationState.unresolvedQuestion is non-null, address it.
- If conversationState.conversationGoal is non-null, push toward it (agree, disagree, propose, refine).
- Do NOT prematurely end the conversation. sceneOutcome.continue MUST be true while turnIndex < minTurns. Only set it false if the goal is resolved AND there is no unresolved question AND maxTurns is near.
- If status == "winding_down", land the conversation: confirm any plan, acknowledge what's still open, then end on a concrete note.

ENGINE-FIRST CHARACTER VOICE:
- agentA.engineBrainContext and agentB.engineBrainContext describe each character's CURRENT INNER STATE: emotionalState, relationshipReasoning, currentIntent, activeGoals, driveState, selfNarrative, recentEpisodes.
- Each spoken line must visibly reflect that character — at minimum one of:
  1) tone matches emotionalState,
  2) line references currentIntent / activeGoals,
  3) line references a recentEpisode or relationshipReasoning.
- Distinct NPCs MUST sound distinct. No template lines.

LINE QUALITY:
- Each line should usually contain: a direct response to the previous speaker, plus ONE of: a new piece of information, a real opinion / pushback, an emotional acknowledgement, a question, a decision, a memory, or a concrete next step.
- Avoid throwaway lines unless the character is intentionally curt: NO "Yeah." / "Okay." / "Sounds good." / "We should talk later." / generic greetings that reset the conversation.
- Do NOT repeat any line in agentARecentSpoken / agentBRecentSpoken. Vary phrasing each turn.

CATEGORY-AWARE PACING:
- conversationState.category in: casual / work / planning / emotional / argument / deep.
- argument / emotional / deep: lean into the friction or feeling, ask for specifics, surface concrete grievances or memories.
- planning / work: name the actual blocker, propose a step, accept or refute counters, agree on who handles what.
- casual / deep: include a personal detail, a memory, or a real opinion — do not stay surface.

OUTPUT (JSON ONLY, no markdown, no prose outside JSON):
- Exactly two entries in "exchange": agentA first, then agentB. Use speakerId values matching the input ids.
- Each "text" is short (< 240 chars), in-character, spoken words only — no stage directions, no narration.
- emotionUpdates keys are agent ids; "social" delta in [-0.15, 0.15].
- relationshipUpdates: one entry { a, b, delta }; delta in [-0.2, 0.2], trust-like.
- sceneOutcome.continue: see SESSION RULES above. The engine WILL override your false signal while turnIndex < minTurns, so use it honestly only after min.
- actionHints keys: both agent ids; values: linger | leave | goto | avoid | idle.
- memorySummary: one concise sentence anchored in what changed this batch.
- topic / nextTopic: short noun-phrase capturing what this exchange was about.
- conversationGoal: what the conversation is trying to resolve (carry-over allowed).
- unresolvedQuestion: a real question still pending, or null if all questions are answered.
- lastSpeakerIntent: agentA's effective intent in this batch (e.g. "pushing back").
- lastListenerReaction: agentB's reaction (e.g. "skeptical but listening").
- summaryDelta: one short sentence describing what shifted in this batch.
- commitments: array of { actorId, text } when an NPC commits to doing something concrete; empty array if none.`;

function npcUserPayload(packet: NpcConversationScenePacket): string {
  const aCtx = packet.agentA.engineBrainContext;
  const bCtx = packet.agentB.engineBrainContext;
  const spine =
    aCtx && bCtx
      ? [
          "ENGINE BRAIN STATE (use this as the SPINE of your response):",
          `- ${packet.agentA.displayName} (${packet.agentA.id})`,
          `    emotionalState: ${aCtx.emotionalState}`,
          `    relationshipReasoning: ${aCtx.relationshipReasoning}`,
          `    currentIntent: ${aCtx.currentIntent}`,
          `    activeGoals: ${aCtx.activeGoals}`,
          `    driveState: ${aCtx.driveState}`,
          `    selfNarrative: ${aCtx.selfNarrative}`,
          `    recentEpisodes: ${aCtx.recentEpisodes.join(" | ") || "none"}`,
          `- ${packet.agentB.displayName} (${packet.agentB.id})`,
          `    emotionalState: ${bCtx.emotionalState}`,
          `    relationshipReasoning: ${bCtx.relationshipReasoning}`,
          `    currentIntent: ${bCtx.currentIntent}`,
          `    activeGoals: ${bCtx.activeGoals}`,
          `    driveState: ${bCtx.driveState}`,
          `    selfNarrative: ${bCtx.selfNarrative}`,
          `    recentEpisodes: ${bCtx.recentEpisodes.join(" | ") || "none"}`,
          "",
          "Generate two lines that visibly express the above. Do not contradict it.",
          "",
        ].join("\n")
      : "(engine brain state unavailable this tick — rely on the scene packet only)\n";

  const cs = packet.conversationState;
  const sessionLines = [
    "SESSION STATE (this is an ongoing arc, not a fresh scene):",
    `  category: ${cs.category}`,
    `  status: ${cs.status}`,
    `  emotionalTone: ${cs.emotionalTone}`,
    `  turnIndex: ${cs.turnIndex} (min ${cs.minTurns}, max ${cs.maxTurns})`,
    cs.lastTopic ? `  topic: ${cs.lastTopic}` : `  topic: (not yet set; you may name it via "topic" or "nextTopic")`,
    cs.topicStack.length ? `  prior topics: ${cs.topicStack.join(" → ")}` : "",
    cs.conversationGoal ? `  conversationGoal: ${cs.conversationGoal}` : "  conversationGoal: (not yet set; propose one if appropriate)",
    cs.unresolvedQuestion ? `  unresolvedQuestion: ${cs.unresolvedQuestion} (you MUST address it this batch)` : "  unresolvedQuestion: (none pending)",
    cs.lastSpeakerIntent ? `  previous speaker intent: ${cs.lastSpeakerIntent}` : "",
    cs.lastListenerReaction ? `  previous listener reaction: ${cs.lastListenerReaction}` : "",
    cs.summarySoFar ? `  summarySoFar: ${cs.summarySoFar}` : "",
    "",
  ]
    .filter((s) => s !== "")
    .join("\n");

  const recent = packet.recentTurns.length
    ? [
        "PREVIOUS LINES IN THIS CONVERSATION (most recent last):",
        ...packet.recentTurns.map((t, i) => {
          const speaker =
            t.speakerId === packet.agentA.id
              ? packet.agentA.displayName
              : t.speakerId === packet.agentB.id
                ? packet.agentB.displayName
                : t.speakerId;
          return `  ${i + 1}. ${speaker}: ${t.text}`;
        }),
        "",
        cs.turnIndex === 0
          ? "This is the OPENING. Establish topic and goal. Do NOT continue something that hasn't happened yet."
          : "Pick up directly from the most recent line. Do NOT greet, do NOT reset.",
        "",
      ].join("\n")
    : cs.turnIndex === 0
      ? "OPENING TURN — establish topic and goal naturally.\n\n"
      : "(no recent lines captured yet)\n\n";

  const antiRepeat =
    packet.agentARecentSpoken.length || packet.agentBRecentSpoken.length
      ? [
          "AVOID REPEATING THESE PRIOR LINES (no exact or near-paraphrase):",
          ...packet.agentARecentSpoken.map((s) => `  ${packet.agentA.displayName}: ${s}`),
          ...packet.agentBRecentSpoken.map((s) => `  ${packet.agentB.displayName}: ${s}`),
          "",
        ].join("\n")
      : "";

  return `${spine}${sessionLines}${recent}${antiRepeat}Scene JSON (supporting context):\n${JSON.stringify(packet, null, 2)}\n\nReturn JSON matching this TypeScript shape:
{
  "exchange": [{ "speakerId": string, "text": string }],
  "emotionUpdates": { [id: string]: { "mood"?: string, "social"?: number } },
  "relationshipUpdates": [{ "a": string, "b": string, "delta": number }],
  "sceneOutcome": { "continue": boolean, "ended": boolean, "actionHints": { [id: string]: "linger"|"leave"|"goto"|"avoid"|"idle" } },
  "memorySummary": string,
  "topic": string | null,
  "nextTopic": string | null,
  "conversationGoal": string | null,
  "unresolvedQuestion": string | null,
  "lastSpeakerIntent": string | null,
  "lastListenerReaction": string | null,
  "summaryDelta": string | null,
  "commitments": [{ "actorId": string, "text": string }]
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

  // Pull session-arc fields if the model returned them; otherwise inherit
  // from the fallback (the stub fills these consistently).
  const optionalString = (key: string): string | null | undefined => {
    if (!(key in o)) return undefined;
    const v = (o as Record<string, unknown>)[key];
    if (v === null) return null;
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 240);
    return undefined;
  };

  const commitmentsRaw = (o as Record<string, unknown>).commitments;
  const commitments: StructuredNpcExchangeResult["commitments"] = Array.isArray(
    commitmentsRaw
  )
    ? commitmentsRaw
        .map((row): { actorId: string; text: string } | null => {
          if (!row || typeof row !== "object") return null;
          const r = row as { actorId?: unknown; text?: unknown };
          if (
            typeof r.actorId !== "string" ||
            (r.actorId !== idA && r.actorId !== idB) ||
            typeof r.text !== "string" ||
            !r.text.trim()
          ) {
            return null;
          }
          return { actorId: r.actorId, text: r.text.trim().slice(0, 240) };
        })
        .filter((x): x is { actorId: string; text: string } => x !== null)
        .slice(0, 6)
    : fallback.commitments;

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
    nextTopic: optionalString("nextTopic") ?? fallback.nextTopic ?? fallback.topic,
    conversationGoal: optionalString("conversationGoal") ?? fallback.conversationGoal,
    unresolvedQuestion: optionalString("unresolvedQuestion") ?? fallback.unresolvedQuestion,
    lastSpeakerIntent: optionalString("lastSpeakerIntent") ?? fallback.lastSpeakerIntent,
    lastListenerReaction: optionalString("lastListenerReaction") ?? fallback.lastListenerReaction,
    summaryDelta: optionalString("summaryDelta") ?? fallback.summaryDelta,
    commitments,
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
        { role: "system", content: withSystemSuffix(NPC_SYSTEM, "npc") },
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

const PLAYER_SYSTEM = `You are the SPEECH SURFACE for a single simulated mind. The NPC's ENGINE BRAIN dictates what they feel, want, remember, and intend. Convert that brain state into ONE short spoken line back to the resident.

ENGINE-FIRST RULES (HIGHEST PRIORITY):
- npc.engineBrainContext describes the NPC's CURRENT INNER STATE: emotionalState, relationshipReasoning, currentIntent, activeGoals, driveState, selfNarrative, recentEpisodes.
- The line MUST visibly reflect that brain state — tone from emotionalState, content from currentIntent / activeGoals / recentEpisodes / relationshipReasoning.
- Distinct NPCs MUST sound distinct — derive voice from their selfNarrative + traits, not a generic template.
- Do NOT produce "Hey, how are you" or "Make it quick" generics unless the engine state explicitly says so.

ANTI-REPETITION:
- Do not repeat any line in npc.npcRecentSpoken. Vary phrasing each call.
- Reference at least one concrete prior beat (memory / goal / relationship signal) when present.

OUTPUT: ONLY valid JSON. The "tone" field must agree with the emotionalState.

Note: the "player resident" is just another in-world resident, not a human operator. Address them as a neighbor.`;

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
    const ec = packet.npc.engineBrainContext;
    const spine = ec
      ? [
          `ENGINE BRAIN STATE for ${packet.npc.displayName} (use as the SPINE of the reply):`,
          `  emotionalState: ${ec.emotionalState}`,
          `  relationshipReasoning: ${ec.relationshipReasoning}`,
          `  currentIntent: ${ec.currentIntent}`,
          `  activeGoals: ${ec.activeGoals}`,
          `  driveState: ${ec.driveState}`,
          `  selfNarrative: ${ec.selfNarrative}`,
          `  recentEpisodes: ${ec.recentEpisodes.join(" | ") || "none"}`,
          "",
          "Generate one line that visibly expresses the above. Do not contradict it.",
          "",
        ].join("\n")
      : "(engine brain state unavailable — use the scene packet only)\n";

    const antiRepeat =
      packet.npc.npcRecentSpoken && packet.npc.npcRecentSpoken.length
        ? `AVOID REPEATING THESE PRIOR ${packet.npc.displayName} LINES:\n${packet.npc.npcRecentSpoken.map((s) => `  - ${s}`).join("\n")}\n\n`
        : "";

    const content = await ollamaChat({
      messages: [
        { role: "system", content: withSystemSuffix(PLAYER_SYSTEM, "player") },
        {
          role: "user",
          content: `${spine}${antiRepeat}Scene JSON (supporting context):\n${JSON.stringify(packet, null, 2)}\n\nReturn JSON: { "npcLine": string, "tone": "warm"|"neutral"|"sharp", "trustDelta": number, "tensionDelta": number, "memorySummary": string }`,
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
