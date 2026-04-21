import type { RelationshipState, TownEntity } from "./types";

export function pairKey(aId: string, bId: string): string {
  return [aId, bId].sort().join("|");
}

export function ensureRelationship(
  entity: TownEntity,
  otherId: string
): RelationshipState {
  if (!entity.relationships[otherId]) {
    entity.relationships[otherId] = {
      trust: 0.5,
      tension: 0.2,
      familiarity: 0.2,
      friendliness: 0.5,
      avoid: false,
    };
  }
  return entity.relationships[otherId];
}

export function applyConversationOutcome(
  a: TownEntity,
  b: TownEntity,
  trustDelta: number,
  tensionDelta: number,
  familiarityDelta: number
): void {
  const ra = ensureRelationship(a, b.id);
  const rb = ensureRelationship(b, a.id);
  ra.trust = clamp01(ra.trust + trustDelta);
  ra.tension = clamp01(ra.tension + tensionDelta);
  ra.familiarity = clamp01(ra.familiarity + familiarityDelta);
  ra.friendliness = clamp01(ra.friendliness + trustDelta * 0.5);
  rb.trust = clamp01(rb.trust + trustDelta);
  rb.tension = clamp01(rb.tension + tensionDelta);
  rb.familiarity = clamp01(rb.familiarity + familiarityDelta);
  rb.friendliness = clamp01(rb.friendliness + trustDelta * 0.5);
}

export function setAvoidance(entity: TownEntity, otherId: string, on: boolean): void {
  const r = ensureRelationship(entity, otherId);
  r.avoid = on;
  if (on) entity.avoidingEntityId = otherId;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
