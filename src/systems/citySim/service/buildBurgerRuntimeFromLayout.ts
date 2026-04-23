import type { PlacedMarkerRecord } from "../townLayout/types";
import {
  BURGER_ALL_MARKER_KEYS,
  BURGER_BUSINESS_ID,
  BURGER_LINE_WORKER_ID,
  BURGER_REQUIRED_MARKER_KEYS,
  BURGER_SHIFT_LEAD_ID,
} from "./burgerConstants";
import type { ServiceBusinessBurgerRuntime } from "./businessTypes";

/**
 * If required burger markers are placed, returns a runtime; otherwise the joint is disabled.
 */
export function tryBuildBurgerRuntimeFromLayout(
  markers: Record<string, PlacedMarkerRecord>
): ServiceBusinessBurgerRuntime | null {
  for (const k of BURGER_REQUIRED_MARKER_KEYS) {
    if (!markers[k]) return null;
  }
  return {
    id: BURGER_BUSINESS_ID,
    kind: "food_counter",
    rootMarkerKey: "burger_joint_root",
    primaryWorkerId: BURGER_LINE_WORKER_ID,
    backupWorkerIds: [BURGER_SHIFT_LEAD_ID],
    spots: {
      orderSpotKey: "burger_customer_order_spot",
      counterSpotKey: "burger_worker_counter_spot",
      kitchenSpotKey: "burger_kitchen_prep_spot",
      handoffSpotKey: "burger_pickup_handoff_spot",
      diningSpotKey: markers.burger_dining_spot
        ? "burger_dining_spot"
        : null,
      queueSpotKey: markers.burger_queue_spot ? "burger_queue_spot" : null,
      cleanupSpotKey: markers.burger_cleanup_spot
        ? "burger_cleanup_spot"
        : null,
      managerSpotKey: markers.burger_manager_spot
        ? "burger_manager_spot"
        : null,
    },
    nextOrderSerial: 1,
    orders: [],
    cashInDrawer: 0,
    workerPhase: "idle_counter",
    activeOrderId: null,
    prepCompleteAt: null,
  };
}

export function isBurgerMarkerKey(key: string): boolean {
  return (BURGER_ALL_MARKER_KEYS as readonly string[]).includes(key);
}
