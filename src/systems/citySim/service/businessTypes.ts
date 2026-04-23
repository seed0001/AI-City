/**
 * Generic service-economy types. Burger is the first `ServiceBusinessKind`;
 * police / hospital / etc. can reuse the same patterns later.
 */

export type ServiceBusinessKind = "food_counter" | "civic" | "retail";

export type ServiceOrderState =
  | "queued"
  | "accepted"
  | "preparing"
  | "ready_for_handoff"
  | "completed"
  | "cancelled";

export type BurgerWorkerRuntimePhase =
  | "idle_counter"
  | "to_kitchen"
  | "at_prep"
  | "to_handoff"
  | "return_counter";

export interface ServiceOrder {
  id: string;
  businessId: string;
  customerId: string;
  /** Worker fulfilling this order. */
  workerId: string;
  state: ServiceOrderState;
  itemLabel: string;
  price: number;
  createdAt: number;
  /** Filled when prep timer completes. */
  readyAt: number | null;
}

/**
 * In-memory business shell (skeleton for future save/load or multi-tenant use).
 * Runtime positions always come from placed layout + entity ids at bootstrap.
 */
export interface ServiceBusinessRuntimeBase {
  id: string;
  kind: ServiceBusinessKind;
  /** Placed root marker (also usually in `CityLocation` for nav). */
  rootMarkerKey: string;
  /** All worker-capable entity ids; index 0 is the active line role for burger. */
  primaryWorkerId: string;
  backupWorkerIds: string[];
}

export interface ServiceBusinessBurgerSpots {
  orderSpotKey: string;
  counterSpotKey: string;
  kitchenSpotKey: string;
  handoffSpotKey: string;
  diningSpotKey: string | null;
  queueSpotKey: string | null;
  cleanupSpotKey: string | null;
  managerSpotKey: string | null;
}

export interface ServiceBusinessBurgerRuntime
  extends ServiceBusinessRuntimeBase {
  kind: "food_counter";
  /** Burger-specific interior markers (world-space from saved layout). */
  spots: ServiceBusinessBurgerSpots;
  /** Monotonic counter for `ServiceOrder` ids. */
  nextOrderSerial: number;
  orders: ServiceOrder[];
  cashInDrawer: number;
  /** Worker FSM. */
  workerPhase: BurgerWorkerRuntimePhase;
  activeOrderId: string | null;
  prepCompleteAt: number | null;
}

export type ServiceBusinessInstance = ServiceBusinessBurgerRuntime;
