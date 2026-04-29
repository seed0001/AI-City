import type { TownEntity } from "./types";
import type { LocationRegistry } from "./LocationRegistry";
import { startWalkTo } from "./MovementSystem";
import { distance2D } from "./PerceptionSystem";
import {
  DECISION_INTERVAL_MAX_MS,
  DECISION_INTERVAL_MIN_MS,
} from "./constants";
import {
  dailyObjectivePull,
  pickDailyPursuitLocation,
} from "./DailyPlanSystem";
import type { BrainDecision } from "./brains/residentBrainClient";
import { residentBrainAdapter } from "./brains/ResidentBrainAdapter";

type BrainSuggestion = {
  intent: BrainDecision;
  confidence: number;
  targetEntityId?: string | null;
  rationale?: string;
} | null;

export function scheduleNextDecision(entity: TownEntity, now: number): void {
  const span = DECISION_INTERVAL_MAX_MS - DECISION_INTERVAL_MIN_MS;
  entity.nextDecisionAt =
    now + DECISION_INTERVAL_MIN_MS + Math.random() * span;
}

export function runAiDecision(
  entity: TownEntity,
  locations: LocationRegistry,
  allEntities: TownEntity[],
  now: number
): void {
  if (entity.controllerType !== "ai") return;
  if (entity.serviceMovementLock) return;
  if (entity.inConversation) return;
  if (entity.currentAction === "walking") return;
  if (now < entity.nextDecisionAt) return;

  const others = allEntities.filter((e) => e.id !== entity.id);
  const exclude = entity.currentLocationId ?? undefined;

  // Engine-driven primary path.
  const suggestion: BrainSuggestion = residentBrainAdapter.getDecision(
    entity,
    others.map((o) => o.id)
  );
  if (suggestion && suggestion.confidence >= 0.25) {
    switch (suggestion.intent) {
      case "go_home": {
        const home = entity.homeMarkerKey ? locations.get(entity.homeMarkerKey) : undefined;
        if (home) {
          entity.currentGoal = "Rest at home";
          startWalkTo(entity, { ...home.position }, home.id);
          entity.decisionSource = "engine";
          scheduleNextDecision(entity, now);
          return;
        }
        break;
      }
      case "seek_food": {
        const store = locations.randomByKinds(["store"], exclude);
        if (store) {
          entity.currentGoal = `Go to ${store.label}`;
          startWalkTo(entity, { ...store.position }, store.id);
          entity.decisionSource = "engine";
          scheduleNextDecision(entity, now);
          return;
        }
        break;
      }
      case "start_conversation": {
        const preferred = suggestion.targetEntityId
          ? others.find((x) => x.id === suggestion.targetEntityId)
          : null;
        const nearest =
          preferred ??
          others
            .map((o) => ({ e: o, d: distance2D(entity.position, o.position) }))
            .sort((a, b) => a.d - b.d)[0]?.e;
        if (nearest) {
          const d = distance2D(entity.position, nearest.position);
          if (d > 2.8) {
            entity.currentGoal = `Approach ${nearest.displayName}`;
            startWalkTo(entity, { ...nearest.position }, nearest.currentLocationId);
          } else {
            entity.currentAction = "idle";
            entity.currentGoal = `Talk with ${nearest.displayName}`;
          }
          entity.decisionSource = "engine";
          scheduleNextDecision(entity, now);
          return;
        }
        break;
      }
      case "seek_social": {
        const social = locations.randomByKinds(["park", "social"], exclude);
        if (social) {
          entity.currentGoal = `Meet people at ${social.label}`;
          startWalkTo(entity, { ...social.position }, social.id);
          entity.decisionSource = "engine";
          scheduleNextDecision(entity, now);
          return;
        }
        break;
      }
      case "avoid_entity": {
        const target = suggestion.targetEntityId
          ? allEntities.find((x) => x.id === suggestion.targetEntityId)
          : null;
        if (target) {
          entity.avoidingEntityId = target.id;
          const far = locations
            .all()
            .sort(
              (a, b) =>
                distance2D(entity.position, b.position) -
                distance2D(entity.position, a.position)
            )[0];
          if (far) {
            entity.currentGoal = "Get some space";
            startWalkTo(entity, { ...far.position }, far.id);
            entity.decisionSource = "engine";
            scheduleNextDecision(entity, now);
            return;
          }
        }
        break;
      }
      case "pursue_daily_objective": {
        const pursuit = pickDailyPursuitLocation(entity, locations, exclude);
        if (pursuit) {
          entity.currentGoal =
            entity.dailyPlan?.objectives.find((o) => !o.completed)?.summary ??
            pursuit.label;
          startWalkTo(entity, { ...pursuit.position }, pursuit.id);
          entity.decisionSource = "engine";
          scheduleNextDecision(entity, now);
          return;
        }
        break;
      }
      case "reflect":
      case "idle":
        entity.currentAction = "idle";
        entity.currentGoal = suggestion.rationale?.slice(0, 64) || "Reflect quietly";
        entity.decisionSource = "engine";
        scheduleNextDecision(entity, now);
        return;
      case "wander":
      default: {
        const dest = locations.randomDestination(exclude);
        entity.currentGoal = `Wander toward ${dest.label}`;
        startWalkTo(entity, { ...dest.position }, dest.id);
        entity.decisionSource = "engine";
        scheduleNextDecision(entity, now);
        return;
      }
    }
  }

  entity.decisionSource = "fallback";
  const threat = others.find(
    (o) =>
      entity.avoidingEntityId === o.id &&
      distance2D(entity.position, o.position) < 8
  );
  if (threat && Math.random() < 0.7) {
    const far = locations
      .all()
      .sort(
        (a, b) =>
          distance2D(entity.position, b.position) -
          distance2D(entity.position, a.position)
      )[0];
    if (far) {
      entity.currentGoal = "Get some space";
      startWalkTo(entity, { ...far.position }, far.id);
      entity.avoidingEntityId = null;
      scheduleNextDecision(entity, now);
      return;
    }
  }

  // Tired -> home (marker registry)
  if (entity.energy < 0.28 && entity.homeMarkerKey) {
    const home = locations.get(entity.homeMarkerKey);
    if (home) {
      entity.currentGoal = "Rest at home";
      startWalkTo(entity, { ...home.position }, home.id);
      scheduleNextDecision(entity, now);
      return;
    }
  }

  // Hungry -> store (keeps the body viable in the town; urgency rises past ~0.65)
  if (entity.hunger > 0.65) {
    const store = locations.randomByKinds(["store"], exclude);
    if (store) {
      entity.currentGoal = `Go to ${store.label}`;
      startWalkTo(entity, { ...store.position }, store.id);
      scheduleNextDecision(entity, now);
      return;
    }
  }

  // Social urge (high = low socialTolerance) -> park or square if present
  const socialUrge = 1 - entity.socialTolerance;
  const connection = entity.dailyPlan?.needs.find((n) => n.kind === "connection");
  const connectionLow = connection && connection.satisfaction < 0.34;
  if (socialUrge > 0.52 || connectionLow) {
    const social = locations.randomByKinds(["park", "social"], exclude);
    if (social) {
      entity.currentGoal = `Meet people at ${social.label}`;
      startWalkTo(entity, { ...social.position }, social.id);
      scheduleNextDecision(entity, now);
      return;
    }
  }

  const pull = dailyObjectivePull(entity);
  if (Math.random() < pull * 0.88) {
    const pursuit = pickDailyPursuitLocation(entity, locations, exclude);
    if (pursuit) {
      const label =
        entity.dailyPlan?.objectives.find((o) => !o.completed)?.summary ??
        pursuit.label;
      entity.currentGoal = label;
      startWalkTo(entity, { ...pursuit.position }, pursuit.id);
      scheduleNextDecision(entity, now);
      return;
    }
  }

  const roll = Math.random();
  if (roll < 0.55) {
    const dest = locations.randomDestination(exclude);
    entity.currentGoal = `Head toward ${dest.label}`;
    startWalkTo(entity, { ...dest.position }, dest.id);
  } else if (roll < 0.8) {
    entity.currentAction = "idle";
    entity.currentGoal = "Loiter nearby";
  } else {
    entity.currentGoal = "People-watch";
    entity.currentAction = "sitting";
  }

  scheduleNextDecision(entity, now);
}
