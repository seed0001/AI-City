/**
 * ConversationSession — the persistent owner of a multi-turn dialogue between
 * NPCs (or NPC↔player). Each session carries its own arc state (topic, goal,
 * unresolved question), its own turn budget by category, and decides when the
 * decision-loop is allowed to release its participants.
 *
 * Design: a session is a long-lived object that the ConversationSystem ticks.
 * The LLM is asked to deliver lines in 2-line batches (existing batched path
 * from conversationStructured), but turn counting, topic continuity,
 * continuation policy, interrupt detection, and end-of-arc memory all live
 * here. The decision system already skips entities with `inConversation=true`,
 * so the lock is the existing flag — this module just keeps the conversation
 * alive long enough for it to mean something.
 */
import type { Conversation, ConversationTurn, Mood, TownEntity } from "./types";
import { ensureRelationship } from "./SocialSystem";

/**
 * Six conversation kinds used to decide turn budgets. Inferred at session
 * start from opener content + relationship state, and may be re-classified
 * by the LLM via `nextTopic` (with capped category drift).
 */
export type ConversationCategory =
  | "casual"
  | "emotional"
  | "planning"
  | "work"
  | "argument"
  | "deep";

export type ConversationStatus = "active" | "winding_down" | "ended";

/**
 * `interrupt:*` reasons indicate the session was broken by a hard interrupt;
 * everything else is a soft-natural close.
 */
export type ConversationEndReason =
  | "natural_resolution"
  | "max_turns_reached"
  | "separated"
  | "idle_timeout"
  | "participant_lost"
  | "stub_failure"
  | "llm_stop_after_min"
  | "interrupt:hunger"
  | "interrupt:fatigue"
  | "interrupt:danger"
  | "interrupt:obligation"
  | "interrupt:dev_command";

export type EmotionalTone =
  | "warm"
  | "neutral"
  | "tense"
  | "playful"
  | "heavy"
  | "guarded";

/**
 * Live state for one in-flight conversation. Extends the public Conversation
 * shape so existing consumers keep working.
 */
export interface ConversationSession extends Conversation {
  category: ConversationCategory;
  /** Floor below which we override LLM "stop" signals. */
  minTurns: number;
  /** Ceiling — session ends regardless once hit. */
  maxTurns: number;
  /** Total individual lines spoken (one speaker = one turn). */
  turnIndex: number;
  /** Entity id of whoever spoke the most recent line (or null for openers). */
  currentSpeakerId: string | null;
  topic: string | null;
  /** Stack of historical topics; pushes when LLM signals topic-shift. */
  topicStack: string[];
  conversationGoal: string | null;
  unresolvedQuestion: string | null;
  /**
   * Last speaker's effective intent in plain English — e.g. "wants to vent",
   * "asking a favor". Updated from the latest LLM result.
   */
  lastSpeakerIntent: string | null;
  /**
   * Listener's reaction in plain English — "skeptical", "agrees", "deflecting".
   * Helps the next prompt build on the actual emotional beat.
   */
  lastListenerReaction: string | null;
  emotionalTone: EmotionalTone;
  relationshipContext: {
    trust: number;
    tension: number;
    familiarity: number;
  };
  /** Last 8 lines, used as direct prompt context. */
  recentLines: ConversationTurn[];
  /** Running plain-English summary of what's happened so far. */
  summarySoFar: string;
  status: ConversationStatus;
  endReason: ConversationEndReason | null;
  /** Why the most recent continuation tick chose continue vs end (debug). */
  lastContinuationReason: string;
  /** Last time interrupt detection looked at this session. */
  lastInterruptCheckAt: number;
  /** Commitments / promises / plans that came out of the conversation. */
  commitments: Array<{
    actorId: string;
    text: string;
  }>;
}

/**
 * Min/max line counts per category. A "turn" = one speaker's line, so a
 * minTurns of 6 = 3 back-and-forth cycles delivered as 3 batches.
 */
export function budgetForCategory(category: ConversationCategory): {
  minTurns: number;
  maxTurns: number;
} {
  switch (category) {
    case "casual":
      return { minTurns: 4, maxTurns: 8 };
    case "work":
      return { minTurns: 4, maxTurns: 10 };
    case "planning":
      return { minTurns: 6, maxTurns: 14 };
    case "emotional":
      return { minTurns: 8, maxTurns: 16 };
    case "argument":
      return { minTurns: 8, maxTurns: 20 };
    case "deep":
      return { minTurns: 10, maxTurns: 24 };
  }
}

const PLANNING_RX = /\b(plan|coordinate|strategy|decide|future|together|tomorrow)\b/i;
const WORK_RX = /\b(shift|schedule|order|stock|line|prep|work|customer|burger|kitchen|counter|rota|cover)\b/i;
const EMOTIONAL_RX = /\b(love|miss|sorry|hurt|cry|forgive|family|trust|fear|lonely|afraid|grief|loss)\b/i;
const DEEP_RX = /\b(meaning|purpose|future|life|believe|dream|honest|real|truth|why)\b/i;

/**
 * Pick a category from openers (topic + opener line) and relationship state.
 * Falls back to "casual" so we never crash the budget step.
 */
export function inferCategory(args: {
  a: TownEntity;
  b: TownEntity;
  topic?: string | null;
  openerText?: string | null;
}): ConversationCategory {
  const { a, b, topic, openerText } = args;
  const ra = ensureRelationship(a, b.id);
  const rb = ensureRelationship(b, a.id);
  const tension = Math.max(ra.tension, rb.tension);
  const trust = Math.min(ra.trust, rb.trust);
  const familiarity = Math.max(ra.familiarity, rb.familiarity);

  if (
    a.mood === "angry" ||
    b.mood === "angry" ||
    tension > 0.65
  ) {
    return "argument";
  }

  const blob = `${topic ?? ""} ${openerText ?? ""}`.trim();
  if (blob) {
    if (PLANNING_RX.test(blob)) return "planning";
    if (WORK_RX.test(blob)) return "work";
    if (EMOTIONAL_RX.test(blob)) return "emotional";
    if (DEEP_RX.test(blob) && trust > 0.45) return "deep";
  }

  if (trust > 0.7 && tension < 0.18 && familiarity > 0.4) return "deep";
  if (a.mood === "annoyed" || b.mood === "annoyed") {
    return tension > 0.4 ? "argument" : "casual";
  }
  return "casual";
}

/**
 * Surface emotional tone from category + relationship + mood. Used in the
 * prompt and the debug HUD; cheap to recompute each tick.
 */
export function inferEmotionalTone(args: {
  category: ConversationCategory;
  tension: number;
  moodA: Mood;
  moodB: Mood;
}): EmotionalTone {
  const { category, tension, moodA, moodB } = args;
  if (moodA === "angry" || moodB === "angry") return "tense";
  if (category === "argument") return "tense";
  if (tension > 0.55) return "guarded";
  if (category === "emotional") return "heavy";
  if (category === "deep") return "heavy";
  if (moodA === "friendly" && moodB === "friendly" && tension < 0.2) return "warm";
  if (moodA === "annoyed" || moodB === "annoyed") return "guarded";
  if (category === "casual" && tension < 0.15) return "playful";
  return "neutral";
}

/**
 * Decide whether a session should keep going after a batch landed.
 *
 * Policy (engine-wins-on-stop, per agreed tradeoff):
 *   - turnIndex < minTurns: ALWAYS continue (override LLM stop).
 *   - turnIndex >= maxTurns: stop.
 *   - unresolvedQuestion present: continue (regardless of LLM).
 *   - emotionalTone tense/heavy: continue at least one more cycle.
 *   - LLM said stop and tone is calm: stop (natural close).
 *   - default: continue.
 */
export interface ContinuationVerdict {
  shouldContinue: boolean;
  reason: string;
  endReason: ConversationEndReason | null;
}

export function decideContinuation(
  session: ConversationSession,
  llmContinue: boolean
): ContinuationVerdict {
  const { turnIndex, minTurns, maxTurns } = session;
  if (turnIndex >= maxTurns) {
    return {
      shouldContinue: false,
      reason: `max_turns reached (${turnIndex}/${maxTurns})`,
      endReason: "max_turns_reached",
    };
  }
  if (turnIndex < minTurns) {
    return {
      shouldContinue: true,
      reason: `under min_turns (${turnIndex}/${minTurns}); engine override`,
      endReason: null,
    };
  }
  if (session.unresolvedQuestion) {
    return {
      shouldContinue: true,
      reason: `unresolved question pending`,
      endReason: null,
    };
  }
  if (session.emotionalTone === "tense" || session.emotionalTone === "heavy") {
    if (turnIndex < Math.min(maxTurns, minTurns + 4)) {
      return {
        shouldContinue: true,
        reason: `${session.emotionalTone} tone — give the beat room`,
        endReason: null,
      };
    }
  }
  if (!llmContinue) {
    return {
      shouldContinue: false,
      reason: `llm signaled natural close after min`,
      endReason: "llm_stop_after_min",
    };
  }
  return {
    shouldContinue: true,
    reason: `post-min continuation (turn ${turnIndex}/${maxTurns})`,
    endReason: null,
  };
}

export interface InterruptVerdict {
  shouldBreak: boolean;
  reason: ConversationEndReason | null;
  participantId: string | null;
  detail: string;
}

const NO_INTERRUPT: InterruptVerdict = {
  shouldBreak: false,
  reason: null,
  participantId: null,
  detail: "",
};

/**
 * Conservative interrupt set: only true emergencies break a multi-turn
 * conversation below minTurns. (Per agreed tradeoff B: "conservative".)
 *
 *   hunger     >= 0.92  → "interrupt:hunger"
 *   energy     <= 0.06  → "interrupt:fatigue"
 *   threat within 4u    → "interrupt:danger"
 *   purpose pull >= 0.85 with crit objective → "interrupt:obligation"
 *
 * Dev/player interrupts arrive via ConversationSystem.endAllConversations
 * and bypass this check entirely.
 */
export function detectInterrupts(
  participants: TownEntity[],
  allEntities: TownEntity[]
): InterruptVerdict {
  for (const p of participants) {
    if (p.hunger >= 0.92) {
      return {
        shouldBreak: true,
        reason: "interrupt:hunger",
        participantId: p.id,
        detail: `${p.displayName} hunger ${(p.hunger * 100).toFixed(0)}%`,
      };
    }
    if (p.energy <= 0.06) {
      return {
        shouldBreak: true,
        reason: "interrupt:fatigue",
        participantId: p.id,
        detail: `${p.displayName} energy ${(p.energy * 100).toFixed(0)}%`,
      };
    }
    if (p.avoidingEntityId) {
      const threat = allEntities.find((e) => e.id === p.avoidingEntityId);
      if (threat) {
        const dx = threat.position.x - p.position.x;
        const dz = threat.position.z - p.position.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d <= 4) {
          return {
            shouldBreak: true,
            reason: "interrupt:danger",
            participantId: p.id,
            detail: `${p.displayName} avoiding ${threat.displayName} at ${d.toFixed(1)}u`,
          };
        }
      }
    }
    const plan = p.dailyPlan;
    if (plan) {
      const purpose = plan.needs.find((n) => n.kind === "purpose");
      const topUnfinished = plan.objectives.find((o) => !o.completed);
      // Conservative: an obligation only interrupts if the daily-plan purpose
      // is starved (sat <= 0.15) AND there's a concrete unfinished objective.
      if (purpose && purpose.satisfaction <= 0.15 && topUnfinished) {
        return {
          shouldBreak: true,
          reason: "interrupt:obligation",
          participantId: p.id,
          detail: `${p.displayName} obligation: ${topUnfinished.summary}`,
        };
      }
    }
  }
  return NO_INTERRUPT;
}

/**
 * Build a one-paragraph arc memory the moment a session ends. This is what
 * gets stored as long-term memory; per-batch writes feed short-term only.
 */
export function buildSessionArcSummary(args: {
  session: ConversationSession;
  participants: TownEntity[];
}): string {
  const { session, participants } = args;
  const namesById = new Map(participants.map((p) => [p.id, p.displayName] as const));
  const aId = session.participants[0];
  const bId = session.participants[1];
  const aName = (aId && namesById.get(aId)) ?? aId ?? "someone";
  const bName = (bId && namesById.get(bId)) ?? bId ?? "someone";

  const lead = session.topic
    ? `${aName} and ${bName} talked about ${session.topic}`
    : `${aName} and ${bName} had a ${session.category} conversation`;
  const turnPart = ` over ${session.turnIndex} turns`;
  const goalPart = session.conversationGoal
    ? `; goal: ${session.conversationGoal}`
    : "";
  const arcPart = session.summarySoFar ? `. ${session.summarySoFar}` : "";
  const tensionPart =
    session.emotionalTone === "tense" || session.emotionalTone === "guarded"
      ? ` Tone stayed ${session.emotionalTone}.`
      : "";
  const commitmentPart = session.commitments.length
    ? ` Commitments: ${session.commitments
        .map((c) => `${namesById.get(c.actorId) ?? c.actorId}: ${c.text}`)
        .join("; ")}.`
    : "";
  const unresolvedPart = session.unresolvedQuestion
    ? ` Left unresolved: ${session.unresolvedQuestion}`
    : "";
  const endPart =
    session.endReason && session.endReason.startsWith("interrupt:")
      ? ` (cut short by ${session.endReason.replace("interrupt:", "")})`
      : "";

  return `${lead}${turnPart}${goalPart}${arcPart}${tensionPart}${commitmentPart}${unresolvedPart}${endPart}`
    .trim()
    .slice(0, 600);
}

/**
 * Append a line to recentLines and roll the cap.
 */
export function recordLine(
  session: ConversationSession,
  turn: ConversationTurn,
  cap = 8
): void {
  session.recentLines.push(turn);
  if (session.recentLines.length > cap) {
    session.recentLines.splice(0, session.recentLines.length - cap);
  }
  session.turnIndex = (session.turnIndex ?? 0) + 1;
  session.currentSpeakerId = turn.speakerId;
  session.lastTurnAt = turn.timestamp;
}
