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
  computeTalkBudget,
  generateStubStructuredNpcExchange,
  hintToFollowUp,
} from "./conversationStructured";
import type { StructuredNpcExchangeResult } from "./conversationStructured";
import {
  applyPlayerNpcReply,
  buildPlayerNpcScenePacket,
  generateStubPlayerNpcReply,
} from "./conversationPlayer";
import { isOllamaDialogueEnabled } from "./llm/ollamaConfig";
import { fetchNpcNpcExchange, fetchPlayerNpcReply } from "./llm/ollamaDialogue";

type DialogueEmit = {
  speakerId: string;
  speakerName: string;
  text: string;
};

type EngineConversation = Conversation & {
  lastEmittedAt: number;
  pendingLines: { speakerId: string; text: string }[];
  /** Full structured result; applied on the second of two pending lines. */
  activeBatch: StructuredNpcExchangeResult | null;
  /** Completed 2-line micro-batches. */
  microExchangeIndex: number;
  maxMicroExchanges: number;
  lastTopic: string | null;
  inFlight: boolean;
  isPlayerHumanPair: boolean;
  /** After both lines, whether another micro-batch is allowed. */
  canScheduleMore: boolean;
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
  private readonly activeById = new Map<string, EngineConversation>();

  constructor(
    private memory: MemorySystem,
    private locations: LocationRegistry,
    private getEntities: () => TownEntity[],
    private onStateChange?: () => void,
    private onDialogueLine?: (e: DialogueEmit) => void,
    private onConversationEnd?: (a: TownEntity, b: TownEntity) => void
  ) {}

  getActiveConversationsArray(): Readonly<Conversation>[] {
    return Array.from(this.activeById.values());
  }

  getActiveCount(): number {
    return this.activeById.size;
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
    }>;
    entityConversation: Array<{
      id: string;
      name: string;
      inConversation: boolean;
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
        };
      }),
      entityConversation: entities.map((e) => ({
        id: e.id,
        name: e.displayName,
        inConversation: e.inConversation,
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

  private attachEntity(
    e: TownEntity,
    convId: string
  ): void {
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

  private createEngineConversation(
    a: TownEntity,
    b: TownEntity,
    now: number
  ): EngineConversation {
    const { maxTurns } = computeTalkBudget(a, b);
    const id = newConversationId();
    const c: EngineConversation = {
      id,
      participants: [a.id, b.id].sort(),
      locationId: pickConversationLocationId(a, b),
      startedAt: now,
      lastTurnAt: now,
      turns: [],
      active: true,
      lastEmittedAt: now - TURN_DELAY_MS,
      pendingLines: [],
      activeBatch: null,
      microExchangeIndex: 0,
      maxMicroExchanges: maxTurns,
      lastTopic: null,
      inFlight: false,
      isPlayerHumanPair: a.controllerType === "human" || b.controllerType === "human",
      canScheduleMore: true,
    };
    this.activeById.set(id, c);
    return c;
  }

  tryBeginPair(a: TownEntity, b: TownEntity, now: number): boolean {
    if (this.getActiveCount() >= MAX_ACTIVE_CONVERSATIONS) return false;
    if (!canStartConversation(a, b, TALK_RADIUS, now)) return false;

    const c = this.createEngineConversation(a, b, now);
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
        c.active = false;
        this.activeById.delete(c.id);
        continue;
      }
      this.tickOneConversation(c, a, b, now);
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
    c: EngineConversation,
    a: TownEntity,
    b: TownEntity,
    now: number
  ): void {
    if (c.isPlayerHumanPair) return;
    if (c.inFlight) return;
    if (c.pendingLines.length) {
      if (now - c.lastEmittedAt < TURN_DELAY_MS) return;
      this.emitNextPendingLine(c, a, b, now);
      return;
    }
    const sep = TALK_RADIUS * CONVERSATION_SEPARATION_MULTIPLIER;
    if (distance2D(a.position, b.position) > sep) {
      this.endConversationEngine(c, a, b, now);
      return;
    }
    if (now - c.lastEmittedAt > CONVERSATION_IDLE_TIMEOUT_MS) {
      this.endConversationEngine(c, a, b, now);
      return;
    }
    if (c.microExchangeIndex >= c.maxMicroExchanges) {
      this.endConversationEngine(c, a, b, now);
      return;
    }
    if (!c.canScheduleMore) {
      this.endConversationEngine(c, a, b, now);
      return;
    }
    if (now - c.lastEmittedAt < TURN_DELAY_MS) return;
    this.runNpcPairBatch(c, a, b);
  }

  private runNpcPairBatch(
    c: EngineConversation,
    a: TownEntity,
    b: TownEntity
  ): void {
    if (a.controllerType !== "ai" || b.controllerType !== "ai") {
      c.inFlight = false;
      return;
    }
    const pk = c.id;
    c.inFlight = true;
    const nextTurn = c.microExchangeIndex + 1;
    const packet = buildNpcConversationScenePacket(
      a,
      b,
      this.locations,
      this.memory,
      nextTurn,
      c.maxMicroExchanges,
      c.lastTopic,
      c.turns
    );
    const fallback = generateStubStructuredNpcExchange(packet);

    if (isOllamaDialogueEnabled()) {
      if (this.inFlightLlm.has(pk)) {
        c.inFlight = true;
        return;
      }
      this.inFlightLlm.add(pk);
      void fetchNpcNpcExchange(packet, fallback).then((result) => {
        this.inFlightLlm.delete(pk);
        this.applyArrivedBatch(c, a, b, result);
        this.onStateChange?.();
      });
      return;
    }
    this.applyArrivedBatch(c, a, b, fallback);
    this.onStateChange?.();
  }

  private applyArrivedBatch(
    c: EngineConversation,
    a: TownEntity,
    b: TownEntity,
    result: StructuredNpcExchangeResult
  ): void {
    c.inFlight = false;
    if (result.exchange.length < 2) {
      c.activeBatch = null;
      c.pendingLines = [];
      c.canScheduleMore = false;
      this.endConversationEngine(c, a, b, Date.now());
      return;
    }
    c.activeBatch = result;
    c.pendingLines = result.exchange.map((r) => ({
      speakerId: r.speakerId,
      text: r.text,
    }));
    c.lastTopic = result.topic ?? c.lastTopic;
  }

  private emitNextPendingLine(
    c: EngineConversation,
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
    c.lastTurnAt = now;
    c.lastEmittedAt = now;

    const lineSummary = `${name}: ${line.text}`;
    a.conversationLastLine = lineSummary;
    b.conversationLastLine = lineSummary;

    this.onDialogueLine?.({
      speakerId: line.speakerId,
      speakerName: name,
      text: line.text,
    });

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
      c.activeBatch = null;
      const can =
        result.sceneOutcome.continue && c.microExchangeIndex < c.maxMicroExchanges;
      c.canScheduleMore = can;
      if (!can) {
        this.applyFollowUpsFromStructured(result, a, b, now);
        this.endConversationEngine(c, a, b, now);
      }
    }
  }

  private beginPlayerHumanExchange(
    a: TownEntity,
    b: TownEntity,
    c: EngineConversation,
    now: number
  ) {
    const player =
      a.controllerType === "human" ? a : b.controllerType === "human" ? b : null;
    const npc =
      a.controllerType === "ai" ? a : b.controllerType === "ai" ? b : null;
    if (!player || !npc) {
      c.inFlight = false;
      this.endConversationEngine(c, a, b, now);
      return;
    }
    const pk = c.id;
    if (isOllamaDialogueEnabled()) {
      this.inFlightLlm.add(pk);
      const packet = buildPlayerNpcScenePacket(
        player,
        npc,
        this.locations,
        this.memory
      );
      const fallback = generateStubPlayerNpcReply(packet);
      void fetchPlayerNpcReply(packet, fallback).then((result) => {
        this.inFlightLlm.delete(pk);
        c.inFlight = false;
        const list = this.getEntities();
        const ea = list.find((e) => e.id === a.id);
        const eb = list.find((e) => e.id === b.id);
        if (!ea || !eb || !this.activeById.get(c.id)) return;
        applyPlayerNpcReply(
          result,
          player,
          npc,
          this.memory,
          player.currentLocationId
        );
        c.isPlayerHumanPair = true;
        c.turns.push({
          speakerId: npc.id,
          text: result.npcLine,
          timestamp: Date.now(),
        });
        npc.conversationLastLine = `${npc.displayName}: ${result.npcLine}`;
        player.conversationLastLine = npc.conversationLastLine;
        c.lastTurnAt = Date.now();
        c.lastEmittedAt = c.lastTurnAt;
        c.pendingLines = [];
        c.canScheduleMore = false;
        this.onDialogueLine?.({
          speakerId: npc.id,
          speakerName: npc.displayName,
          text: result.npcLine,
        });
        this.endConversationEngine(c, ea, eb, Date.now());
        this.onStateChange?.();
      });
      return;
    }
    c.inFlight = false;
    const packet = buildPlayerNpcScenePacket(
      player,
      npc,
      this.locations,
      this.memory
    );
    const result = generateStubPlayerNpcReply(packet);
    applyPlayerNpcReply(
      result,
      player,
      npc,
      this.memory,
      player.currentLocationId
    );
    this.onDialogueLine?.({
      speakerId: npc.id,
      speakerName: npc.displayName,
      text: result.npcLine,
    });
    c.turns.push({
      speakerId: npc.id,
      text: result.npcLine,
      timestamp: now,
    });
    npc.conversationLastLine = `${npc.displayName}: ${result.npcLine}`;
    player.conversationLastLine = npc.conversationLastLine;
    c.lastTurnAt = now;
    c.pendingLines = [];
    c.canScheduleMore = false;
    this.endConversationEngine(c, a, b, now);
  }

  private endConversationEngine(
    c: EngineConversation,
    a: TownEntity,
    b: TownEntity,
    now: number
  ): void {
    c.active = false;
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
