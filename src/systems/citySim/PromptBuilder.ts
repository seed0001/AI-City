import type { TownEntity, WorldContextPacket } from "./types";
import { LocationRegistry } from "./LocationRegistry";
import { MemorySystem } from "./MemorySystem";
import { ensureRelationship } from "./SocialSystem";
import { getNearestLocation, getNearbyEntities } from "./PerceptionSystem";
import { PERCEPTION_RADIUS } from "./constants";
import { formatDesiresLine, formatNeedsLine } from "./DailyPlanSystem";
import { buildLlmLifeFields } from "./LifeArcSystem";

/**
 * Builds LLM-safe context: only in-world, perceivable facts.
 * NEVER pass controllerType, engine ids, or debug payloads.
 */
export function buildWorldContext(
  self: TownEntity,
  registry: { all(): TownEntity[] },
  locations: LocationRegistry,
  memories: MemorySystem,
  conversationPartnerId: string | null
): WorldContextPacket {
  const everyone = registry.all();
  const nearby = getNearbyEntities(self, everyone, PERCEPTION_RADIUS).map(
    (o) => ({
      displayName: o.displayName,
      role: o.role,
      distance: Math.hypot(
        o.position.x - self.position.x,
        o.position.z - self.position.z
      ),
      apparentAction: o.currentAction,
    })
  );

  const nearest = getNearestLocation(self, locations);
  const recent = memories.recentFor(self, 4).map((m) => m.summary);

  let relationshipWithFocus: WorldContextPacket["relationshipWithFocus"] =
    null;
  let lastUtterance: string | null = null;

  if (conversationPartnerId) {
    const other = everyone.find((e) => e.id === conversationPartnerId);
    if (other) {
      const r = ensureRelationship(self, other.id);
      relationshipWithFocus = {
        otherDisplayName: other.displayName,
        trust: r.trust,
        tension: r.tension,
        familiarity: r.familiarity,
        friendliness: r.friendliness,
      };
      if (
        self.inConversation &&
        self.conversationId &&
        other.inConversation &&
        other.conversationId === self.conversationId
      ) {
        lastUtterance = self.conversationLastLine ?? null;
      }
    }
  }

  const plan = self.dailyPlan;
  const life = buildLlmLifeFields(self);
  return {
    self: {
      displayName: self.displayName,
      gender: self.gender,
      role: self.role,
      mood: self.mood,
      currentAction: self.currentAction,
      currentGoal: self.currentGoal,
      ...life,
      ...(plan
        ? {
            dailyHeadline: plan.headline,
            dayArcProgress: plan.arcProgress,
            dayFulfillment: plan.fulfillment,
            dailyNeedsLine: formatNeedsLine(plan),
            dailyDesiresLine: formatDesiresLine(plan),
          }
        : {}),
    },
    place: {
      locationId: nearest?.id ?? self.currentLocationId,
      label: nearest?.label ?? "Unknown area",
    },
    nearbyPeople: nearby,
    memorySummaries: recent,
    relationshipWithFocus,
    lastUtteranceInConversation: lastUtterance,
  };
}

/** Serialize context for a future LLM API (JSON-safe, still no controller fields). */
export function worldContextToPromptJson(ctx: WorldContextPacket): string {
  return JSON.stringify(ctx, null, 2);
}
