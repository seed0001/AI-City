import type { MemoryEvent, TownEntity } from "./types";

let memorySeq = 0;
let longTermSeq = 0;

const STORAGE_KEY = "ai-city-memory-v2";
const STORAGE_VERSION = 1 as const;
const MAX_SHORT_TERM_PER_ACTOR = 20;
const MAX_EPISODIC_PER_ACTOR = 120;
const MAX_LONG_TERM_PER_ACTOR = 30;
const MAX_GLOBAL_EVENTS = 1200;

type LongTermMemoryRecord = {
  id: string;
  key: string;
  summary: string;
  salience: number;
  typeHint: string;
  reinforcements: number;
  firstSeenAt: number;
  lastReinforcedAt: number;
};

type PersistedMemoryState = {
  version: typeof STORAGE_VERSION;
  events: MemoryEvent[];
  shortTermByActor: Record<string, string[]>;
  episodicIndexByActor: Record<string, string[]>;
  longTermByActor: Record<string, LongTermMemoryRecord[]>;
};

function toObjectOfArrays(map: Map<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of map.entries()) out[k] = [...v];
  return out;
}

function toObjectOfLongTerm(
  map: Map<string, LongTermMemoryRecord[]>
): Record<string, LongTermMemoryRecord[]> {
  const out: Record<string, LongTermMemoryRecord[]> = {};
  for (const [k, v] of map.entries()) out[k] = [...v];
  return out;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function normalizeSummaryKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function distillSummary(event: MemoryEvent): string {
  const summary = event.summary.trim();
  if (!summary) return `${event.type} happened`;
  if (summary.length <= 220) return summary;
  return `${summary.slice(0, 217)}...`;
}

export class MemorySystem {
  private memories = new Map<string, MemoryEvent>();
  private shortTermByActor = new Map<string, string[]>();
  private episodicIndexByActor = new Map<string, string[]>();
  private longTermByActor = new Map<string, LongTermMemoryRecord[]>();
  private eventSinks = new Set<(event: MemoryEvent, actors: TownEntity[]) => void>();

  constructor() {
    this.hydrateFromStorage();
  }

  private pushBounded(
    index: Map<string, string[]>,
    actorId: string,
    eventId: string,
    max: number
  ): void {
    const cur = index.get(actorId) ?? [];
    cur.push(eventId);
    if (cur.length > max) cur.splice(0, cur.length - max);
    index.set(actorId, cur);
  }

  private reinforceLongTerm(actorId: string, event: MemoryEvent): void {
    const key = normalizeSummaryKey(event.summary);
    if (!key) return;
    const now = event.timestamp;
    const list = this.longTermByActor.get(actorId) ?? [];
    const hit = list.find((x) => x.key === key);
    const baseSalience = Math.max(0.1, Math.abs(event.emotionalImpact));
    if (hit) {
      hit.reinforcements += 1;
      hit.lastReinforcedAt = now;
      hit.salience = clamp01(hit.salience * 0.82 + baseSalience * 0.28);
      hit.summary = distillSummary(event);
      hit.typeHint = event.type;
    } else {
      list.push({
        id: `ltm_${++longTermSeq}_${now}`,
        key,
        summary: distillSummary(event),
        salience: clamp01(baseSalience),
        typeHint: event.type,
        reinforcements: 1,
        firstSeenAt: now,
        lastReinforcedAt: now,
      });
    }
    list.sort((a, b) => {
      if (b.salience !== a.salience) return b.salience - a.salience;
      return b.lastReinforcedAt - a.lastReinforcedAt;
    });
    if (list.length > MAX_LONG_TERM_PER_ACTOR) list.length = MAX_LONG_TERM_PER_ACTOR;
    this.longTermByActor.set(actorId, list);
  }

  private persist(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const state: PersistedMemoryState = {
        version: STORAGE_VERSION,
        events: Array.from(this.memories.values()),
        shortTermByActor: toObjectOfArrays(this.shortTermByActor),
        episodicIndexByActor: toObjectOfArrays(this.episodicIndexByActor),
        longTermByActor: toObjectOfLongTerm(this.longTermByActor),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore storage quota and private mode failures */
    }
  }

  private trimGlobalEvents(): void {
    const events = Array.from(this.memories.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
    if (events.length <= MAX_GLOBAL_EVENTS) return;
    const removeCount = events.length - MAX_GLOBAL_EVENTS;
    const idsToRemove = new Set(events.slice(0, removeCount).map((e) => e.id));
    for (const id of idsToRemove) this.memories.delete(id);

    const pruneIndex = (index: Map<string, string[]>) => {
      for (const [actorId, ids] of index.entries()) {
        const kept = ids.filter((id) => !idsToRemove.has(id));
        index.set(actorId, kept);
      }
    };
    pruneIndex(this.shortTermByActor);
    pruneIndex(this.episodicIndexByActor);
  }

  private hydrateFromStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedMemoryState>;
      if (!parsed || parsed.version !== STORAGE_VERSION) return;

      const events = Array.isArray(parsed.events) ? parsed.events : [];
      for (const ev of events) {
        if (
          !ev ||
          typeof ev.id !== "string" ||
          typeof ev.summary !== "string" ||
          !isFiniteNumber(ev.timestamp) ||
          !Array.isArray(ev.actorIds)
        ) {
          continue;
        }
        this.memories.set(ev.id, {
          ...ev,
          locationId: ev.locationId ?? null,
          emotionalImpact: isFiniteNumber(ev.emotionalImpact) ? ev.emotionalImpact : 0,
          type: typeof ev.type === "string" ? ev.type : "event",
          actorIds: ev.actorIds.filter((id): id is string => typeof id === "string"),
        });
      }

      const loadIndex = (obj: unknown): Map<string, string[]> => {
        const map = new Map<string, string[]>();
        if (!obj || typeof obj !== "object") return map;
        for (const [actorId, ids] of Object.entries(obj as Record<string, unknown>)) {
          if (!Array.isArray(ids)) continue;
          map.set(
            actorId,
            ids.filter((x): x is string => typeof x === "string" && this.memories.has(x))
          );
        }
        return map;
      };

      this.shortTermByActor = loadIndex(parsed.shortTermByActor);
      this.episodicIndexByActor = loadIndex(parsed.episodicIndexByActor);

      if (parsed.longTermByActor && typeof parsed.longTermByActor === "object") {
        for (const [actorId, rows] of Object.entries(parsed.longTermByActor)) {
          if (!Array.isArray(rows)) continue;
          const normalized = rows
            .filter((r) => r && typeof r === "object")
            .map((r) => {
              const o = r as Partial<LongTermMemoryRecord>;
              const now = Date.now();
              return {
                id:
                  typeof o.id === "string"
                    ? o.id
                    : `ltm_${++longTermSeq}_${now}`,
                key: typeof o.key === "string" ? o.key : "",
                summary: typeof o.summary === "string" ? o.summary : "",
                salience: isFiniteNumber(o.salience) ? clamp01(o.salience) : 0.2,
                typeHint: typeof o.typeHint === "string" ? o.typeHint : "event",
                reinforcements: isFiniteNumber(o.reinforcements) ? o.reinforcements : 1,
                firstSeenAt: isFiniteNumber(o.firstSeenAt) ? o.firstSeenAt : now,
                lastReinforcedAt: isFiniteNumber(o.lastReinforcedAt)
                  ? o.lastReinforcedAt
                  : now,
              };
            })
            .filter((row) => row.summary.trim().length > 0 && row.key.trim().length > 0)
            .slice(0, MAX_LONG_TERM_PER_ACTOR);
          this.longTermByActor.set(actorId, normalized);
        }
      }

      memorySeq = Math.max(memorySeq, this.memories.size);
    } catch {
      /* ignore malformed storage */
    }
  }

  add(
    actors: TownEntity[],
    partial: Omit<MemoryEvent, "id" | "timestamp" | "actorIds">
  ): MemoryEvent {
    const id = `mem_${++memorySeq}_${Date.now()}`;
    const ev: MemoryEvent = {
      ...partial,
      id,
      timestamp: Date.now(),
      actorIds: actors.map((a) => a.id),
    };
    this.memories.set(id, ev);
    for (const a of actors) {
      a.memoryIds.push(id);
      if (a.memoryIds.length > 12) a.memoryIds.shift();
      this.pushBounded(this.shortTermByActor, a.id, id, MAX_SHORT_TERM_PER_ACTOR);
      this.pushBounded(this.episodicIndexByActor, a.id, id, MAX_EPISODIC_PER_ACTOR);
      this.reinforceLongTerm(a.id, ev);
    }
    this.trimGlobalEvents();
    this.persist();
    for (const sink of this.eventSinks) {
      sink(ev, actors);
    }
    return ev;
  }

  subscribeEvents(
    sink: (event: MemoryEvent, actors: TownEntity[]) => void
  ): () => void {
    this.eventSinks.add(sink);
    return () => {
      this.eventSinks.delete(sink);
    };
  }

  get(id: string): MemoryEvent | undefined {
    return this.memories.get(id);
  }

  recentFor(entity: TownEntity, limit: number): MemoryEvent[] {
    if (limit <= 0) return [];
    const out: MemoryEvent[] = [];
    const sourceIds =
      entity.memoryIds.length > 0
        ? entity.memoryIds
        : this.shortTermByActor.get(entity.id) ?? [];
    for (const mid of [...sourceIds].reverse()) {
      const m = this.memories.get(mid);
      if (m) out.push(m);
      if (out.length >= limit) break;
    }
    return out;
  }

  episodicFor(entity: TownEntity, limit: number): MemoryEvent[] {
    if (limit <= 0) return [];
    const ids = this.episodicIndexByActor.get(entity.id) ?? [];
    const out: MemoryEvent[] = [];
    for (const id of [...ids].reverse()) {
      const m = this.memories.get(id);
      if (!m) continue;
      out.push(m);
      if (out.length >= limit) break;
    }
    return out;
  }

  longTermFor(entity: TownEntity, limit: number): string[] {
    if (limit <= 0) return [];
    const rows = this.longTermByActor.get(entity.id) ?? [];
    return rows
      .slice(0, limit)
      .map((row) => row.summary)
      .filter(Boolean);
  }

  layeredSummariesFor(
    entity: TownEntity,
    opts?: {
      shortTermLimit?: number;
      episodicLimit?: number;
      longTermLimit?: number;
    }
  ): {
    shortTerm: string[];
    episodic: string[];
    longTerm: string[];
  } {
    const shortTermLimit = opts?.shortTermLimit ?? 4;
    const episodicLimit = opts?.episodicLimit ?? 6;
    const longTermLimit = opts?.longTermLimit ?? 6;
    return {
      shortTerm: this.recentFor(entity, shortTermLimit).map((m) => m.summary),
      episodic: this.episodicFor(entity, episodicLimit).map((m) => m.summary),
      longTerm: this.longTermFor(entity, longTermLimit),
    };
  }

  hydrateEntityMemoryIds(entities: TownEntity[]): void {
    for (const e of entities) {
      const ids = this.shortTermByActor.get(e.id) ?? [];
      e.memoryIds = ids.slice(-12);
    }
  }

  /**
   * Drop every memory artifact tied to one entity.
   *
   * - Removes per-actor short-term, episodic, and long-term indexes for the id.
   * - Removes the id from each remaining event's actorIds list.
   * - Drops any event that ends up with zero actors.
   *
   * Call when an entity is permanently removed from the simulation (network
   * client departure, mortality, archival). Without this, the per-actor
   * indexes grow monotonically across the lifetime of the localStorage entry.
   */
  forgetEntity(entityId: string): void {
    this.shortTermByActor.delete(entityId);
    this.episodicIndexByActor.delete(entityId);
    this.longTermByActor.delete(entityId);

    const droppedIds: string[] = [];
    for (const [memId, mem] of this.memories.entries()) {
      if (!mem.actorIds.includes(entityId)) continue;
      const remaining = mem.actorIds.filter((id) => id !== entityId);
      if (remaining.length === 0) {
        droppedIds.push(memId);
        this.memories.delete(memId);
      } else {
        mem.actorIds = remaining;
      }
    }

    if (droppedIds.length > 0) {
      const droppedSet = new Set(droppedIds);
      const cleanIndex = (index: Map<string, string[]>): void => {
        for (const [actorId, ids] of index.entries()) {
          const kept = ids.filter((id) => !droppedSet.has(id));
          if (kept.length === ids.length) continue;
          index.set(actorId, kept);
        }
      };
      cleanIndex(this.shortTermByActor);
      cleanIndex(this.episodicIndexByActor);
    }

    this.persist();
  }

  /**
   * Periodic safety net for entities removed without going through
   * forgetEntity (e.g. layout swaps, stale localStorage from past sessions).
   * Drops any per-actor index whose id is not in the active set, plus any
   * events that no longer have any active actor.
   */
  pruneToActiveActors(activeEntityIds: Iterable<string>): void {
    const keep = activeEntityIds instanceof Set
      ? activeEntityIds as Set<string>
      : new Set<string>(activeEntityIds);
    const sweep = (m: Map<string, unknown>): void => {
      for (const id of m.keys()) {
        if (!keep.has(id)) m.delete(id);
      }
    };
    sweep(this.shortTermByActor);
    sweep(this.episodicIndexByActor);
    sweep(this.longTermByActor);

    const droppedIds: string[] = [];
    for (const [memId, mem] of this.memories.entries()) {
      const remaining = mem.actorIds.filter((id) => keep.has(id));
      if (remaining.length === 0) {
        droppedIds.push(memId);
        this.memories.delete(memId);
      } else if (remaining.length !== mem.actorIds.length) {
        mem.actorIds = remaining;
      }
    }
    if (droppedIds.length > 0) this.persist();
  }

  /**
   * Diagnostic: in-memory size of every layer. Used by HUD and leak probes.
   */
  diagnostics(): {
    events: number;
    actorsShort: number;
    actorsEpisodic: number;
    actorsLong: number;
    longTermRecords: number;
  } {
    let longTermRecords = 0;
    for (const list of this.longTermByActor.values()) longTermRecords += list.length;
    return {
      events: this.memories.size,
      actorsShort: this.shortTermByActor.size,
      actorsEpisodic: this.episodicIndexByActor.size,
      actorsLong: this.longTermByActor.size,
      longTermRecords,
    };
  }
}
