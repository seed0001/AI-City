import type { MemoryEvent, TownEntity } from "./types";

let memorySeq = 0;

export class MemorySystem {
  private memories = new Map<string, MemoryEvent>();

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
    }
    return ev;
  }

  get(id: string): MemoryEvent | undefined {
    return this.memories.get(id);
  }

  recentFor(entity: TownEntity, limit: number): MemoryEvent[] {
    const out: MemoryEvent[] = [];
    for (const mid of [...entity.memoryIds].reverse()) {
      const m = this.memories.get(mid);
      if (m) out.push(m);
      if (out.length >= limit) break;
    }
    return out;
  }
}
