/**
 * Structured NPC↔NPC dialogue: one LLM call per tick = one micro-exchange (A line + B line) + effects.
 * Engine owns when to talk, budgets, and cooldowns; the model fills lines + deltas + continue/stop.
 *
 * Wire a real LLM: POST JSON scene packet → parse StructuredNpcExchangeResult (strict JSON).
 * Player↔NPC: use generateStubPlayerNpcReply (one NPC line per call) — see conversationPlayer.ts
 */

import type { MemorySystem } from "./MemorySystem";
import type { LocationRegistry } from "./LocationRegistry";
import type { CharacterGender, ConversationTurn, CurrentAction, Mood, TownEntity } from "./types";
import { getMergedAgentSlice } from "./settings/aiSimSettings";
import { ensureRelationship, applyConversationOutcome } from "./SocialSystem";
import type { FollowUpAction } from "./types";
import { formatDesiresLine, formatNeedsLine } from "./DailyPlanSystem";
import { buildLlmLifeFields } from "./LifeArcSystem";

function formatActivityLine(e: TownEntity, locationLabel: string): string {
  const role = e.role;
  const act = e.currentAction;
  const loc = e.currentLocationId ?? "";
  if (loc.includes("counter") || loc.includes("order") || loc.includes("worker")) {
    return `On shift / at service — ${act} at ${locationLabel} (${role})`;
  }
  if (loc.includes("dining") || loc.includes("booth") || act === "sitting") {
    return `Settled in — ${act} at ${locationLabel} (${role})`;
  }
  if (act === "walking") {
    return `Passing through — ${act} near ${locationLabel} (${role})`;
  }
  if (act === "talking") {
    return `In dialogue — at ${locationLabel} (${role})`;
  }
  return `${act} at ${locationLabel} (${role})`;
}

function pickLocationForPair(
  a: TownEntity,
  b: TownEntity,
  locations: LocationRegistry
): { id: string | null; label: string; kind: string } {
  const id =
    a.currentLocationId && a.currentLocationId === b.currentLocationId
      ? a.currentLocationId
      : a.currentLocationId ?? b.currentLocationId;
  const loc = id ? locations.get(id) : undefined;
  const label = loc?.label ?? "town";
  return { id: id ?? null, label, kind: String(loc?.type ?? "area") };
}

/** Input JSON you send to the model for NPC↔NPC (one tick). */
export type NpcConversationScenePacket = {
  scene: {
    locationId: string | null;
    locationLabel: string;
    locationKind: string;
    environmentHint: string;
    timeOfDay: "morning" | "afternoon" | "evening" | "night";
  };
  /** Last few lines of this same conversation (no other speakers). */
  recentTurns: Array<{ speakerId: string; text: string; timestamp: number }>;
  scriptGuidance: {
    continueThread: boolean;
  };
  agentA: {
    id: string;
    displayName: string;
    gender: CharacterGender;
    role: string;
    traits: string[];
    mood: Mood;
    currentAction: CurrentAction;
    activityLine: string;
    goal: string;
    relationshipToB: string;
    recentMemorySummaries: string[];
    /** Optional scene-painting / speaking-style notes from user settings. */
    personaNotes?: string;
    dailyHeadline?: string;
    dayProgressLine?: string;
    dailyNeedsLine?: string;
    dailyDesiresLine?: string;
    survivalUrgencyLine?: string;
    lifeInTownLine?: string;
    voiceAndPersonaLine?: string;
    otherPossibleRolesLine?: string;
  };
  agentB: {
    id: string;
    displayName: string;
    gender: CharacterGender;
    role: string;
    traits: string[];
    mood: Mood;
    currentAction: CurrentAction;
    activityLine: string;
    goal: string;
    relationshipToA: string;
    recentMemorySummaries: string[];
    personaNotes?: string;
    dailyHeadline?: string;
    dayProgressLine?: string;
    dailyNeedsLine?: string;
    dailyDesiresLine?: string;
    survivalUrgencyLine?: string;
    lifeInTownLine?: string;
    voiceAndPersonaLine?: string;
    otherPossibleRolesLine?: string;
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
  return { maxTurns };
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
  lastTopic: string | null,
  /** Last lines in *this* conversation; drives continuation and anti-repetition. */
  conversationTurns: ConversationTurn[] = []
): NpcConversationScenePacket {
  const { id: placeId, label, kind } = pickLocationForPair(a, b, locations);
  const loc = placeId ? locations.get(placeId) : locations.all()[0];
  const env =
    loc?.type === "store" || loc?.type === "business"
      ? "indoor, public-facing"
      : loc?.type === "outdoor" || loc?.type === "park"
        ? "outdoors, open air"
        : loc?.type === "path"
          ? "along a path"
          : "in town";
  const ra = ensureRelationship(a, b.id);
  const rb = ensureRelationship(b, a.id);
  const memA = memories.recentFor(a, 2).map((m) => m.summary);
  const memB = memories.recentFor(b, 2).map((m) => m.summary);
  const pa = getMergedAgentSlice(a);
  const pb = getMergedAgentSlice(b);
  const recentWindow = conversationTurns.slice(-4);

  const dailySlice = (e: TownEntity) => {
    const p = e.dailyPlan;
    if (!p) return {};
    const total = p.objectives.length;
    const done = p.objectives.filter((o) => o.completed).length;
    return {
      dailyHeadline: p.headline,
      dayProgressLine: `${done}/${total} objectives · day arc ${(p.arcProgress * 100).toFixed(0)}% · fulfillment ${(p.fulfillment * 100).toFixed(0)}%`,
      dailyNeedsLine: formatNeedsLine(p),
      dailyDesiresLine: formatDesiresLine(p),
    };
  };

  return {
    scene: {
      locationId: placeId ?? loc?.id ?? null,
      locationLabel: label,
      locationKind: kind,
      environmentHint: env,
      timeOfDay: timeOfDayBucket(),
    },
    recentTurns: recentWindow.map((t) => ({
      speakerId: t.speakerId,
      text: t.text,
      timestamp: t.timestamp,
    })),
    scriptGuidance: {
      continueThread: recentWindow.length > 0,
    },
    agentA: {
      id: a.id,
      displayName: pa.displayName,
      gender: pa.gender,
      role: pa.role,
      traits: [...pa.traits],
      mood: pa.mood,
      currentAction: a.currentAction,
      activityLine: formatActivityLine(a, label),
      goal: a.currentGoal,
      relationshipToB: `trust ${ra.trust.toFixed(2)}, tension ${ra.tension.toFixed(2)}`,
      recentMemorySummaries: memA,
      ...(pa.personaNotes ? { personaNotes: pa.personaNotes } : {}),
      ...buildLlmLifeFields(a),
      ...dailySlice(a),
    },
    agentB: {
      id: b.id,
      displayName: pb.displayName,
      gender: pb.gender,
      role: pb.role,
      traits: [...pb.traits],
      mood: pb.mood,
      currentAction: b.currentAction,
      activityLine: formatActivityLine(b, label),
      goal: b.currentGoal,
      relationshipToA: `trust ${rb.trust.toFixed(2)}, tension ${rb.tension.toFixed(2)}`,
      recentMemorySummaries: memB,
      ...(pb.personaNotes ? { personaNotes: pb.personaNotes } : {}),
      ...buildLlmLifeFields(b),
      ...dailySlice(b),
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
  const { agentA, agentB, scene, conversationState, scriptGuidance, recentTurns } =
    packet;
  const tension = parseFloat(
    agentA.relationshipToB.match(/tension ([\d.]+)/)?.[1] ?? "0.3"
  );

  const continuing = scriptGuidance.continueThread && recentTurns.length > 0;
  const lineA = continuing
    ? tension > 0.65
      ? `I'm listening — but keep it short.`
      : `Picking that up — ${scene.locationLabel} and ${scene.environmentHint} fit what we were saying.`
    : tension > 0.65
      ? `Make it quick — I'm not in the mood.`
      : `Didn't think I'd run into you here.`;

  const lineB = continuing
    ? agentB.mood === "annoyed" || tension > 0.55
      ? `Point taken. I'll match your pace.`
      : `Same — I was about to head out, so one more thing…`
    : agentB.mood === "annoyed" || tension > 0.55
      ? `Yeah. Small place.`
      : `I was just about to ask the same.`;

  const turn = conversationState.turnNumber;
  const maxT = conversationState.maxTurns;
  const continueConv = turn < maxT && tension < 0.72;

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
