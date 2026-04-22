import type { TownEntity } from "./types";
import type { LocationRegistry } from "./LocationRegistry";
import { MemorySystem } from "./MemorySystem";
import { TALK_RADIUS, CONVERSATION_COOLDOWN_MS } from "./constants";
import { canStartConversation } from "./PerceptionSystem";
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

function pairKeyStr(aId: string, bId: string): string {
  return [aId, bId].sort().join(":");
}

type DialogueEmit = {
  speakerId: string;
  speakerName: string;
  text: string;
};

export class ConversationSystem {
  /** In-flight LLM requests (pair key → avoid duplicate timers). */
  private inFlightLlm = new Set<string>();

  constructor(
    private memory: MemorySystem,
    private locations: LocationRegistry,
    private getEntities: () => TownEntity[],
    private onStateChange?: () => void,
    private onDialogueLine?: (e: DialogueEmit) => void,
    private onConversationEnd?: (a: TownEntity, b: TownEntity) => void
  ) {}

  private emitExchangeLines(
    exchange: Array<{ speakerId: string; text: string }>,
    npcA: TownEntity,
    npcB: TownEntity
  ): void {
    for (const row of exchange) {
      const name =
        row.speakerId === npcA.id ? npcA.displayName : npcB.displayName;
      this.onDialogueLine?.({
        speakerId: row.speakerId,
        speakerName: name,
        text: row.text,
      });
    }
  }

  tryBeginPair(a: TownEntity, b: TownEntity, now: number): boolean {
    if (!canStartConversation(a, b, TALK_RADIUS, now)) return false;

    const { maxTurns, tickMs } = computeTalkBudget(a, b);
    const endsAt = now + tickMs;

    const base = {
      startedAt: now,
      lastSpeakerId: a.id,
      lastLine: "",
      phase: "exchange" as const,
      endsAt,
      turnNumber: 0,
      maxTurns,
      lastTopic: null,
    };

    a.conversation = { ...base, partnerId: b.id };
    b.conversation = { ...base, partnerId: a.id };
    a.currentAction = "talking";
    b.currentAction = "talking";
    return true;
  }

  tickActiveConversations(entities: TownEntity[], now: number): void {
    const seen = new Set<string>();
    for (const e of entities) {
      if (!e.conversation) continue;
      const partnerId = e.conversation.partnerId;
      const pair = [e.id, partnerId].sort().join(":");
      if (seen.has(pair)) continue;
      seen.add(pair);

      const partner = entities.find((x) => x.id === partnerId);
      if (!partner?.conversation) {
        this.clearConversation(e, now);
        continue;
      }

      if (now >= e.conversation.endsAt) {
        this.processConversationTick(e, partner, now);
      }
    }
  }

  tryRandomEncounters(entities: TownEntity[], now: number): void {
    const list = [...entities];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (this.tryBeginPair(a, b, now)) return;
      }
    }
  }

  private processConversationTick(
    a: TownEntity,
    b: TownEntity,
    now: number
  ): void {
    if (!a.conversation || !b.conversation) return;

    const player =
      a.controllerType === "human" ? a : b.controllerType === "human" ? b : null;
    const npc =
      a.controllerType === "ai" ? a : b.controllerType === "ai" ? b : null;

    if (player && npc) {
      const pk = pairKeyStr(a.id, b.id);
      if (isOllamaDialogueEnabled()) {
        if (this.inFlightLlm.has(pk)) return;
        this.inFlightLlm.add(pk);
        if (a.conversation) a.conversation.endsAt = Number.MAX_SAFE_INTEGER;
        if (b.conversation) b.conversation.endsAt = Number.MAX_SAFE_INTEGER;
        const packet = buildPlayerNpcScenePacket(
          player,
          npc,
          this.locations,
          this.memory
        );
        const fallback = generateStubPlayerNpcReply(packet);
        void fetchPlayerNpcReply(packet, fallback).then((result) => {
          this.inFlightLlm.delete(pk);
          const entities = this.getEntities();
          const ea = entities.find((e) => e.id === a.id);
          const eb = entities.find((e) => e.id === b.id);
          if (!ea?.conversation || !eb?.conversation) return;
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
          ea.conversation.lastLine = `${npc.displayName}: ${result.npcLine}`;
          eb.conversation.lastLine = `${npc.displayName}: ${result.npcLine}`;
          this.endConversationPair(ea, eb, Date.now());
          this.onStateChange?.();
        });
        return;
      }

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
      if (a.conversation) a.conversation.lastLine = `${npc.displayName}: ${result.npcLine}`;
      if (b.conversation) b.conversation.lastLine = `${npc.displayName}: ${result.npcLine}`;
      this.endConversationPair(a, b, now);
      return;
    }

    if (a.controllerType !== "ai" || b.controllerType !== "ai") {
      this.endConversationPair(a, b, now);
      return;
    }
    const npcA = a;
    const npcB = b;

    const nextTurn = (a.conversation.turnNumber ?? 0) + 1;
    const maxTurns = a.conversation.maxTurns;
    const lastTopic = a.conversation.lastTopic;

    const packet = buildNpcConversationScenePacket(
      npcA,
      npcB,
      this.locations,
      this.memory,
      nextTurn,
      maxTurns,
      lastTopic
    );
    const fallback = generateStubStructuredNpcExchange(packet);

    if (isOllamaDialogueEnabled()) {
      const pk = pairKeyStr(a.id, b.id);
      if (this.inFlightLlm.has(pk)) return;
      this.inFlightLlm.add(pk);
      if (a.conversation) a.conversation.endsAt = Number.MAX_SAFE_INTEGER;
      if (b.conversation) b.conversation.endsAt = Number.MAX_SAFE_INTEGER;
      void fetchNpcNpcExchange(packet, fallback).then((result) => {
        this.inFlightLlm.delete(pk);
        const now2 = Date.now();
        const entities = this.getEntities();
        const ea = entities.find((e) => e.id === a.id);
        const eb = entities.find((e) => e.id === b.id);
        if (!ea?.conversation || !eb?.conversation) return;
        this.applyNpcNpcResult(
          ea,
          eb,
          npcA,
          npcB,
          result,
          now2,
          nextTurn,
          maxTurns,
          lastTopic
        );
        this.onStateChange?.();
      });
      return;
    }

    this.applyNpcNpcResult(
      a,
      b,
      npcA,
      npcB,
      fallback,
      now,
      nextTurn,
      maxTurns,
      lastTopic
    );
  }

  private applyNpcNpcResult(
    ea: TownEntity,
    eb: TownEntity,
    npcA: TownEntity,
    npcB: TownEntity,
    result: StructuredNpcExchangeResult,
    now: number,
    nextTurn: number,
    maxTurns: number,
    lastTopic: string | null
  ): void {
    const lineSummary = result.exchange
      .map((x) =>
        `${x.speakerId === npcA.id ? npcA.displayName : npcB.displayName}: ${x.text}`
      )
      .join(" · ");
    if (ea.conversation) ea.conversation.lastLine = lineSummary;
    if (eb.conversation) eb.conversation.lastLine = lineSummary;

    this.emitExchangeLines(result.exchange, npcA, npcB);

    applyStructuredNpcExchange(
      result,
      npcA,
      npcB,
      this.memory,
      ea.currentLocationId
    );

    const continueConv =
      result.sceneOutcome.continue && nextTurn < maxTurns;

    if (continueConv) {
      const { tickMs } = computeTalkBudget(npcA, npcB);
      const endsAt = now + tickMs;
      const topic = result.topic ?? lastTopic;
      if (ea.conversation) {
        ea.conversation.turnNumber = nextTurn;
        ea.conversation.lastTopic = topic;
        ea.conversation.endsAt = endsAt;
      }
      if (eb.conversation) {
        eb.conversation.turnNumber = nextTurn;
        eb.conversation.lastTopic = topic;
        eb.conversation.endsAt = endsAt;
      }
      return;
    }

    this.applyFollowUpsFromStructured(result, npcA, npcB, now);
    this.endConversationPair(ea, eb, now);
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

  private endConversationPair(a: TownEntity, b: TownEntity, now: number): void {
    this.onConversationEnd?.(a, b);
    a.conversation = null;
    b.conversation = null;
    a.conversationCooldownUntil = now + CONVERSATION_COOLDOWN_MS;
    b.conversationCooldownUntil = now + CONVERSATION_COOLDOWN_MS;
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

  private clearConversation(e: TownEntity, now: number): void {
    e.conversation = null;
    if (e.currentAction === "talking") e.currentAction = "idle";
    e.conversationCooldownUntil = now + CONVERSATION_COOLDOWN_MS;
    scheduleNextDecision(e, now);
  }
}
