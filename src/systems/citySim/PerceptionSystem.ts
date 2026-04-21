import type { TownEntity } from "./types";
import { LocationRegistry } from "./LocationRegistry";

export function distance2D(
  a: { x: number; z: number },
  b: { x: number; z: number }
): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function getNearbyEntities(
  self: TownEntity,
  all: TownEntity[],
  radius: number
): TownEntity[] {
  return all.filter((other) => {
    if (other.id === self.id) return false;
    return distance2D(self.position, other.position) <= radius;
  });
}

export function getNearestLocation(
  entity: TownEntity,
  locations: LocationRegistry
): { id: string; label: string; distance: number } | null {
  let best: { id: string; label: string; distance: number } | null = null;
  for (const loc of locations.all()) {
    const d = distance2D(entity.position, loc.position);
    if (!best || d < best.distance) {
      best = { id: loc.id, label: loc.label, distance: d };
    }
  }
  return best;
}

export function canStartConversation(
  a: TownEntity,
  b: TownEntity,
  talkRadius: number,
  now: number
): boolean {
  if (a.id === b.id) return false;
  if (a.conversation || b.conversation) return false;
  if (now < a.conversationCooldownUntil || now < b.conversationCooldownUntil)
    return false;
  if (a.currentAction === "leaving" || b.currentAction === "leaving")
    return false;
  if (a.avoidingEntityId === b.id || b.avoidingEntityId === a.id) return false;
  if (distance2D(a.position, b.position) > talkRadius) return false;
  if (a.socialTolerance < 0.15 || b.socialTolerance < 0.15) return false;
  return true;
}
