import type { TownEntity } from "../types";
import {
  checkResidentBrainHealth,
  createChildBrain,
  getConversationContext,
  getResidentDecision,
  initializeResidentBrain,
  recordResidentEvent,
  type BrainDecision,
  type BrainConversationContextResponse,
  type EngineBrainContext,
  updateResidentBrain,
} from "./residentBrainClient";

export type ResidentEngineConversationContext = {
  contextLines: string[];
  moodLine?: string;
  intentionLine?: string;
  memoryLine?: string;
  emotionSummary?: string;
  engineBrainContext: EngineBrainContext;
  fetchedAt: number;
};

type CachedSuggestion = {
  intent: BrainDecision;
  at: number;
  confidence: number;
  targetEntityId?: string | null;
  rationale?: string;
};

const UPDATE_INTERVAL_MS = 2500;
const DECISION_INTERVAL_MS = 1800;
const CONVERSATION_INTERVAL_MS = 2200;
/**
 * Backoff for retrying initializeEntity on entities that are still local
 * because the brain service was offline at bootstrap. Long enough to avoid
 * a tight loop when the service genuinely isn't there, short enough to
 * recover within a few seconds once it comes online.
 */
const INIT_RETRY_INTERVAL_MS = 4000;

function nowMs(): number {
  return Date.now();
}

function inWorldSnapshot(e: TownEntity) {
  return {
    entityId: e.id,
    displayName: e.displayName,
    role: e.role,
    mood: e.mood,
    traits: [...e.traits],
    lifeAdaptation: e.lifeAdaptation,
    socialTolerance: e.socialTolerance,
    energy: e.energy,
    hunger: e.hunger,
    townDaysLived: e.townDaysLived,
    townRoleOptions: [...e.townRoleOptions],
    knownAsHuman: e.knownAsHuman,
  };
}

export class ResidentBrainAdapter {
  private connected = false;
  private lastHealthAt = 0;
  private lastUpdateAt = new Map<string, number>();
  private lastDecisionAt = new Map<string, number>();
  private lastConversationAt = new Map<string, number>();
  private lastInitAttemptAt = new Map<string, number>();
  private pendingDecision = new Set<string>();
  private pendingConversation = new Set<string>();
  private suggestions = new Map<string, CachedSuggestion>();
  private conversationContextCache = new Map<string, ResidentEngineConversationContext>();
  private inFlightConversation = new Map<
    string,
    Promise<ResidentEngineConversationContext | null>
  >();

  isConnected(): boolean {
    return this.connected;
  }

  async refreshHealth(): Promise<void> {
    const now = nowMs();
    if (now - this.lastHealthAt < 4000) return;
    this.lastHealthAt = now;
    this.connected = await checkResidentBrainHealth();
  }

  async initializeEntity(entity: TownEntity): Promise<void> {
    await this.refreshHealth();
    if (!this.connected) {
      entity.brainKind = "local";
      entity.brainConnected = false;
      return;
    }
    try {
      const res = await initializeResidentBrain({
        entityId: entity.id,
        snapshot: inWorldSnapshot(entity),
      });
      entity.brainKind = res.ok ? "engine" : "local";
      entity.brainConnected = Boolean(res.ok);
      if (res.emotionSummary) entity.lastBrainEmotion = res.emotionSummary;
    } catch {
      this.connected = false;
      entity.brainKind = "local";
      entity.brainConnected = false;
    }
  }

  async updateEntity(entity: TownEntity): Promise<void> {
    await this.refreshHealth();
    if (!this.connected) {
      entity.brainConnected = false;
      return;
    }

    // Init was fire-and-forget at bootstrap; if the service was still warming
    // up at that time, the entity is stuck in brainKind="local" forever.
    // Catch that here and retry init now that the service is up. Only retry
    // for AI/network entities (the human is intentionally local).
    if (entity.brainKind === "local"
        && (entity.controlledBy === "ai" || entity.controlledBy === "network")) {
      const lastTry = this.lastInitAttemptAt.get(entity.id) ?? 0;
      if (nowMs() - lastTry < INIT_RETRY_INTERVAL_MS) {
        // Backoff window: don't hammer the service if init is failing.
        return;
      }
      this.lastInitAttemptAt.set(entity.id, nowMs());
      await this.initializeEntity(entity);
      // initializeEntity mutates entity.brainKind, but TS narrowing can't see
      // that across the await boundary, so we re-read via the cast below.
    }

    if ((entity.brainKind as "local" | "engine") !== "engine") {
      entity.brainConnected = false;
      return;
    }

    const now = nowMs();
    if (now - (this.lastUpdateAt.get(entity.id) ?? 0) < UPDATE_INTERVAL_MS) return;
    this.lastUpdateAt.set(entity.id, now);
    try {
      const res = await updateResidentBrain({
        entityId: entity.id,
        tickContext: {
          mood: entity.mood,
          energy: entity.energy,
          hunger: entity.hunger,
          socialTolerance: entity.socialTolerance,
          currentGoal: entity.currentGoal,
          currentAction: entity.currentAction,
          lifeAdaptation: entity.lifeAdaptation,
          townDaysLived: entity.townDaysLived,
        },
      });
      entity.brainConnected = res.ok;
      if (res.emotionSummary) entity.lastBrainEmotion = res.emotionSummary;
    } catch {
      this.connected = false;
      entity.brainConnected = false;
    }
  }

  private requestDecision(entity: TownEntity, nearbyEntityIds: string[]): void {
    if (!this.connected || entity.brainKind !== "engine") return;
    const now = nowMs();
    if (now - (this.lastDecisionAt.get(entity.id) ?? 0) < DECISION_INTERVAL_MS) return;
    if (this.pendingDecision.has(entity.id)) return;
    this.pendingDecision.add(entity.id);
    this.lastDecisionAt.set(entity.id, now);
    void getResidentDecision({
      entityId: entity.id,
      decisionContext: {
        mood: entity.mood,
        hunger: entity.hunger,
        energy: entity.energy,
        socialTolerance: entity.socialTolerance,
        currentGoal: entity.currentGoal,
        currentAction: entity.currentAction,
        nearbyEntityIds,
        homeMarkerKey: entity.homeMarkerKey,
        dailyPlanHeadline: entity.dailyPlan?.headline ?? null,
      },
    })
      .then((res) => {
        entity.lastBrainIntent = res.intent;
        if (res.emotionSummary) entity.lastBrainEmotion = res.emotionSummary;
        this.suggestions.set(entity.id, {
          intent: res.intent,
          at: nowMs(),
          confidence: res.confidence,
          targetEntityId: res.targetEntityId,
          rationale: res.rationale,
        });
      })
      .catch(() => {
        this.connected = false;
        entity.brainConnected = false;
      })
      .finally(() => {
        this.pendingDecision.delete(entity.id);
      });
  }

  consumeDecision(entityId: string): CachedSuggestion | null {
    const hit = this.suggestions.get(entityId);
    if (!hit) return null;
    if (nowMs() - hit.at > 4500) {
      this.suggestions.delete(entityId);
      return null;
    }
    this.suggestions.delete(entityId);
    return hit;
  }

  /**
   * DecisionSystem primary entrypoint: ask engine layer first.
   * Returns cached/arrived suggestion or null when unavailable/invalid.
   */
  getDecision(entity: TownEntity, nearbyEntityIds: string[]): CachedSuggestion | null {
    // Non-blocking health refresh; updateEntity() also keeps this warm.
    void this.refreshHealth();
    if (!this.connected || entity.brainKind !== "engine") return null;
    this.requestDecision(entity, nearbyEntityIds);
    const hit = this.consumeDecision(entity.id);
    if (!hit) return null;
    const valid = new Set<BrainDecision>([
      "go_home",
      "seek_food",
      "seek_social",
      "avoid_entity",
      "pursue_daily_objective",
      "wander",
      "idle",
      "start_conversation",
      "reflect",
    ]);
    if (!valid.has(hit.intent)) return null;
    return hit;
  }

  requestConversationContext(entity: TownEntity, otherId: string | null): void {
    if (!this.connected || entity.brainKind !== "engine") return;
    const now = nowMs();
    if (now - (this.lastConversationAt.get(entity.id) ?? 0) < CONVERSATION_INTERVAL_MS) return;
    if (this.pendingConversation.has(entity.id)) return;
    this.pendingConversation.add(entity.id);
    this.lastConversationAt.set(entity.id, now);
    void this.fetchConversationContext(entity, otherId)
      .catch(() => null)
      .finally(() => {
        this.pendingConversation.delete(entity.id);
      });
  }

  /**
   * Awaited variant: required call site for conversation prompt assembly.
   *
   * Returns null only if the brain service is offline or the entity is not
   * engine-backed. When it returns a value, the caller MUST place it at the
   * spine of the LLM prompt (engine context first, generic context last).
   */
  async awaitConversationContext(
    entity: TownEntity,
    otherId: string | null,
    opts: { maxAgeMs?: number; timeoutMs?: number } = {}
  ): Promise<ResidentEngineConversationContext | null> {
    await this.refreshHealth();
    if (!this.connected || entity.brainKind !== "engine") return null;

    const maxAgeMs = opts.maxAgeMs ?? 1500;
    const cached = this.conversationContextCache.get(entity.id);
    if (cached && nowMs() - cached.fetchedAt <= maxAgeMs) {
      return cached;
    }

    const inFlight = this.inFlightConversation.get(entity.id);
    if (inFlight) return inFlight;

    const promise = this.fetchConversationContext(entity, otherId);
    this.inFlightConversation.set(entity.id, promise);

    const timeoutMs = opts.timeoutMs ?? 6000;
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    });
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      if (result) return result;
      const stale = this.conversationContextCache.get(entity.id);
      return stale ?? null;
    } finally {
      this.inFlightConversation.delete(entity.id);
    }
  }

  private async fetchConversationContext(
    entity: TownEntity,
    otherId: string | null
  ): Promise<ResidentEngineConversationContext | null> {
    try {
      const ctx: BrainConversationContextResponse = await getConversationContext({
        entityId: entity.id,
        conversationContext: {
          mood: entity.mood,
          role: entity.role,
          currentGoal: entity.currentGoal,
          otherEntityId: otherId,
          dailyHeadline: entity.dailyPlan?.headline ?? null,
        },
      });
      this.lastConversationAt.set(entity.id, nowMs());
      entity.lastBrainConversationContext = ctx.contextLines.join(" ");
      if (ctx.emotionSummary) entity.lastBrainEmotion = ctx.emotionSummary;

      if (!ctx.engineBrainContext) return null;
      const stored: ResidentEngineConversationContext = {
        contextLines: ctx.contextLines,
        moodLine: ctx.moodLine,
        intentionLine: ctx.intentionLine,
        memoryLine: ctx.memoryLine,
        emotionSummary: ctx.emotionSummary,
        engineBrainContext: ctx.engineBrainContext,
        fetchedAt: nowMs(),
      };
      this.conversationContextCache.set(entity.id, stored);
      return stored;
    } catch {
      this.connected = false;
      entity.brainConnected = false;
      return null;
    }
  }

  /** Read most recent context for HUD/inspection without triggering a fetch. */
  getCachedConversationContext(entityId: string): ResidentEngineConversationContext | null {
    return this.conversationContextCache.get(entityId) ?? null;
  }

  /**
   * Drop every per-entity cache for one id. Call this when an entity is
   * removed from the simulation (mortality, layout reset, LAN client leaving,
   * archival). Without this, every Map below grows monotonically for the
   * lifetime of the page.
   */
  evictEntity(entityId: string): void {
    this.lastUpdateAt.delete(entityId);
    this.lastDecisionAt.delete(entityId);
    this.lastConversationAt.delete(entityId);
    this.lastInitAttemptAt.delete(entityId);
    this.pendingDecision.delete(entityId);
    this.pendingConversation.delete(entityId);
    this.suggestions.delete(entityId);
    this.conversationContextCache.delete(entityId);
    this.inFlightConversation.delete(entityId);
  }

  /**
   * Drop every per-entity cache entry. Called when the world is wiped (layout
   * mode entry, bootstrap into a new town). Equivalent to evicting every
   * entity individually but cheaper.
   */
  clearAll(): void {
    this.lastUpdateAt.clear();
    this.lastDecisionAt.clear();
    this.lastConversationAt.clear();
    this.lastInitAttemptAt.clear();
    this.pendingDecision.clear();
    this.pendingConversation.clear();
    this.suggestions.clear();
    this.conversationContextCache.clear();
    this.inFlightConversation.clear();
  }

  /**
   * Periodic safety net. Drop cache entries for any entity whose id is not in
   * the active set. Cheap O(N entries) sweep; safe to call once per second or
   * on entity-list mutations.
   */
  pruneToActive(activeEntityIds: Iterable<string>): void {
    const keep = activeEntityIds instanceof Set
      ? activeEntityIds as Set<string>
      : new Set<string>(activeEntityIds);
    const sweep = (m: Map<string, unknown> | Set<string>): void => {
      for (const id of m.keys()) {
        if (!keep.has(id)) m.delete(id);
      }
    };
    sweep(this.lastUpdateAt);
    sweep(this.lastDecisionAt);
    sweep(this.lastConversationAt);
    sweep(this.lastInitAttemptAt);
    sweep(this.pendingDecision);
    sweep(this.pendingConversation);
    sweep(this.suggestions);
    sweep(this.conversationContextCache);
    sweep(this.inFlightConversation);
  }

  /**
   * Diagnostic: how many per-entity entries each cache is holding right now.
   * Used by the HUD and by leak-regression checks.
   */
  cacheSizes(): Record<string, number> {
    return {
      lastUpdateAt: this.lastUpdateAt.size,
      lastDecisionAt: this.lastDecisionAt.size,
      lastConversationAt: this.lastConversationAt.size,
      lastInitAttemptAt: this.lastInitAttemptAt.size,
      pendingDecision: this.pendingDecision.size,
      pendingConversation: this.pendingConversation.size,
      suggestions: this.suggestions.size,
      conversationContextCache: this.conversationContextCache.size,
      inFlightConversation: this.inFlightConversation.size,
    };
  }

  async sendResidentEvent(entity: TownEntity, event: Record<string, unknown>): Promise<void> {
    await this.refreshHealth();
    if (!this.connected || entity.brainKind !== "engine") return;
    try {
      await recordResidentEvent({
        entityId: entity.id,
        event: event as Record<string, string | number | boolean | null>,
      });
      entity.lastBrainMemoryEvent = String(event.summary ?? event.type ?? "event");
    } catch {
      this.connected = false;
      entity.brainConnected = false;
    }
  }

  async createChildBrainState(
    parentAId: string,
    parentBId: string,
    childSeed: Record<string, unknown>,
    parentASummary?: Record<string, unknown>,
    parentBSummary?: Record<string, unknown>
  ): Promise<{
    childBrainSummary: string;
    inheritedTraitSuggestions: string[];
    defaults: Record<string, unknown>;
  } | null> {
    await this.refreshHealth();
    if (!this.connected) return null;
    try {
      const out = await createChildBrain({
        parentAId,
        parentBId,
        childSeed: childSeed as Record<string, string | number | boolean | null>,
        parentASummary: parentASummary as Record<string, string | number | boolean | null> | undefined,
        parentBSummary: parentBSummary as Record<string, string | number | boolean | null> | undefined,
      });
      return out as {
        childBrainSummary: string;
        inheritedTraitSuggestions: string[];
        defaults: Record<string, unknown>;
      };
    } catch {
      this.connected = false;
      return null;
    }
  }
}

export const residentBrainAdapter = new ResidentBrainAdapter();

