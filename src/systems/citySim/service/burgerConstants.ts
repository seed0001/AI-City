/** Burger joint service flow — times, money, and entity ids. */

import { ENTITY_Y } from "../constants";

export const BURGER_BUSINESS_ID = "biz_burger_joint";

/** Primary line cook (must match `CHARACTER_SEEDS` id). */
export const BURGER_LINE_WORKER_ID = "npc_maya";

/** Shift lead / backup (future scheduling; used in runtime + debug). */
export const BURGER_SHIFT_LEAD_ID = "npc_river";

export const BURGER_ITEM_LABEL = "Classic town burger";
export const BURGER_ORDER_PRICE = 12;

/** Walk within this 2D distance of the order marker to place an order. */
export const BURGER_ORDER_PROXIMITY = 2.3;

/** Time at kitchen prep spot before food is "ready" (ms). */
export const BURGER_PREP_DURATION_MS = 4_200;

/**
 * Markers that must exist (placed) for the burger joint service runtime to activate.
 * Sub-spots are not included in `CityLocation` — only in this service layer.
 */
export const BURGER_REQUIRED_MARKER_KEYS = [
  "burger_joint_root",
  "burger_customer_order_spot",
  "burger_worker_counter_spot",
  "burger_kitchen_prep_spot",
  "burger_pickup_handoff_spot",
] as const;

export const BURGER_ALL_MARKER_KEYS = [
  ...BURGER_REQUIRED_MARKER_KEYS,
  "burger_dining_spot",
  "burger_queue_spot",
  "burger_cleanup_spot",
  "burger_manager_spot",
] as const;

export function entityYForService(): number {
  return ENTITY_Y;
}
