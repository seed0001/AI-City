import { HUMAN_ENTITY_ID } from "../data/townCharacters";
import type { DialogueLine } from "../dialogueTypes";
import { startWalkTo } from "../MovementSystem";
import { distance2D } from "../PerceptionSystem";
import type { TownEntity } from "../types";
import type { PlacedMarkerRecord } from "../townLayout/types";
import type { ServiceOrder, ServiceBusinessBurgerRuntime } from "./businessTypes";
import {
  BURGER_ITEM_LABEL,
  BURGER_LINE_WORKER_ID,
  BURGER_ORDER_PRICE,
  BURGER_ORDER_PROXIMITY,
  BURGER_PREP_DURATION_MS,
  entityYForService,
} from "./burgerConstants";

export type BurgerServiceManagerApi = {
  getEntity: (id: string) => TownEntity | undefined;
  getHuman: () => TownEntity | undefined;
  appendDialogueLine: (e: Omit<DialogueLine, "id" | "at">) => void;
  getPlacedMarkers: () => Record<string, PlacedMarkerRecord> | null;
  bump: () => void;
};

export type PlaceBurgerOrderResult =
  | { ok: true; kind: "queued" | "started" }
  | { ok: false; reason: "inactive" | "too_far" | "no_cash" | "no_human" };

/**
 * Owns the burger `ServiceBusinessBurgerRuntime` FSM: orders, money, worker walk chain.
 * Deterministic; dialogue lines are optional flavor.
 */
export class BurgerServiceController {
  constructor(
    public readonly runtime: ServiceBusinessBurgerRuntime,
    private readonly api: BurgerServiceManagerApi
  ) {}

  getDebugSnapshot() {
    const w = this.api.getEntity(BURGER_LINE_WORKER_ID);
    return {
      businessId: this.runtime.id,
      activeOrderId: this.runtime.activeOrderId,
      workerPhase: this.runtime.workerPhase,
      prepCompleteAt: this.runtime.prepCompleteAt,
      cashInDrawer: this.runtime.cashInDrawer,
      orderCount: this.runtime.orders.length,
      orders: this.runtime.orders.map((o) => ({ ...o })),
      primaryWorker: w
        ? { id: w.id, name: w.displayName, money: w.money, lock: w.serviceMovementLock }
        : null,
      humanMoney: this.api.getHuman()?.money,
      spotsOk: this.runtime.spots,
    };
  }

  tryPlayerPlaceBurgerOrder(): PlaceBurgerOrderResult {
    const human = this.api.getHuman();
    if (!human) return { ok: false, reason: "no_human" };
    if (human.money < BURGER_ORDER_PRICE) return { ok: false, reason: "no_cash" };

    const mk = this.api.getPlacedMarkers();
    if (!mk || !mk[this.runtime.spots.orderSpotKey]) return { ok: false, reason: "inactive" };
    const orderPos = mk[this.runtime.spots.orderSpotKey]!.position;
    const d = distance2D(
      { x: human.position.x, z: human.position.z },
      { x: orderPos.x, z: orderPos.z }
    );
    if (d > BURGER_ORDER_PROXIMITY) return { ok: false, reason: "too_far" };

    this.enqueueOrder(human.id);
    this.api.appendDialogueLine({
      speakerId: HUMAN_ENTITY_ID,
      speakerName: human.displayName,
      text: `Orders a ${BURGER_ITEM_LABEL.toLowerCase()}. ($${BURGER_ORDER_PRICE})`,
    });
    this.api.bump();

    if (
      this.runtime.workerPhase === "idle_counter" &&
      !this.runtime.activeOrderId
    ) {
      this.promoteNextQueuedToActive();
      this.api.bump();
      return { ok: true, kind: "started" };
    }
    this.api.appendDialogueLine({
      speakerId: BURGER_LINE_WORKER_ID,
      speakerName: "Maya",
      text: "I've got you — on the list after the grill clears.",
    });
    return { ok: true, kind: "queued" };
  }

  onWorkerArrivedAtMarker(
    worker: TownEntity,
    currentLocationId: string | null,
    now: number
  ): void {
    if (worker.id !== BURGER_LINE_WORKER_ID) return;
    const mk = this.api.getPlacedMarkers();
    if (!mk) return;
    const { spots } = this.runtime;

    if (
      this.runtime.workerPhase === "to_kitchen" &&
      currentLocationId === spots.kitchenSpotKey
    ) {
      this.runtime.workerPhase = "at_prep";
      this.runtime.prepCompleteAt = now + BURGER_PREP_DURATION_MS;
      const o = this.findOrder(this.runtime.activeOrderId);
      if (o) o.state = "preparing";
      this.api.appendDialogueLine({
        speakerId: worker.id,
        speakerName: worker.displayName,
        text: "On the flattop — one minute hot.",
      });
      this.api.bump();
      return;
    }

    if (
      this.runtime.workerPhase === "to_handoff" &&
      currentLocationId === spots.handoffSpotKey
    ) {
      this.handlePaymentAtHandoff(worker, now);
      return;
    }

    if (
      this.runtime.workerPhase === "return_counter" &&
      currentLocationId === spots.counterSpotKey
    ) {
      this.runtime.workerPhase = "idle_counter";
      worker.serviceMovementLock = false;
      this.runtime.activeOrderId = null;
      this.api.appendDialogueLine({
        speakerId: worker.id,
        speakerName: worker.displayName,
        text: "Back on the window — who’s next?",
      });
      this.api.bump();
      this.promoteNextQueuedToActive();
      return;
    }
  }

  tick(now: number): void {
    const w = this.api.getEntity(BURGER_LINE_WORKER_ID);
    if (!w) return;
    if (this.runtime.workerPhase !== "at_prep") return;
    if (!this.runtime.prepCompleteAt || now < this.runtime.prepCompleteAt) return;
    this.runtime.prepCompleteAt = null;
    const mk = this.api.getPlacedMarkers();
    if (!mk) return;
    const o = this.findOrder(this.runtime.activeOrderId);
    if (o) o.state = "ready_for_handoff";
    this.runtime.workerPhase = "to_handoff";
    const p = this.pickPos(mk, this.runtime.spots.handoffSpotKey);
    startWalkTo(w, p, this.runtime.spots.handoffSpotKey);
    w.serviceMovementLock = true;
    this.api.appendDialogueLine({
      speakerId: w.id,
      speakerName: w.displayName,
      text: "Up — handoff for the order.",
    });
    this.api.bump();
  }

  private promoteNextQueuedToActive() {
    const w = this.api.getEntity(BURGER_LINE_WORKER_ID);
    if (!w) return;
    if (this.runtime.activeOrderId) return;
    if (this.runtime.workerPhase !== "idle_counter") return;
    const next = this.runtime.orders.find((o) => o.state === "queued");
    if (!next) return;
    this.runtime.activeOrderId = next.id;
    next.state = "accepted";
    this.runtime.workerPhase = "to_kitchen";
    const mk = this.api.getPlacedMarkers();
    if (!mk) return;
    const p = this.pickPos(mk, this.runtime.spots.kitchenSpotKey);
    startWalkTo(w, p, this.runtime.spots.kitchenSpotKey);
    w.serviceMovementLock = true;
    this.api.appendDialogueLine({
      speakerId: w.id,
      speakerName: w.displayName,
      text: "Heard you — one classic, coming through back.",
    });
    this.api.bump();
  }

  private enqueueOrder(customerId: string): ServiceOrder {
    const id = `ord_${this.runtime.id}_${this.runtime.nextOrderSerial++}`;
    const o: ServiceOrder = {
      id,
      businessId: this.runtime.id,
      customerId,
      workerId: BURGER_LINE_WORKER_ID,
      state: "queued",
      itemLabel: BURGER_ITEM_LABEL,
      price: BURGER_ORDER_PRICE,
      createdAt: Date.now(),
      readyAt: null,
    };
    this.runtime.orders.push(o);
    return o;
  }

  private findOrder(id: string | null): ServiceOrder | undefined {
    if (!id) return undefined;
    return this.runtime.orders.find((o) => o.id === id);
  }

  private handlePaymentAtHandoff(worker: TownEntity, now: number) {
    const o = this.findOrder(this.runtime.activeOrderId);
    const human = this.api.getHuman();
    if (!o || !human || o.customerId !== human.id) {
      this.api.appendDialogueLine({
        speakerId: worker.id,
        speakerName: worker.displayName,
        text: "Counter's mixed up — lemme fix that order.",
      });
      this.api.bump();
      return;
    }
    if (o.state === "completed") return;
    human.money -= BURGER_ORDER_PRICE;
    this.runtime.cashInDrawer += BURGER_ORDER_PRICE;
    o.state = "completed";
    o.readyAt = o.readyAt ?? now;
    this.api.appendDialogueLine({
      speakerId: human.id,
      speakerName: human.displayName,
      text: `Pays $${BURGER_ORDER_PRICE}. (Balance: $${human.money.toFixed(0)})`,
    });
    this.api.appendDialogueLine({
      speakerId: worker.id,
      speakerName: worker.displayName,
      text: "Thanks — food's hot, napkins on the side.",
    });

    this.runtime.workerPhase = "return_counter";
    const mk = this.api.getPlacedMarkers();
    if (mk) {
      const p = this.pickPos(mk, this.runtime.spots.counterSpotKey);
      startWalkTo(worker, p, this.runtime.spots.counterSpotKey);
    }
    this.api.bump();
  }

  private pickPos(
    mk: Record<string, PlacedMarkerRecord>,
    key: string
  ): { x: number; y: number; z: number } {
    const m = mk[key];
    if (!m) {
      return { x: 0, y: entityYForService(), z: 0 };
    }
    return {
      x: m.position.x,
      y: entityYForService(),
      z: m.position.z,
    };
  }
}
