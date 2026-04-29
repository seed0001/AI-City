import type { Conversation, ConversationTurn, TownEntity } from "./types";
import type { LocationRegistry } from "./LocationRegistry";
import { MemorySystem } from "./MemorySystem";
import {
  TALK_RADIUS,
  TURN_DELAY_MS,
  CONVERSATION_COOLDOWN_MS,
  CONVERSATION_IDLE_TIMEOUT_MS,
  CONVERSATION_SEPARATION_MULTIPLIER,
  MAX_ACTIVE_CONVERSATIONS,
} from "./constants";
import { canStartConversation, distance2D } from "./PerceptionSystem";
import { ensureRelationship } from "./SocialSystem";
import { startWalkTo } from "./MovementSystem";
import { scheduleNextDecision } from "./DecisionSystem";
import { inferFollowUp } from "./stubDialogue";
import type { FollowUpAction } from "./types";
import {
  applyStructuredNpcExchange,
  buildNpcConversationScenePacket,
  computeConversationBudget,
  generateStubStructuredNpcExchange,
  hintToFollowUp,
  type SessionPacketState,
} from "./conversationStructured";
import type { StructuredNpcExchangeResult } from "./conversationStructured";
import {
  applyPlayerNpcReply,
  buildPlayerNpcScenePacket,
  generateStubPlayerNpcReply,
} from "./conversationPlayer";
import { isOllamaDialogueEnabled } from "./llm/ollamaConfig";
import { fetchNpcNpcExchange, fetchPlayerNpcReply } from "./llm/ollamaDialogue";
import {
  residentBrainAdapter,
  type ResidentEngineConversationContext,
} from "./brains/ResidentBrainAdapter";
import {
  budgetForCategory,
  buildSessionArcSummary,
  decideContinuation,
  detectInterrupts,
  inferCategory,
  inferEmotionalTone,
  recordLine,
  type ConversationCategory,
  type ConversationSession,
  type ConversationEndReason,
} from "./conversationSession";

/**
 * Allowed ladder for category re-classification. A session can ONLY drift
 * upward in category strength (toward longer arcs); it can never shrink.
 * That keeps Test-A working even if the opener was misclassified as casual.
 */
const CATEGORY_RANK: Record<ConversationCategory, number> = {
  casual: 0,
  work: 1,
  planning: 2,
  emotional: 3,
  argument: 4,
  deep: 5,
};

type DialogueEmit = {
  speakerId: string;
  speakerName: string;
  text: string;
};

/**
 * Runtime additions to a ConversationSession that don't escape the system —
 * pump bookkeeping (in-flight LLM calls, pending lines waiting on TTS, etc.).
 * The session itself is the canonical source of arc-level state.
 */
type RuntimeSession = ConversationSession & {
  lastEmittedAt: number;
  pendingLines: { speakerId: string; text: string }[];
  /** Full structured result; effects (memory, events) land when its 2nd line emits. */
  activeBatch: StructuredNpcExchangeResult | null;
  /** Number of completed 2-line batches; used for stub-fallback pacing only. */
  microExchangeIndex: number;
  inFlight: boolean;
  isPlayerHumanPair: boolean;
  /**
   * After a batch is fully delivered: whether to schedule another batch
   * (set by continuation policy, not by the LLM directly).
   */
  canScheduleMore: boolean;
  /** Hold the pump while a line is still being spoken aloud. */
  waitingForSpeech: boolean;
  speechWaitUntil: number;
  /**
   * On player↔NPC pairs the existing one-reply flow is preserved. This flag
   * marks the session as wrapped up by the player flow so the NPC↔NPC pump
   * doesn't try to take over.
   */
  closedByPlayerFlow: boolean;
};

function newConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function pickConversationLocationId(a: TownEntity, b: TownEntity): string {
  if (
    a.currentLocationId &&
    b.currentLocationId &&
    a.currentLocationId === b.currentLocationId
  ) {
    return a.currentLocationId;
  }
  return a.currentLocationId ?? b.currentLocationId ?? "overworld";
}

export class ConversationSystem {
  private inFlightLlm = new Set<string>();
  private readonly activeById = new Map<string, RuntimeSession>();

  constructor(
    private memory: MemorySystem,
    private locations: LocationRegistry,
    private getEntities: () => TownEntity[],
    private onStateChange?: () => void,
    /**
     * If the host returns a Promise, the conversation pump will wait for it
     * to settle before advancing the next turn — this is how TTS turn timing
     * is enforced. Hosts that don't speak can return `void` and behavior is
     * unchanged.
     */
    private onDialogueLine?: (e: DialogueEmit) => Promise<void> | void,
    private onConversationEnd?: (a: TownEntity, b: TownEntity) => void
  ) {}

  getActiveConversationsArray(): Readonly<Conversation>[] {
    return Array.from(this.activeById.values());
  }

  getActiveSessions(): Readonly<ConversationSession>[] {
    return Array.from(this.activeById.values());
  }

  getActiveCount(): number {
    return this.activeById.size;
  }

  /**
   * Hard interrupt for dev/player commands. Ends every live session with
   * `interrupt:dev_command`. Use sparingly — it bypasses minTurns.
   */
  endAllConversations(reason: ConversationEndReason = "interrupt:dev_command"): void {
    const now = Date.now();
    const list = this.getEntities();
    for (const id of Array.from(this.activeById.keys())) {
      const c = this.activeById.get(id);
      if (!c) continue;
      const [idA, idB] = c.participants;
      const a = list.find((e) => e.id === idA);
      const b = list.find((e) => e.id === idB);
      if (!a || !b) {
        c.active = false;
        c.status = "ended";
        c.endReason = reason;
        this.activeById.delete(c.id);
        continue;
      }
      c.endReason = reason;
      c.lastContinuationReason = `dev/admin command: ${reason}`;
      this.endSession(c, a, b, now);
    }
  }

  getDebugSnapshot(
    entities: TownEntity[],
    now: number
  ): {
    activeConversations: Array<{
      id: string;
      participants: string[];
      displayNames: string;
      locationId: string;
      lastTurnText: string;
      msSinceLastTurn: number;
      turns: number;
      category: ConversationSession["category"];
      status: ConversationSession["status"];
      emotionalTone: ConversationSession["emotionalTone"];
      topic: string | null;
      conversationGoal: string | null;
      unresolvedQuestion: string | null;
      turnIndex: number;
      minTurns: number;
      maxTurns: number;
      lastContinuationReason: string;
      endReason: ConversationSession["endReason"];
      summarySoFar: string;
      commitmentCount: number;
      conversationLocked: boolean;
    }>;
    entityConversation: Array<{
      id: string;
      name: string;
      inConversation: boolean;
      conversationLocked: boolean;
      conversationId?: string;
    }>;
  } {
    const byId = new Map(entities.map((e) => [e.id, e] as const));
    return {
      activeConversations: Array.from(this.activeById.values()).map((c) => {
        const names = c.participants
          .map((id) => byId.get(id)?.displayName ?? id)
          .join(" ↔ ");
        const last = c.turns[c.turns.length - 1];
        return {
          id: c.id,
          participants: [...c.participants],
          displayNames: names,
          locationId: c.locationId,
          lastTurnText: last ? `${last.text}` : "—",
          msSinceLastTurn: last ? now - c.lastTurnAt : 0,
          turns: c.turns.length,
          category: c.category,
          status: c.status,
          emotionalTone: c.emotionalTone,
          topic: c.topic,
          conversationGoal: c.conversationGoal,
          unresolvedQuestion: c.unresolvedQuestion,
          turnIndex: c.turnIndex,
          minTurns: c.minTurns,
          maxTurns: c.maxTurns,
          lastContinuationReason: c.lastContinuationReason,
          endReason: c.endReason,
          summarySoFar: c.summarySoFar,
          commitmentCount: c.commitments.length,
          conversationLocked: c.status === "active" || c.status === "winding_down",
        };
      }),
      entityConversation: entities.map((e) => ({
        id: e.id,
        name: e.displayName,
        inConversation: e.inConversation,
        conversationLocked: e.inConversation,
        conversationId: e.conversationId,
      })),
    };
  }

  private scorePair(a: TownEntity, b: TownEntity): number {
    const d = Math.max(0.001, distance2D(a.position, b.position));
    const r = ensureRelationship(a, b.id);
    const proximity = Math.max(0, 1 - d / (TALK_RADIUS + 0.1));
    const bond =
      (r.friendliness + r.familiarity + r.trust) / 3 - r.tension * 0.35;
    const connA = a.dailyPlan?.needs.find((n) => n.kind === "connection");
    const connB = b.dailyPlan?.needs.find((n) => n.kind === "connection");
    const socialUrgency =
      ((connA ? 1 - connA.satisfaction : 0) +
        (connB ? 1 - connB.satisfaction : 0)) *
      0.5;
    return proximity * 0.55 + bond * 0.28 + socialUrgency * 0.22;
  }

  private attachEntity(e: TownEntity, convId: string): void {
    e.inConversation = true;
    e.conversationId = convId;
  }

  private detachEntity(e: TownEntity): void {
    e.inConversation = false;
    delete e.conversationId;
    delete e.conversationLastLine;
    if (e.currentAction === "talking") e.currentAction = "idle";
  }

  private detachWithCooldown(e: TownEntity, now: number): void {
    e.conversationCooldownUntil = now + CONVERSATION_COOLDOWN_MS;
    this.detachEntity(e);
    if (e.controllerType === "ai") scheduleNextDecision(e, now);
  }

  private createSession(
    a: TownEntity,
    b: TownEntity,
    now: number
  ): RuntimeSession {
    const ra = ensureRelationship(a, b.id);
    const rb = ensureRelationship(b, a.id);
    // Topic / opener hint from the brain that drove the encounter, when present.
    const aIntent = a.lastBrainIntent ?? null;
    const bIntent = b.lastBrainIntent ?? null;
    const openerHint =
      [aIntent, bIntent, a.currentGoal, b.currentGoal]
        .filter((s): s is string => Boolean(s && s.length))
        .join(" ") || null;
    const { category, minTurns, maxTurns } = computeConversationBudget(a, b, {
      topic: null,
      openerText: openerHint,
    });
    const id = newConversationId();
    const session: RuntimeSession = {
      id,
      participants: [a.id, b.id].sort(),
      locationId: pickConversationLocationId(a, b),
      startedAt: now,
      lastTurnAt: now,
      turns: [],
      active: true,

      // session-arc state
      category,
      minTurns,
      maxTurns,
      turnIndex: 0,
      currentSpeakerId: null,
      topic: null,
      topicStack: [],
      conversationGoal: null,
      unresolvedQuestion: null,
      lastSpeakerIntent: null,
      lastListenerReaction: null,
      emotionalTone: inferEmotionalTone({
        category,
        tension: Math.max(ra.tension, rb.tension),
        moodA: a.mood,
        moodB: b.mood,
      }),
      relationshipContext: {
        trust: (ra.trust + rb.trust) / 2,
        tension: Math.max(ra.tension, rb.tension),
        familiarity: Math.max(ra.familiarity, rb.familiarity),
      },
      recentLines: [],
      summarySoFar: "",
      status: "active",
      endReason: null,
      lastContinuationReason: "session opened",
      lastInterruptCheckAt: now,
      commitments: [],

      // runtime
      lastEmittedAt: now - TURN_DELAY_MS,
      pendingLines: [],
      activeBatch: null,
      microExchangeIndex: 0,
      inFlight: false,
      isPlayerHumanPair:
        a.controllerType === "human" || b.controllerType === "human",
      canScheduleMore: true,
      waitingForSpeech: false,
      speechWaitUntil: 0,
      closedByPlayerFlow: false,
    };
    this.activeById.set(id, session);
    return session;
  }

  tryBeginPair(a: TownEntity, b: TownEntity, now: number): boolean {
    if (this.getActiveCount() >= MAX_ACTIVE_CONVERSATIONS) return false;
    if (!canStartConversation(a, b, TALK_RADIUS, now)) return false;

    const c = this.createSession(a, b, now);
    this.attachEntity(a, c.id);
    this.attachEntity(b, c.id);
    a.currentAction = "talking";
    b.currentAction = "talking";
    if (c.isPlayerHumanPair) {
      this.beginPlayerHumanExchange(a, b, c, now);
    } else {
      this.runNpcPairBatch(c, a, b);
    }
    return true;
  }

  tickActiveConversations(entities: TownEntity[], now: number): void {
    // Reattach orphans / drop sessions whose participants are gone.
    for (const e of entities) {
      if (e.inConversation) {
        const c = e.conversationId
          ? this.activeById.get(e.conversationId)
          : undefined;
        if (!c || !c.active) {
          this.detachWithCooldown(e, now);
          continue;
        }
        const p = c.participants.find((id) => id !== e.id);
        if (!p || !entities.find((x) => x.id === p)?.inConversation) {
          const other = p ? entities.find((x) => x.id === p) : null;
          if (c.active) {
            c.endReason = "participant_lost";
            c.lastContinuationReason = "lost partner mid-session";
            c.status = "ended";
            c.active = false;
            this.activeById.delete(c.id);
          }
          this.detachWithCooldown(e, now);
          if (other) this.detachWithCooldown(other, now);
        }
      }
    }

    const convIds = new Set(this.activeById.keys());
    for (const id of convIds) {
      const c = this.activeById.get(id);
      if (!c?.active) continue;
      const [idA, idB] = c.participants;
      const a = entities.find((e) => e.id === idA);
      const b = entities.find((e) => e.id === idB);
      if (!a || !b) {
        c.endReason = "participant_lost";
        c.lastContinuationReason = "participant left the world";
        c.status = "ended";
        c.active = false;
        this.activeById.delete(c.id);
        continue;
      }
      this.tickOneConversation(c, a, b, entities, now);
    }
  }

  tryRandomEncounters(entities: TownEntity[], now: number): void {
    const list = [...entities];
    const candidates: Array<{
      a: TownEntity;
      b: TownEntity;
      score: number;
    }> = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (canStartConversation(a, b, TALK_RADIUS, now)) {
          candidates.push({ a, b, score: this.scorePair(a, b) });
        }
      }
    }
    candidates.sort((x, y) => y.score - x.score);
    for (const c of candidates) {
      if (this.tryBeginPair(c.a, c.b, now)) return;
    }
  }

  private tickOneConversation(
    c: RuntimeSession,
    a: TownEntity,
    b: TownEntity,
    allEntities: TownEntity[],
    now: number
  ): void {
    if (c.isPlayerHumanPair) return;
    if (c.inFlight) return;

    // Hold every advancement (next line, end-of-conversation handoff, new
    // batch request) while a line is still being spoken aloud.
    if (c.waitingForSpeech) {
      if (c.speechWaitUntil > 0 && now > c.speechWaitUntil) {
        c.waitingForSpeech = false;
        c.speechWaitUntil = 0;
        c.lastEmittedAt = now;
      } else {
        return;
      }
    }

    if (c.pendingLines.length) {
      if (now - c.lastEmittedAt < TURN_DELAY_MS) return;
      this.emitNextPendingLine(c, a, b, now);
      return;
    }

    // ---- End-of-batch reasoning ----
    // Hard end conditions first (these short-circuit the continuation policy).
    const sep = TALK_RADIUS * CONVERSATION_SEPARATION_MULTIPLIER;
    if (distance2D(a.position, b.position) > sep) {
      c.endReason = "separated";
      c.lastContinuationReason = `participants drifted apart (${distance2D(a.position, b.position).toFixed(1)}u > ${sep.toFixed(1)}u)`;
      this.endSession(c, a, b, now);
      return;
    }
    if (now - c.lastEmittedAt > CONVERSATION_IDLE_TIMEOUT_MS) {
      c.endReason = "idle_timeout";
      c.lastContinuationReason = "no batch landed inside idle window";
      this.endSession(c, a, b, now);
      return;
    }

    // Conservative interrupt check (recomputed every tick).
    const interrupt = detectInterrupts([a, b], allEntities);
    if (interrupt.shouldBreak) {
      c.endReason = interrupt.reason;
      c.lastContinuationReason = `interrupt: ${interrupt.detail}`;
      c.status = "winding_down";
      this.endSession(c, a, b, now);
      return;
    }
    c.lastInterruptCheckAt = now;

    // Continuation policy: combine LLM intent (canScheduleMore) with our
    // engine-wins-on-stop floor.
    const verdict = decideContinuation(c, c.canScheduleMore);
    c.lastContinuationReason = verdict.reason;
    if (!verdict.shouldContinue) {
      c.endReason = verdict.endReason ?? "natural_resolution";
      c.status = "winding_down";
      this.endSession(c, a, b, now);
      return;
    }

    if (now - c.lastEmittedAt < TURN_DELAY_MS) return;

    // Mark winding-down within the last 2 turns of the budget so the LLM /
    // stub can actually wrap rather than open a new thread.
    if (c.turnIndex >= c.maxTurns - 2) c.status = "winding_down";

    this.runNpcPairBatch(c, a, b);
  }

  private beginSpeechWait(c: RuntimeSession, text: string): void {
    c.waitingForSpeech = true;
    const safeMs = Math.min(60_000, Math.max(8_000, text.length * 120 + 4_000));
    c.speechWaitUntil = Date.now() + safeMs;
  }

  private endSpeechWait(c: RuntimeSession): void {
    c.waitingForSpeech = false;
    c.speechWaitUntil = 0;
    c.lastEmittedAt = Date.now();
    this.onStateChange?.();
  }

  private collectRecentSpoken(speakerId: string, limit = 6): string[] {
    const out: string[] = [];
    for (const conv of this.activeById.values()) {
      for (let i = conv.turns.length - 1; i >= 0 && out.length < limit; i--) {
        const t = conv.turns[i];
        if (t && t.speakerId === speakerId) out.push(t.text);
      }
    }
    return out;
  }

  /**
   * Build the SessionPacketState forwarded into the LLM scene packet. Always
   * returns a fresh object; the live session is never mutated here.
   */
  private snapshotSessionState(c: RuntimeSession): SessionPacketState {
    return {
      turnIndex: c.turnIndex,
      minTurns: c.minTurns,
      maxTurns: c.maxTurns,
      lastTopic: c.topic,
      topicStack: [...c.topicStack],
      category: c.category,
      status: c.status,
      emotionalTone: c.emotionalTone,
      conversationGoal: c.conversationGoal,
      unresolvedQuestion: c.unresolvedQuestion,
      summarySoFar: c.summarySoFar,
      lastSpeakerIntent: c.lastSpeakerIntent,
      lastListenerReaction: c.lastListenerReaction,
    };
  }

  private runNpcPairBatch(
    c: RuntimeSession,
    a: TownEntity,
    b: TownEntity
  ): void {
    if (a.controllerType !== "ai" || b.controllerType !== "ai") {
      c.inFlight = false;
      return;
    }
    const pk = c.id;
    c.inFlight = true;

    const buildAndDispatch = (
      ctxA: ResidentEngineConversationContext | null,
      ctxB: ResidentEngineConversationContext | null
    ): void => {
      const engineDriven = Boolean(ctxA && ctxB);
      const packet = buildNpcConversationScenePacket(
        a,
        b,
        this.locations,
        this.memory,
        this.snapshotSessionState(c),
        c.turns,
        {
          a: ctxA?.engineBrainContext,
          b: ctxB?.engineBrainContext,
          engineDriven,
          agentARecentSpoken: this.collectRecentSpoken(a.id, 6),
          agentBRecentSpoken: this.collectRecentSpoken(b.id, 6),
        }
      );
      const fallback = generateStubStructuredNpcExchange(packet);
      const sourceTag: "engine" | "fallback" = engineDriven ? "engine" : "fallback";

      if (isOllamaDialogueEnabled()) {
        if (this.inFlightLlm.has(pk)) {
          c.inFlight = true;
          return;
        }
        this.inFlightLlm.add(pk);
        void fetchNpcNpcExchange(packet, fallback).then((result) => {
          this.inFlightLlm.delete(pk);
          a.conversationSource = sourceTag;
          b.conversationSource = sourceTag;
          this.applyArrivedBatch(c, a, b, result);
          this.onStateChange?.();
        });
        return;
      }
      a.conversationSource = sourceTag;
      b.conversationSource = sourceTag;
      this.applyArrivedBatch(c, a, b, fallback);
      this.onStateChange?.();
    };

    if (residentBrainAdapter.isConnected()) {
      void Promise.all([
        residentBrainAdapter.awaitConversationContext(a, b.id),
        residentBrainAdapter.awaitConversationContext(b, a.id),
      ]).then(([ctxA, ctxB]) => {
        buildAndDispatch(ctxA, ctxB);
      });
      return;
    }
    buildAndDispatch(null, null);
  }

  private applyArrivedBatch(
    c: RuntimeSession,
    a: TownEntity,
    b: TownEntity,
    result: StructuredNpcExchangeResult
  ): void {
    c.inFlight = false;
    if (result.exchange.length < 2) {
      c.activeBatch = null;
      c.pendingLines = [];
      c.canScheduleMore = false;
      c.endReason = "stub_failure";
      c.lastContinuationReason = "batch returned fewer than 2 lines";
      this.endSession(c, a, b, Date.now());
      return;
    }
    c.activeBatch = result;
    c.pendingLines = result.exchange.map((r) => ({
      speakerId: r.speakerId,
      text: r.text,
    }));

    // Fold session-arc updates from the result. Unknown / null fields keep
    // the old session value — never blank-out.
    const incomingTopic = result.nextTopic ?? result.topic ?? null;
    if (incomingTopic && incomingTopic !== c.topic) {
      if (c.topic) c.topicStack.push(c.topic);
      if (c.topicStack.length > 6) c.topicStack.splice(0, c.topicStack.length - 6);
      c.topic = incomingTopic;
    } else if (!c.topic && incomingTopic) {
      c.topic = incomingTopic;
    }

    if (typeof result.conversationGoal === "string" && result.conversationGoal.trim()) {
      c.conversationGoal = result.conversationGoal.trim().slice(0, 240);
    }
    if (result.unresolvedQuestion === null) {
      c.unresolvedQuestion = null;
    } else if (
      typeof result.unresolvedQuestion === "string" &&
      result.unresolvedQuestion.trim()
    ) {
      c.unresolvedQuestion = result.unresolvedQuestion.trim().slice(0, 240);
    }
    if (typeof result.lastSpeakerIntent === "string" && result.lastSpeakerIntent.trim()) {
      c.lastSpeakerIntent = result.lastSpeakerIntent.trim().slice(0, 200);
    }
    if (typeof result.lastListenerReaction === "string" && result.lastListenerReaction.trim()) {
      c.lastListenerReaction = result.lastListenerReaction.trim().slice(0, 200);
    }
    if (typeof result.summaryDelta === "string" && result.summaryDelta.trim()) {
      const next = c.summarySoFar
        ? `${c.summarySoFar} ${result.summaryDelta.trim()}`
        : result.summaryDelta.trim();
      c.summarySoFar = next.slice(-700);
    }
    if (Array.isArray(result.commitments)) {
      for (const com of result.commitments) {
        if (
          com &&
          typeof com.actorId === "string" &&
          (com.actorId === a.id || com.actorId === b.id) &&
          typeof com.text === "string" &&
          com.text.trim()
        ) {
          c.commitments.push({
            actorId: com.actorId,
            text: com.text.trim().slice(0, 240),
          });
        }
      }
      if (c.commitments.length > 12) {
        c.commitments.splice(0, c.commitments.length - 12);
      }
    }

    // Re-classify category with new topic signal. We ONLY accept upgrades
    // (longer arc strength), never downgrades — protects against opener
    // misclassification (Test A: a casually-labeled opener that turns out
    // to be planning gets the right budget once topic is named).
    if (c.topic) {
      const reclass = inferCategory({
        a,
        b,
        topic: c.topic,
        openerText: `${c.lastSpeakerIntent ?? ""} ${c.conversationGoal ?? ""}`,
      });
      if (CATEGORY_RANK[reclass] > CATEGORY_RANK[c.category]) {
        const upgraded = budgetForCategory(reclass);
        c.category = reclass;
        c.minTurns = Math.max(c.minTurns, upgraded.minTurns);
        c.maxTurns = Math.max(c.maxTurns, upgraded.maxTurns);
      }
    }

    // Refresh tone now that we have new emotional context.
    const ra = ensureRelationship(a, b.id);
    const rb = ensureRelationship(b, a.id);
    c.emotionalTone = inferEmotionalTone({
      category: c.category,
      tension: Math.max(ra.tension, rb.tension),
      moodA: a.mood,
      moodB: b.mood,
    });
    c.relationshipContext = {
      trust: (ra.trust + rb.trust) / 2,
      tension: Math.max(ra.tension, rb.tension),
      familiarity: Math.max(ra.familiarity, rb.familiarity),
    };

    // Note: c.canScheduleMore is the LLM's RAW signal; the actual decision
    // comes from decideContinuation(...) at the next end-of-batch tick.
    c.canScheduleMore = Boolean(result.sceneOutcome.continue);
  }

  private emitNextPendingLine(
    c: RuntimeSession,
    a: TownEntity,
    b: TownEntity,
    now: number
  ): void {
    if (!c.pendingLines.length) return;
    const line = c.pendingLines.shift()!;
    const isSecondLine = c.pendingLines.length === 0;
    const name =
      line.speakerId === a.id
        ? a.displayName
        : line.speakerId === b.id
          ? b.displayName
          : "?";
    const turn: ConversationTurn = {
      speakerId: line.speakerId,
      text: line.text,
      timestamp: now,
    };
    c.turns.push(turn);
    recordLine(c, turn, 8);
    c.lastEmittedAt = now;

    const lineSummary = `${name}: ${line.text}`;
    a.conversationLastLine = lineSummary;
    b.conversationLastLine = lineSummary;

    // Outcome (memory, relationships, engine feedback) needs to land
    // immediately after the second line of a batch lands so other systems
    // see correct state. End-of-conversation visuals/cooldowns are deferred
    // until the spoken audio finishes (and only fire when continuation
    // policy says we're done).
    let endAfterSpeech: (() => void) | null = null;
    if (isSecondLine && c.activeBatch) {
      const result = c.activeBatch;
      applyStructuredNpcExchange(
        result,
        a,
        b,
        this.memory,
        a.currentLocationId
      );
      c.microExchangeIndex += 1;
      const lineA = result.exchange.find((r) => r.speakerId === a.id)?.text;
      const lineB = result.exchange.find((r) => r.speakerId === b.id)?.text;
      const moodA = result.emotionUpdates[a.id]?.mood;
      const moodB = result.emotionUpdates[b.id]?.mood;
      const socialA = result.emotionUpdates[a.id]?.social;
      const socialB = result.emotionUpdates[b.id]?.social;
      const relDelta = result.relationshipUpdates[0]?.delta ?? 0;
      const emotionalImpact = relDelta != null ? -relDelta * 0.3 : 0;

      void residentBrainAdapter.sendResidentEvent(a, {
        actorId: a.id,
        participants: [a.id, b.id],
        locationId: a.currentLocationId,
        eventType: "conversation_outcome",
        summary: result.memorySummary,
        emotionalImpact,
        timestamp: now,
        relationshipDelta: relDelta,
        resolved: !result.sceneOutcome.continue,
        spokenLine: lineA ?? "",
        topic: result.topic ?? c.topic ?? null,
        mood: moodA ?? a.mood,
        socialDelta: socialA ?? 0,
        partnerId: b.id,
        partnerName: b.displayName,
      });
      void residentBrainAdapter.sendResidentEvent(b, {
        actorId: b.id,
        participants: [a.id, b.id],
        locationId: b.currentLocationId,
        eventType: "conversation_outcome",
        summary: result.memorySummary,
        emotionalImpact,
        timestamp: now,
        relationshipDelta: relDelta,
        resolved: !result.sceneOutcome.continue,
        spokenLine: lineB ?? "",
        topic: result.topic ?? c.topic ?? null,
        mood: moodB ?? b.mood,
        socialDelta: socialB ?? 0,
        partnerId: a.id,
        partnerName: a.displayName,
      });
      c.activeBatch = null;

      // After a batch lands, the *continuation policy* decides whether a
      // next batch will be scheduled. The decision happens on the next
      // tick (so the speech wait can complete first), but we capture the
      // current verdict as the contextual reason.
      const verdict = decideContinuation(c, c.canScheduleMore);
      c.lastContinuationReason = verdict.reason;
      if (!verdict.shouldContinue) {
        c.canScheduleMore = false;
        c.endReason = verdict.endReason ?? "natural_resolution";
        c.status = "winding_down";
        endAfterSpeech = () => {
          if (!this.activeById.get(c.id)) return;
          this.applyFollowUpsFromStructured(result, a, b, Date.now());
          this.endSession(c, a, b, Date.now());
        };
      }
    }

    this.beginSpeechWait(c, line.text);
    const speechResult = this.onDialogueLine?.({
      speakerId: line.speakerId,
      speakerName: name,
      text: line.text,
    });
    const release = (): void => {
      this.endSpeechWait(c);
      if (endAfterSpeech) endAfterSpeech();
    };
    if (speechResult && typeof (speechResult as Promise<void>).then === "function") {
      void (speechResult as Promise<void>).finally(release);
    } else {
      release();
    }
  }

  private beginPlayerHumanExchange(
    a: TownEntity,
    b: TownEntity,
    c: RuntimeSession,
    now: number
  ) {
    const player =
      a.controllerType === "human" ? a : b.controllerType === "human" ? b : null;
    const npc =
      a.controllerType === "ai" ? a : b.controllerType === "ai" ? b : null;
    if (!player || !npc) {
      c.inFlight = false;
      c.endReason = "stub_failure";
      this.endSession(c, a, b, now);
      return;
    }

    const dispatch = (npcCtx: ResidentEngineConversationContext | null): void => {
      const engineDriven = Boolean(npcCtx);
      const packet = buildPlayerNpcScenePacket(
        player,
        npc,
        this.locations,
        this.memory,
        {
          npc: npcCtx?.engineBrainContext,
          engineDriven,
          npcRecentSpoken: this.collectRecentSpoken(npc.id, 6),
        }
      );
      const sourceTag: "engine" | "fallback" = engineDriven ? "engine" : "fallback";
      const pk = c.id;

      const finalize = (result: ReturnType<typeof generateStubPlayerNpcReply>): void => {
        npc.conversationSource = sourceTag;
        player.conversationSource = sourceTag;
        applyPlayerNpcReply(
          result,
          player,
          npc,
          this.memory,
          player.currentLocationId
        );
        c.isPlayerHumanPair = true;
        const stamp = Date.now();
        const turn = {
          speakerId: npc.id,
          text: result.npcLine,
          timestamp: stamp,
        };
        c.turns.push(turn);
        recordLine(c, turn, 8);
        npc.conversationLastLine = `${npc.displayName}: ${result.npcLine}`;
        player.conversationLastLine = npc.conversationLastLine;
        c.lastEmittedAt = stamp;
        c.pendingLines = [];
        c.canScheduleMore = false;
        c.endReason = "natural_resolution";
        c.status = "winding_down";
        c.lastContinuationReason = "player↔npc single-reply flow";

        // Speak the line, hold the turn open until the audio finishes,
        // THEN end the conversation so the NPC's "talking" pose persists
        // through the spoken audio.
        this.beginSpeechWait(c, result.npcLine);
        const speechResult = this.onDialogueLine?.({
          speakerId: npc.id,
          speakerName: npc.displayName,
          text: result.npcLine,
        });

        const closeOut = (): void => {
          this.endSpeechWait(c);
          if (this.activeById.get(c.id)) {
            const list = this.getEntities();
            const ea = list.find((e) => e.id === a.id) ?? a;
            const eb = list.find((e) => e.id === b.id) ?? b;
            this.endSession(c, ea, eb, Date.now());
          }
          void residentBrainAdapter.sendResidentEvent(npc, {
            actorId: npc.id,
            participants: [npc.id, player.id],
            locationId: player.currentLocationId,
            eventType: "conversation_outcome",
            summary: result.memorySummary,
            emotionalImpact: result.tensionDelta,
            timestamp: Date.now(),
            trustDelta: result.trustDelta,
            tensionDelta: result.tensionDelta,
            tone: result.tone,
            spokenLine: result.npcLine,
            partnerId: player.id,
            partnerName: player.displayName,
          });
          this.onStateChange?.();
        };

        if (speechResult && typeof (speechResult as Promise<void>).then === "function") {
          void (speechResult as Promise<void>).finally(closeOut);
        } else {
          closeOut();
        }
      };

      if (isOllamaDialogueEnabled()) {
        this.inFlightLlm.add(pk);
        const fallback = generateStubPlayerNpcReply(packet);
        void fetchPlayerNpcReply(packet, fallback).then((result) => {
          this.inFlightLlm.delete(pk);
          c.inFlight = false;
          const list = this.getEntities();
          const ea = list.find((e) => e.id === a.id);
          const eb = list.find((e) => e.id === b.id);
          if (!ea || !eb || !this.activeById.get(c.id)) return;
          finalize(result);
        });
        return;
      }
      c.inFlight = false;
      finalize(generateStubPlayerNpcReply(packet));
    };

    if (residentBrainAdapter.isConnected()) {
      void residentBrainAdapter
        .awaitConversationContext(npc, player.id)
        .then((ctx) => dispatch(ctx));
      return;
    }
    dispatch(null);
  }

  /**
   * Tear-down for a session. Always:
   *  - flips status=ended (preserving any endReason already set)
   *  - writes ONE arc memory event for both participants (long-term)
   *  - applies follow-up actions (linger / leave / goto / avoid)
   *  - sets cooldowns and reschedules the AI decision loop
   */
  private endSession(
    c: RuntimeSession,
    a: TownEntity,
    b: TownEntity,
    now: number
  ): void {
    if (!c.active) return; // already ended
    c.active = false;
    c.status = "ended";
    if (!c.endReason) c.endReason = "natural_resolution";

    // Compose and write the session-arc memory event. Per-batch writes
    // (applyStructuredNpcExchange) feed short-term; this is the
    // "remember this conversation" event for long-term.
    const arcText = buildSessionArcSummary({
      session: c,
      participants: [a, b],
    });
    if (arcText) {
      const tensionShade =
        c.emotionalTone === "tense" || c.emotionalTone === "guarded"
          ? -0.25
          : c.emotionalTone === "warm"
            ? 0.18
            : 0.05;
      this.memory.add([a, b], {
        type: "conversation_session",
        locationId: a.currentLocationId ?? b.currentLocationId ?? null,
        summary: arcText,
        emotionalImpact: tensionShade,
      });
    }

    // Commitments: write each as its own short, salient memory so the
    // commitment-holder can recall it explicitly later.
    if (c.commitments.length) {
      for (const com of c.commitments) {
        const actor = com.actorId === a.id ? a : com.actorId === b.id ? b : null;
        if (!actor) continue;
        this.memory.add([actor], {
          type: "commitment",
          locationId: actor.currentLocationId,
          summary: `Commitment: ${com.text}`,
          emotionalImpact: 0.08,
        });
      }
    }

    this.activeById.delete(c.id);
    this.onConversationEnd?.(a, b);
    for (const e of [a, b]) {
      e.conversationCooldownUntil = now + CONVERSATION_COOLDOWN_MS;
    }
    this.detachEntity(a);
    this.detachEntity(b);
    if (a.controllerType === "ai") scheduleNextDecision(a, now);
    if (b.controllerType === "ai") scheduleNextDecision(b, now);
  }

  private applyFollowUp(
    self: TownEntity,
    other: TownEntity,
    action: FollowUpAction,
    _now: number
  ): void {
    if (self.controllerType === "human") {
      self.currentAction = "idle";
      self.currentGoal = "Carry on when you're ready";
      return;
    }
    switch (action) {
      case "continue":
        self.currentAction = "idle";
        self.currentGoal = "Stay a moment";
        break;
      case "leave":
        self.currentAction = "leaving";
        self.currentGoal = "Step away";
        {
          const dest = this.locations.randomDestination(
            self.currentLocationId ?? undefined
          );
          startWalkTo(self, { ...dest.position }, dest.id);
        }
        break;
      case "goto": {
        const dest = this.locations.randomDestination(
          self.currentLocationId ?? undefined
        );
        self.currentGoal = `Go to ${dest.label}`;
        startWalkTo(self, { ...dest.position }, dest.id);
        break;
      }
      case "avoid":
        self.avoidingEntityId = other.id;
        self.currentGoal = "Avoid a tense encounter";
        {
          const dest = this.locations.randomDestination(undefined);
          startWalkTo(self, { ...dest.position }, dest.id);
        }
        break;
      default:
        self.currentAction = "idle";
    }
  }

  private applyFollowUpsFromStructured(
    result: StructuredNpcExchangeResult,
    a: TownEntity,
    b: TownEntity,
    now: number
  ): void {
    const ra = ensureRelationship(a, b.id);
    const rb = ensureRelationship(b, a.id);
    const followA = hintToFollowUp(
      result.sceneOutcome.actionHints[a.id],
      inferFollowUp(ra.tension, a.mood, "continue")
    );
    const followB = hintToFollowUp(
      result.sceneOutcome.actionHints[b.id],
      inferFollowUp(rb.tension, b.mood, "continue")
    );
    this.applyFollowUp(a, b, followA, now);
    this.applyFollowUp(b, a, followB, now);
  }
}
