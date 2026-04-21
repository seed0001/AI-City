import type { CityLocation, CityLocationKind } from "./types";

export class LocationRegistry {
  private byId = new Map<string, CityLocation>();

  constructor(locations: CityLocation[]) {
    for (const loc of locations) {
      this.byId.set(loc.id, loc);
    }
  }

  get(id: string): CityLocation | undefined {
    return this.byId.get(id);
  }

  all(): CityLocation[] {
    return [...this.byId.values()];
  }

  /** Prefer kinds; fall back to any location if none match. */
  randomByKinds(
    kinds: CityLocationKind[],
    excludeId?: string
  ): CityLocation | undefined {
    const pool = this.all().filter(
      (l) => l.id !== excludeId && kinds.includes(l.type)
    );
    const list = pool.length ? pool : this.all().filter((l) => l.id !== excludeId);
    if (!list.length) return this.all()[0];
    return list[Math.floor(Math.random() * list.length)];
  }

  randomDestination(excludeId?: string): CityLocation {
    const list = this.all().filter((l) => l.id !== excludeId);
    if (!list.length) return this.all()[0]!;
    return list[Math.floor(Math.random() * list.length)]!;
  }
}
