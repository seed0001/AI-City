import type { TownEntity } from "./types";

export class EntityRegistry {
  private entities = new Map<string, TownEntity>();

  add(entity: TownEntity): void {
    this.entities.set(entity.id, entity);
  }

  get(id: string): TownEntity | undefined {
    return this.entities.get(id);
  }

  all(): TownEntity[] {
    return [...this.entities.values()];
  }

  aiEntities(): TownEntity[] {
    return this.all().filter((e) => e.controllerType === "ai");
  }

  remove(id: string): void {
    this.entities.delete(id);
  }

  clear(): void {
    this.entities.clear();
  }
}
