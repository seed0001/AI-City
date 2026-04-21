import type { TownEntity } from "./types";
import { MOVE_SPEED_NPC } from "./constants";
import { distance2D } from "./PerceptionSystem";

const ARRIVE_EPS = 0.35;

export function moveTowardDestination(
  entity: TownEntity,
  delta: number,
  speed: number = MOVE_SPEED_NPC
): void {
  if (entity.currentAction === "talking") return;
  if (!entity.destinationPosition || entity.currentAction !== "walking") return;

  const target = entity.destinationPosition;
  const dx = target.x - entity.position.x;
  const dz = target.z - entity.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < ARRIVE_EPS) {
    entity.position.x = target.x;
    entity.position.z = target.z;
    entity.position.y = target.y;
    entity.destinationPosition = null;
    entity.destinationLocationId = null;
    entity.currentAction = "idle";
    entity.rotation = Math.atan2(dx, dz);
    return;
  }

  const step = speed * delta;
  const nx = dx / dist;
  const nz = dz / dist;
  entity.position.x += nx * Math.min(step, dist);
  entity.position.z += nz * Math.min(step, dist);
  entity.position.y = target.y;
  entity.rotation = Math.atan2(nx, nz);
}

export function startWalkTo(
  entity: TownEntity,
  dest: { x: number; y: number; z: number },
  locationId: string | null
): void {
  entity.destinationPosition = { ...dest };
  entity.destinationLocationId = locationId;
  entity.currentAction = "walking";
}

export function isAtDestination(entity: TownEntity): boolean {
  if (!entity.destinationPosition) return true;
  return (
    distance2D(entity.position, entity.destinationPosition) < ARRIVE_EPS
  );
}
