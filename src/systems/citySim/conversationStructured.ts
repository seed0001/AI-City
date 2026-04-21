/**
 * Structured NPC↔NPC dialogue: one LLM call per tick = one micro-exchange (A line + B line) + effects.
 * Engine owns when to talk, budgets, and cooldowns; the model fills lines + deltas + continue/stop.
 *
 * Wire a real LLM: POST JSON scene packet → parse StructuredNpcExchangeResult (strict JSON).
 * Player↔NPC: use generateStubPlayerNpcReply (one NPC line per call) — see conversationPlayer.ts
 */

import type { MemorySystem } from "./MemorySystem";
import type { LocationRegistry } from "./LocationRegistry";
import type { Mood, TownEntity } from "./types";
import { ensureRelationship, applyConversationOutcome } from "./SocialSystem";
import type { FollowUpAction } from "./types";

/** Input JSON you send to the model for NPC↔NPC (one tick). */
export type NpcConversationScenePacket = {
  scene: {
    locationId: string | null;
    locationLabel: string;
    timeOfDay: "morning" | "afternoon" | "evening" | "night";
  };
  agentA: {
    id: string;
    displayName: string;
    role: string;
    traits: string[];
    mood: Mood;
    goal: string;
    relationshipToB: string;
    recentMemorySummaries: string[];
  };
  agentB: {
    id: string;
    displayName: string;
    role: string;
    traits: string[];
    mood: Mood;
    goal: string;
    relationshipToA: string;
    recentMemorySummaries: string[];
  };
  conversationState: {
    turnNumber: number;
    lastTopic: string | null;
    maxTurns: number;
  };
};

/** Strict JSON output from the model (NPC↔NPC, one tick). */
export type StructuredNpcExchangeResult = {
  exchange: Array<{ speakerId: string; text: string }>;
  emotionUpdates: Record<
    string,
    { mood?: string; social?: number }
  >;
  relationshipUpdates: Array<{
    a: string;
    b: string;
    delta: number;
  }>;
  sceneOutcome: {
    continue: boolean;
    ended: boolean;
    actionHints: Record<string, "linger" | "leave" | "goto" | "avoid" | "idle">;
  };
  memorySummary: string;
  topic: string | null;
};

export function computeTalkBudget(a: TownEntity, b: TownEntity): {
  maxTurns: number;
  tickMs: number;
} {
  const hungry = Math.max(a.hunger, b.hunger);
  const tired = Math.min(a.energy, b.energy);
  const ra = ensureRelationship(a, b.id);
  let maxTurns = 4;
  if (hungry > 0.8) maxTurns = 1;
  else if (hungry > 0.6) maxTurns = 2;
  if (tired < 0.22) maxTurns = Math.min(maxTurns, 2);
  if (ra.tension > 0.78) maxTurns = Math.min(maxTurns, 2);
  if (ra.tension > 0.55) maxTurns = Math.min(maxTurns, 3);
  const tickMs = 2400 + Math.random() * 900;
  return { maxTurns, tickMs };
}

function timeOfDayBucket(): NpcConversationScenePacket["scene"]["timeOfDay"] {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

export function buildNpcConversationScenePacket(
  a: TownEntity,
  b: TownEntity,
  locations: LocationRegistry,
  memories: MemorySystem,
  nextTurnNumber: number,
  maxTurns: number,
  lastTopic: string | null
): NpcConversationScenePacket {
  const loc =
    (a.currentLocationId
      ? locations.get(a.currentLocationId)
      : undefined) ?? locations.all()[0];
  const label = loc?.label ?? "town";
  const ra = ensureRelationship(a, b.id);
  const rb = ensureRelationship(b, a.id);
  const memA = memories.recentFor(a, 3).map((m) => m.summary);
  const memB = memories.recentFor(b, 3).map((m) => m.summary);

  return {
    scene: {
      locationId: loc?.id ?? null,
      locationLabel: label,
      timeOfDay: timeOfDayBucket(),
    },
    agentA: {
      id: a.id,
      displayName: a.displayName,
      role: a.role,
      traits: [...a.traits],
      mood: a.mood,
      goal: a.currentGoal,
      relationshipToB: `trust ${ra.trust.toFixed(2)}, tension ${ra.tension.toFixed(2)}`,
      recentMemorySummaries: memA,
    },
    agentB: {
      id: b.id,
      displayName: b.displayName,
      role: b.role,
      traits: [...b.traits],
      mood: b.mood,
      goal: b.currentGoal,
      relationshipToA: `trust ${rb.trust.toFixed(2)}, tension ${rb.tension.toFixed(2)}`,
      recentMemorySummaries: memB,
    },
    conversationState: {
      turnNumber: nextTurnNumber,
      lastTopic,
      maxTurns,
    },
  };
}

/** Stub: one structured micro-exchange (replace with LLM + JSON parse). */
export function generateStubStructuredNpcExchange(
  packet: NpcConversationScenePacket
): StructuredNpcExchangeResult {
  const { agentA, agentB, scene, conversationState } = packet;
  const tension = parseFloat(
    agentA.relationshipToB.match(/tension ([\d.]+)/)?.[1] ?? "0.3"
  );

  const lineA =
    tension > 0.65
      ? `Make it quick — I'm not in the mood.`
      : `Fancy seeing you near ${scene.locationLabel}.`;

  const lineB =
    agentB.mood === "annoyed" || tension > 0.55
      ? `Yeah. Small town.`
      : `Hey — got a second?`;

  const turn = conversationState.turnNumber;
  const maxT = conversationState.maxTurns;
  const continueConv =
    turn < maxT &&
    tension < 0.72 &&
    Math.random() < (turn === 1 ? 0.62 : 0.45);

  const trustDelta = tension > 0.55 ? -0.03 : 0.04;
  const tensionDelta = tension > 0.55 ? 0.05 : -0.02;

  return {
    exchange: [
      { speakerId: agentA.id, text: lineA },
      { speakerId: agentB.id, text: lineB },
    ],
    emotionUpdates: {
      [agentA.id]: { mood: agentA.mood, social: tensionDelta > 0 ? -0.05 : 0.03 },
      [agentB.id]: { mood: agentB.mood, social: 0.02 },
    },
    relationshipUpdates: [{ a: agentA.id, b: agentB.id, delta: trustDelta }],
    sceneOutcome: {
      continue: continueConv,
      ended: !continueConv,
      actionHints: {
        [agentA.id]: continueConv ? "linger" : "leave",
        [agentB.id]: continueConv ? "linger" : "idle",
      },
    },
    memorySummary: `${agentA.displayName} and ${agentB.displayName} exchanged a short line at ${scene.locationLabel}.`,
    topic: tension > 0.55 ? "tension" : "greeting",
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Apply structured tick to entities, relationships, and memory. */
export function applyStructuredNpcExchange(
  result: StructuredNpcExchangeResult,
  a: TownEntity,
  b: TownEntity,
  memory: MemorySystem,
  locationId: string | null
): void {
  const delta =
    result.relationshipUpdates.find(
      (r) =>
        (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id)
    )?.delta ?? 0;

  const trustDelta = delta * 0.5;
  const tensionDelta = -delta * 0.3;
  applyConversationOutcome(a, b, trustDelta, tensionDelta, 0.04);

  for (const [id, upd] of Object.entries(result.emotionUpdates)) {
    const e = id === a.id ? a : id === b.id ? b : null;
    if (!e) continue;
    if (typeof upd.social === "number") {
      e.socialTolerance = clamp01(e.socialTolerance + upd.social);
    }
  }

  memory.add([a, b], {
    type: "conversation",
    locationId,
    summary: result.memorySummary,
    emotionalImpact: tensionDelta > 0 ? -0.15 : 0.12,
  });
}

export function hintToFollowUp(
  hint: string | undefined,
  fallback: FollowUpAction
): FollowUpAction {
  if (hint == null || hint === "") return fallback;
  switch (hint) {
    case "leave":
      return "leave";
    case "goto":
      return "goto";
    case "avoid":
      return "avoid";
    case "idle":
      return "idle";
    case "linger":
      return "continue";
    default:
      return fallback;
  }
}
