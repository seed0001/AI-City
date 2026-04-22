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
  if (entity.conversation) return;
  if (entity.currentAction === "walking") return;
  if (now < entity.nextDecisionAt) return;

  const others = allEntities.filter((e) => e.id !== entity.id);
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

  const exclude = entity.currentLocationId ?? undefined;

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
