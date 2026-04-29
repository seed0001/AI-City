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
import type { EngineBrainContext } from "./brains/residentBrainClient";
import {
  budgetForCategory,
  inferCategory,
  type ConversationCategory,
  type ConversationStatus,
  type EmotionalTone,
} from "./conversationSession";

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
  /** Last lines that *either* agent has spoken in any recent conversation; for anti-repetition. */
  agentARecentSpoken: string[];
  agentBRecentSpoken: string[];
  scriptGuidance: {
    continueThread: boolean;
    /** When true, the engine cognition layer was the source of context. */
    engineDriven: boolean;
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
    episodicMemorySummaries?: string[];
    longTermMemorySummaries?: string[];
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
    brainContextLine?: string;
    /** STRUCTURED engine cognition context (must dominate the prompt). */
    engineBrainContext?: EngineBrainContext;
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
    episodicMemorySummaries?: string[];
    longTermMemorySummaries?: string[];
    personaNotes?: string;
    dailyHeadline?: string;
    dayProgressLine?: string;
    dailyNeedsLine?: string;
    dailyDesiresLine?: string;
    survivalUrgencyLine?: string;
    lifeInTownLine?: string;
    voiceAndPersonaLine?: string;
    otherPossibleRolesLine?: string;
    brainContextLine?: string;
    engineBrainContext?: EngineBrainContext;
  };
  conversationState: {
    /** Total individual lines spoken so far across all batches (one speaker = one turn). */
    turnIndex: number;
    /** Backwards-compat alias of turnIndex; always equals it. */
    turnNumber: number;
    lastTopic: string | null;
    /** Whole topic history; lastTopic is the head. */
    topicStack: string[];
    /** Floor — below this we keep going regardless of what the model says. */
    minTurns: number;
    /** Ceiling — at or above this we stop. */
    maxTurns: number;
    /** Casual / emotional / planning / work / argument / deep. */
    category: ConversationCategory;
    /** active | winding_down | ended. */
    status: ConversationStatus;
    /** warm | neutral | tense | playful | heavy | guarded. */
    emotionalTone: EmotionalTone;
    /** What the conversation is trying to resolve, plain English. */
    conversationGoal: string | null;
    /** A pending question someone asked that hasn't been answered yet. */
    unresolvedQuestion: string | null;
    /** Plain-English running summary of the arc so far. */
    summarySoFar: string;
    /** Last speaker's effective intent, for the prompt. */
    lastSpeakerIntent: string | null;
    /** Listener's last reaction, for the prompt. */
    lastListenerReaction: string | null;
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
  /**
   * Optional session-arc fields. If the LLM fills them they update the live
   * ConversationSession; if absent the stub fills them from heuristics.
   */
  nextTopic?: string | null;
  conversationGoal?: string | null;
  unresolvedQuestion?: string | null;
  lastSpeakerIntent?: string | null;
  lastListenerReaction?: string | null;
  /** Plain-English delta for the running summary of the conversation. */
  summaryDelta?: string | null;
  /** Promises / plans / commitments produced this batch. */
  commitments?: Array<{ actorId: string; text: string }>;
};

/**
 * Budget for a brand-new conversation. Pick the category from openers +
 * relationship state, then return the matching min/max turn band. Body /
 * energy state nudges minTurns down a little (don't force a 10-turn
 * starvation arc) but never below a 2-turn floor.
 *
 * Replaces the old `computeTalkBudget` which treated every conversation
 * the same and capped at 4 micro-exchanges. Caller passes optional
 * topic / opener text (e.g. the brain's currentIntent) so category
 * inference has signal beyond just mood + tension.
 */
export function computeConversationBudget(
  a: TownEntity,
  b: TownEntity,
  hints?: { topic?: string | null; openerText?: string | null }
): {
  category: ConversationCategory;
  minTurns: number;
  maxTurns: number;
} {
  const category = inferCategory({
    a,
    b,
    topic: hints?.topic ?? null,
    openerText: hints?.openerText ?? null,
  });
  const base = budgetForCategory(category);

  // Survival pressure trims minTurns toward (but not past) a hard floor of 2.
  let minTurns = base.minTurns;
  let maxTurns = base.maxTurns;
  const hungry = Math.max(a.hunger, b.hunger);
  const tired = Math.min(a.energy, b.energy);
  if (hungry > 0.85 || tired < 0.1) {
    // Severe pressure: cut min in half (rounded up), cap max harshly.
    minTurns = Math.max(2, Math.ceil(minTurns / 2));
    maxTurns = Math.min(maxTurns, Math.max(minTurns + 2, 6));
  } else if (hungry > 0.7 || tired < 0.18) {
    // Moderate pressure: trim by a quarter.
    minTurns = Math.max(2, Math.ceil(minTurns * 0.75));
    maxTurns = Math.min(maxTurns, Math.max(minTurns + 4, 8));
  }

  // Tension steepens the upper band slightly for arguments (keeps the
  // emotional charge from getting cut prematurely).
  const ra = ensureRelationship(a, b.id);
  if (category === "argument" && ra.tension > 0.7) {
    maxTurns = Math.min(20, maxTurns + 2);
  }

  return { category, minTurns, maxTurns };
}

/**
 * @deprecated Kept for backwards-compatibility with the old single-cap
 * call shape. Returns max turns rounded into the legacy "micro-exchange"
 * budget (=lines/2). Prefer computeConversationBudget().
 */
export function computeTalkBudget(a: TownEntity, b: TownEntity): {
  maxTurns: number;
} {
  const { maxTurns } = computeConversationBudget(a, b);
  return { maxTurns: Math.max(1, Math.ceil(maxTurns / 2)) };
}

function timeOfDayBucket(): NpcConversationScenePacket["scene"]["timeOfDay"] {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

/** Live session state passed into the scene packet builder. */
export interface SessionPacketState {
  turnIndex: number;
  minTurns: number;
  maxTurns: number;
  lastTopic: string | null;
  topicStack: string[];
  category: ConversationCategory;
  status: ConversationStatus;
  emotionalTone: EmotionalTone;
  conversationGoal: string | null;
  unresolvedQuestion: string | null;
  summarySoFar: string;
  lastSpeakerIntent: string | null;
  lastListenerReaction: string | null;
}

export function buildNpcConversationScenePacket(
  a: TownEntity,
  b: TownEntity,
  locations: LocationRegistry,
  memories: MemorySystem,
  session: SessionPacketState,
  /** Last lines in *this* conversation; drives continuation and anti-repetition. */
  conversationTurns: ConversationTurn[] = [],
  engineContexts: {
    a?: EngineBrainContext;
    b?: EngineBrainContext;
    /** Authoritative — true only when both agents have engine context this tick. */
    engineDriven: boolean;
    /** Last spoken history per agent across recent dialogue, for anti-repetition. */
    agentARecentSpoken?: string[];
    agentBRecentSpoken?: string[];
  } = { engineDriven: false }
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
  const layeredA = memories.layeredSummariesFor(a, {
    shortTermLimit: 2,
    episodicLimit: 5,
    longTermLimit: 4,
  });
  const layeredB = memories.layeredSummariesFor(b, {
    shortTermLimit: 2,
    episodicLimit: 5,
    longTermLimit: 4,
  });
  const pa = getMergedAgentSlice(a);
  const pb = getMergedAgentSlice(b);
  // Wider window now that sessions are multi-turn — gives the LLM enough
  // continuity to actually carry an arc instead of restating the topic.
  const recentWindow = conversationTurns.slice(-8);

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
    agentARecentSpoken: engineContexts.agentARecentSpoken ?? [],
    agentBRecentSpoken: engineContexts.agentBRecentSpoken ?? [],
    scriptGuidance: {
      continueThread: session.turnIndex > 0 || recentWindow.length > 0,
      engineDriven: engineContexts.engineDriven,
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
      recentMemorySummaries: layeredA.shortTerm,
      episodicMemorySummaries: layeredA.episodic,
      longTermMemorySummaries: layeredA.longTerm,
      ...(pa.personaNotes ? { personaNotes: pa.personaNotes } : {}),
      ...(a.lastBrainConversationContext
        ? { brainContextLine: a.lastBrainConversationContext }
        : {}),
      ...(engineContexts.a ? { engineBrainContext: engineContexts.a } : {}),
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
      recentMemorySummaries: layeredB.shortTerm,
      episodicMemorySummaries: layeredB.episodic,
      longTermMemorySummaries: layeredB.longTerm,
      ...(pb.personaNotes ? { personaNotes: pb.personaNotes } : {}),
      ...(b.lastBrainConversationContext
        ? { brainContextLine: b.lastBrainConversationContext }
        : {}),
      ...(engineContexts.b ? { engineBrainContext: engineContexts.b } : {}),
      ...buildLlmLifeFields(b),
      ...dailySlice(b),
    },
    conversationState: {
      turnIndex: session.turnIndex,
      turnNumber: session.turnIndex,
      lastTopic: session.lastTopic,
      topicStack: [...session.topicStack],
      minTurns: session.minTurns,
      maxTurns: session.maxTurns,
      category: session.category,
      status: session.status,
      emotionalTone: session.emotionalTone,
      conversationGoal: session.conversationGoal,
      unresolvedQuestion: session.unresolvedQuestion,
      summarySoFar: session.summarySoFar,
      lastSpeakerIntent: session.lastSpeakerIntent,
      lastListenerReaction: session.lastListenerReaction,
    },
  };
}

/**
 * Stub for a single batch when Ollama is unavailable. Topic-aware and arc-
 * aware so even without an LLM, conversations carry forward, ask follow-up
 * questions, and don't reset the scene every batch.
 *
 * Replace with an LLM call returning JSON matching StructuredNpcExchangeResult.
 */
export function generateStubStructuredNpcExchange(
  packet: NpcConversationScenePacket
): StructuredNpcExchangeResult {
  const { agentA, agentB, scene, conversationState } = packet;
  const tension = parseFloat(
    agentA.relationshipToB.match(/tension ([\d.]+)/)?.[1] ?? "0.3"
  );
  const turn = conversationState.turnIndex;
  const minT = conversationState.minTurns;
  const maxT = conversationState.maxTurns;
  const isOpener = turn === 0;
  const isWindingDown = turn >= minT && turn >= maxT - 2;
  const category = conversationState.category;

  const ecA = agentA.engineBrainContext;
  const ecB = agentB.engineBrainContext;
  const intentA = ecA?.currentIntent ?? null;
  const intentB = ecB?.currentIntent ?? null;
  const goalsA = ecA?.activeGoals ?? null;
  const goalsB = ecB?.activeGoals ?? null;
  const driveA = ecA?.driveState ?? null;
  const epA = ecA?.recentEpisodes?.[0] ?? null;
  const epB = ecB?.recentEpisodes?.[0] ?? null;

  // -------- Lines --------
  // The opener establishes topic + question; subsequent batches push the
  // arc forward instead of resetting.
  let lineA: string;
  let lineB: string;
  let nextTopic = conversationState.lastTopic;
  let unresolvedQuestion = conversationState.unresolvedQuestion;
  let conversationGoal = conversationState.conversationGoal;

  if (isOpener) {
    if (category === "argument" || tension > 0.6) {
      lineA = `${agentB.displayName}, we need to talk about ${intentA ?? `what's been going on between us`}. I can't keep stepping around it.`;
      lineB = intentB
        ? `Then say it plainly. You think ${intentB.toLowerCase()} fixes any of this?`
        : `Fine. Say it. I'd rather we have it out than keep circling.`;
      conversationGoal = `resolve the friction over ${intentA ?? "recent events"}`;
      unresolvedQuestion = `Will ${agentB.displayName} concede or push back?`;
      nextTopic = nextTopic ?? "the friction between us";
    } else if (category === "planning" || category === "work") {
      const subject = intentA ?? goalsA ?? "what's coming up";
      lineA = `${agentB.displayName} — got a minute? I want to figure out ${subject}. There are a couple things that won't sort themselves.`;
      lineB = `Walk me through it. What's the part that's actually stuck?`;
      conversationGoal = `decide on a plan for ${subject}`;
      unresolvedQuestion = `What is the actual blocker, and who handles which part?`;
      nextTopic = nextTopic ?? subject;
    } else if (category === "emotional" || category === "deep") {
      lineA = `${agentB.displayName}, I've been carrying ${driveA ?? "something"} and I don't know who else to say it to. ${epA ? `Still thinking about ${epA}.` : ""}`.trim();
      lineB = `Hey — I'm here. What's sitting on you?`;
      conversationGoal = `give ${agentA.displayName} room to be honest about it`;
      unresolvedQuestion = `What does ${agentA.displayName} actually need right now?`;
      nextTopic = nextTopic ?? (driveA ?? "something heavy");
    } else {
      lineA = epA
        ? `Hey — funny running into you. Still got ${epA} on my mind, honestly.`
        : `Hey. ${intentA ?? "Glad to catch you actually."}`;
      lineB = goalsB
        ? `Same — I'm half on my way to ${goalsB}, but I've got a minute. What's good?`
        : `Same here. What's been on your mind?`;
      conversationGoal = `catch up briefly`;
      unresolvedQuestion = `What's actually going on with each of us?`;
      nextTopic = nextTopic ?? (epA ?? "catching up");
    }
  } else if (isWindingDown) {
    // Wind-down: acknowledge what we agreed/disagreed on; either commit or
    // explicitly leave it open.
    if (category === "argument" || category === "emotional") {
      lineA = `Alright. I don't know if we landed it, but I heard you. ${unresolvedQuestion ? `Still on ${unresolvedQuestion.slice(0, 60)}.` : ""}`.trim();
      lineB = `Same. We can pick this up. I'm not gone on it.`;
    } else if (category === "planning" || category === "work") {
      lineA = `So — to be clear, ${intentA ?? "I'll handle my piece"}. You good with that?`;
      lineB = goalsB
        ? `Yeah. I'll cover ${goalsB}. We'll regroup.`
        : `Yeah, I can run with that.`;
    } else {
      lineA = `Good talk — really. I'll catch up with you again soon.`;
      lineB = `Yeah, take care. ${epB ? `Glad we touched on ${epB}.` : ""}`.trim();
    }
    unresolvedQuestion = null;
  } else {
    // Mid-arc: push the topic instead of restating it.
    if (category === "argument") {
      lineA = `Here's the thing — ${intentA ?? "I'm not making this up"}. ${epA ? `Last time, ${epA}.` : ""}`.trim();
      lineB = `I'm not saying you're making it up. I'm saying ${intentB ?? "I see it different"}, and that matters too.`;
    } else if (category === "planning" || category === "work") {
      lineA = goalsA
        ? `Where I'm at: ${goalsA}. The risk is if we don't name it, it'll bite us.`
        : `My read: we move on it now or we lose the window.`;
      lineB = goalsB
        ? `Hmm. I'd push back — I'm carrying ${goalsB}, and that's real. What if we phase it?`
        : `Then walk me through what you'd actually do. Specifics, not vibes.`;
      unresolvedQuestion = unresolvedQuestion ?? `Phased plan or all-at-once?`;
    } else if (category === "emotional" || category === "deep") {
      lineA = epA
        ? `What hits me is ${epA}. I keep coming back to it, and I don't know what to do with it.`
        : `I think the part I haven't said is — ${driveA ?? "I'm scared this is just where I am"}.`;
      lineB = `I hear that. ${intentB ? `For me it's ${intentB}.` : `It's hard to even put words on it.`} What would help right now?`;
      unresolvedQuestion = unresolvedQuestion ?? `What would actually help?`;
    } else {
      lineA = epA
        ? `Same place, same hours — and ${epA}. ${scene.locationLabel} kind of has a rhythm now.`
        : `Funny how the day goes. ${intentA ?? "Was thinking about something earlier."}`;
      lineB = goalsB
        ? `Yeah. Speaking of — I'm half-thinking about ${goalsB}. You ever do that?`
        : `Same. What's been good for you lately?`;
    }
  }

  // -------- Outcome shape --------
  // The LLM is normally authoritative on `continue`, but the stub bias is
  // honest: if we're under min, signal continue; otherwise tail off.
  const wantContinue = turn + 2 < minT || (turn + 2 < maxT && tension < 0.78);

  const trustDelta =
    category === "argument" ? (tension > 0.6 ? -0.04 : -0.01) : tension > 0.55 ? -0.02 : 0.04;
  const tensionDelta =
    category === "argument" ? (tension > 0.6 ? 0.05 : 0.02) : tension > 0.55 ? 0.03 : -0.025;

  const memorySummary = isOpener
    ? `${agentA.displayName} brought up ${nextTopic ?? "something"} with ${agentB.displayName} at ${scene.locationLabel}.`
    : isWindingDown
      ? `${agentA.displayName} and ${agentB.displayName} wrapped up the conversation about ${nextTopic ?? "things"} at ${scene.locationLabel}.`
      : `${agentA.displayName} and ${agentB.displayName} kept pushing on ${nextTopic ?? "the topic"} at ${scene.locationLabel}.`;

  // commitments: when planning/work and the responder uses "I'll cover" /
  // "I'll handle", record it as a commitment from B.
  const commitments: NonNullable<StructuredNpcExchangeResult["commitments"]> = [];
  if (/\bI'll (handle|cover|run|take|do)\b/i.test(lineB)) {
    commitments.push({
      actorId: agentB.id,
      text: `${agentB.displayName} agreed to take on part of the plan`,
    });
  }

  const summaryDelta = isOpener
    ? `${agentA.displayName} opened the topic; ${agentB.displayName} engaged.`
    : isWindingDown
      ? `Conversation winding down with ${commitments.length ? "a commitment" : "an open thread"}.`
      : `Both pushed deeper on ${nextTopic ?? "the topic"}.`;

  return {
    exchange: [
      { speakerId: agentA.id, text: lineA },
      { speakerId: agentB.id, text: lineB },
    ],
    emotionUpdates: {
      [agentA.id]: { mood: agentA.mood, social: tensionDelta > 0 ? -0.04 : 0.03 },
      [agentB.id]: { mood: agentB.mood, social: 0.02 },
    },
    relationshipUpdates: [{ a: agentA.id, b: agentB.id, delta: trustDelta }],
    sceneOutcome: {
      continue: wantContinue,
      ended: !wantContinue,
      actionHints: {
        [agentA.id]: wantContinue ? "linger" : isWindingDown ? "leave" : "linger",
        [agentB.id]: wantContinue ? "linger" : "idle",
      },
    },
    memorySummary,
    topic: nextTopic,
    nextTopic,
    conversationGoal,
    unresolvedQuestion,
    lastSpeakerIntent: intentA ?? null,
    lastListenerReaction: intentB ?? null,
    summaryDelta,
    commitments,
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
