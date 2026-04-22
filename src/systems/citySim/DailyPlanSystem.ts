import type { LocationRegistry } from "./LocationRegistry";
import type {
  CityLocation,
  CityLocationKind,
  DailyDesire,
  DailyNeed,
  DailyObjective,
  DailyPlan,
  TownEntity,
} from "./types";
import {
  nudgeLifeAfterSocialExchange,
  onSimCalendarNewDay,
} from "./LifeArcSystem";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function uniqueKinds(locations: CityLocation[]): CityLocationKind[] {
  const s = new Set<CityLocationKind>();
  for (const l of locations) s.add(l.type);
  return [...s];
}

function headlineFor(entity: TownEntity): string {
  const t = entity.traits.join(" ").toLowerCase();
  const mood = entity.mood;
  const role = entity.role;
  const roots = entity.lifeAdaptation;
  const d = entity.townDaysLived;
  if (d >= 2 && roots > 0.35) {
    return pick([
      `Live today as a ${role} with open eyes, not a script`,
      `Let the next beat of the town find me in my work as a ${role}`,
    ]);
  }
  if (t.includes("curious"))
    return pick([
      "Notice one new detail about the town today",
      `Test a small hunch in my own way — for now, as ${role} here`,
    ]);
  if (t.includes("chatty"))
    return pick([
      "Swap a few honest stories with someone",
      "Keep the social channel open — lightly",
    ]);
  if (t.includes("tired") || mood === "nervous")
    return pick([
      "Keep the day humane: small wins only",
      "Protect my bandwidth and still show up",
    ]);
  if (t.includes("skeptical") || mood === "annoyed")
    return pick([
      "Stay sharp without picking fights",
      "Prove the day can be calm on purpose",
    ]);
  if (t.includes("direct"))
    return pick([
      "Line up tasks and clear at least one properly",
      "Make the day feel deliberate, not drift",
    ]);
  return pick([
    "Make today feel intentional, not accidental",
    `Choose my next move in the town, same as the job I gave myself: ${role}`,
  ]);
}

function buildNeeds(): DailyNeed[] {
  return [
    {
      kind: "rest",
      label: "Rest enough to be sharp walking these streets",
      satisfaction: 0.5 + Math.random() * 0.25,
    },
    {
      kind: "food",
      label: "Stay fed in this town — body first",
      satisfaction: 0.45 + Math.random() * 0.3,
    },
    {
      kind: "connection",
      label: "Cross paths with someone real — not a ghost",
      satisfaction: 0.4 + Math.random() * 0.25,
    },
    {
      kind: "purpose",
      label: "Keep my own story moving here",
      satisfaction: 0.35 + Math.random() * 0.2,
    },
  ];
}

function buildDesires(entity: TownEntity): DailyDesire[] {
  const t = entity.traits.join(" ").toLowerCase();
  const pool: DailyDesire[] = [];

  pool.push({
    id: `d_${entity.id}_air`,
    label: pick([
      "Steal a quiet moment outdoors",
      "Feel open air on my face at least once",
    ]),
    salience: 0.35 + Math.random() * 0.25,
  });

  if (t.includes("curious")) {
    pool.push({
      id: `d_${entity.id}_novel`,
      label: "Stumble into something I did not plan",
      salience: 0.45 + Math.random() * 0.2,
    });
  } else if (t.includes("chatty")) {
    pool.push({
      id: `d_${entity.id}_social`,
      label: "Laugh once with a familiar voice",
      salience: 0.5 + Math.random() * 0.2,
    });
  } else {
    pool.push({
      id: `d_${entity.id}_order`,
      label: pick([
        "Keep my errands from sprawling",
        "Finish one loop without doubling back",
      ]),
      salience: 0.35 + Math.random() * 0.2,
    });
  }

  return pool.slice(0, 2);
}

function makeObjectiveFromLocation(loc: CityLocation): DailyObjective {
  const verb = pick(["Spend time near", "Check in at", "Pass through"]);
  return {
    id: `obj_${loc.id}_${Math.random().toString(36).slice(2, 7)}`,
    summary: `${verb} ${loc.label}`,
    targetLocationId: loc.id,
    targetKinds: null,
    progress: 0,
    completed: false,
  };
}

function makeObjectiveFromKinds(
  kinds: CityLocationKind[],
  labelHint: string
): DailyObjective {
  return {
    id: `obj_k_${kinds.join("_")}_${Math.random().toString(36).slice(2, 7)}`,
    summary: labelHint,
    targetLocationId: null,
    targetKinds: [...kinds],
    progress: 0,
    completed: false,
  };
}

export function recomputeArcProgress(plan: DailyPlan): void {
  if (!plan.objectives.length) {
    plan.arcProgress = 0;
    return;
  }
  const sum = plan.objectives.reduce((a, o) => a + o.progress, 0);
  plan.arcProgress = sum / plan.objectives.length;
  const purpose = plan.needs.find((n) => n.kind === "purpose");
  if (purpose) {
    const target = 0.2 + 0.8 * plan.arcProgress;
    purpose.satisfaction = clamp01(
      purpose.satisfaction * 0.92 + target * 0.08
    );
  }
}

export function generateDailyPlan(
  entity: TownEntity,
  locations: LocationRegistry
): DailyPlan {
  const all = locations.all();
  const dayKey = localDayKey();
  const objectives: DailyObjective[] = [];

  if (all.length >= 1) {
    const a = pick(all);
    objectives.push(makeObjectiveFromLocation(a));
    const rest = all.filter((l) => l.id !== a.id);
    if (rest.length) {
      const b = pick(rest);
      objectives.push(makeObjectiveFromLocation(b));
    }
  }

  const kinds = uniqueKinds(all);
  const socialish = (["park", "social", "outdoor"] as const).filter((k) =>
    kinds.includes(k)
  ) as CityLocationKind[];
  if (socialish.length && objectives.length < 3) {
    objectives.push(
      makeObjectiveFromKinds(
        socialish,
        pick([
          "Spend part of the day somewhere open or social",
          "Let the town breathe around me",
        ])
      )
    );
  }

  if (entity.homeMarkerKey && locations.get(entity.homeMarkerKey)) {
    const hid = entity.homeMarkerKey;
    if (!objectives.some((o) => o.targetLocationId === hid)) {
      objectives.push({
        id: `obj_home_${Math.random().toString(36).slice(2, 7)}`,
        summary: "Touch base at home once",
        targetLocationId: hid,
        targetKinds: null,
        progress: 0,
        completed: false,
      });
    }
  }

  const deduped: DailyObjective[] = [];
  const seenLoc = new Set<string>();
  for (const o of objectives) {
    if (o.targetLocationId) {
      if (seenLoc.has(o.targetLocationId)) continue;
      seenLoc.add(o.targetLocationId);
    }
    deduped.push(o);
    if (deduped.length >= 4) break;
  }

  if (!deduped.length && all.length) {
    deduped.push(makeObjectiveFromLocation(all[0]!));
  }

  const plan: DailyPlan = {
    dayKey,
    headline: headlineFor(entity),
    objectives: deduped,
    needs: buildNeeds(),
    desires: buildDesires(entity),
    arcProgress: 0,
    fulfillment: 0.08 + Math.random() * 0.08,
    completionsToday: 0,
  };
  for (const o of plan.objectives) {
    if (o.completed) o.progress = 1;
  }
  recomputeArcProgress(plan);
  return plan;
}

export function ensureDailyPlanForDay(
  entity: TownEntity,
  locations: LocationRegistry
): void {
  if (entity.controllerType !== "ai") return;
  const key = localDayKey();
  if (entity.dailyPlan?.dayKey === key) return;
  onSimCalendarNewDay(
    entity,
    entity.dailyPlan?.dayKey ?? null,
    key
  );
  entity.dailyPlan = generateDailyPlan(entity, locations);
  entity.currentGoal = entity.dailyPlan.headline;
}

export function tickDailyNeeds(
  entity: TownEntity,
  deltaSec: number,
  locations: LocationRegistry
): void {
  const plan = entity.dailyPlan;
  if (!plan || entity.controllerType !== "ai") return;

  const walking = entity.currentAction === "walking";
  const locId = entity.currentLocationId;
  const loc = locId ? locations.get(locId) : undefined;
  const atHome = !!(
    entity.homeMarkerKey &&
    locId === entity.homeMarkerKey
  );
  const atStore = loc?.type === "store";

  for (const need of plan.needs) {
    if (need.kind === "rest") {
      if (atHome && !walking) {
        need.satisfaction = clamp01(
          need.satisfaction + deltaSec * (0.06 + entity.energy * 0.04)
        );
      } else {
        const drain = walking ? 0.028 : 0.012;
        need.satisfaction = clamp01(need.satisfaction - drain * deltaSec);
      }
    } else if (need.kind === "food") {
      const target = clamp01(1 - entity.hunger);
      need.satisfaction = clamp01(
        need.satisfaction + (target - need.satisfaction) * deltaSec * 0.35
      );
      if (atStore && !walking) {
        need.satisfaction = clamp01(need.satisfaction + deltaSec * 0.12);
      }
    } else if (need.kind === "connection") {
      need.satisfaction = clamp01(need.satisfaction - 0.004 * deltaSec);
    } else if (need.kind === "purpose") {
      recomputeArcProgress(plan);
    }
  }

  const fTarget =
    plan.arcProgress * 0.55 +
    plan.completionsToday * 0.12 +
    plan.needs.reduce((a, n) => a + n.satisfaction, 0) /
      Math.max(1, plan.needs.length) *
      0.33;
  plan.fulfillment = clamp01(
    plan.fulfillment + (fTarget - plan.fulfillment) * deltaSec * 0.08
  );
}

export function onNpcArrivedAtLocation(
  entity: TownEntity,
  locations: LocationRegistry
): void {
  const plan = entity.dailyPlan;
  if (!plan || entity.controllerType !== "ai") return;
  const locId = entity.currentLocationId;
  const loc = locId ? locations.get(locId) : undefined;
  const type = loc?.type;

  let anyNew = false;
  for (const obj of plan.objectives) {
    if (obj.completed) continue;
    let hit = false;
    if (obj.targetLocationId && locId === obj.targetLocationId) hit = true;
    else if (
      obj.targetKinds &&
      obj.targetKinds.length &&
      type &&
      obj.targetKinds.includes(type)
    ) {
      hit = true;
    }
    if (hit) {
      obj.progress = 1;
      obj.completed = true;
      plan.completionsToday += 1;
      plan.fulfillment = clamp01(plan.fulfillment + 0.14);
      anyNew = true;
    }
  }
  if (anyNew) {
    recomputeArcProgress(plan);
    const open = plan.objectives.find((o) => !o.completed);
    entity.currentGoal = open?.summary ?? plan.headline;
  }
}

export function onConversationEndedForDaily(
  a: TownEntity,
  b: TownEntity
): void {
  for (const e of [a, b]) {
    if (e.controllerType !== "ai" || !e.dailyPlan) continue;
    const conn = e.dailyPlan.needs.find((n) => n.kind === "connection");
    if (conn) conn.satisfaction = clamp01(conn.satisfaction + 0.22);
    e.dailyPlan.fulfillment = clamp01(e.dailyPlan.fulfillment + 0.04);
    nudgeLifeAfterSocialExchange(e);
  }
}

/** Higher = daily arc should steer this decision. */
export function dailyObjectivePull(entity: TownEntity): number {
  const plan = entity.dailyPlan;
  if (!plan || entity.controllerType !== "ai") return 0;
  const open = plan.objectives.filter((o) => !o.completed);
  if (!open.length) return 0;
  const urgency =
    1 -
    plan.needs.reduce((s, n) => s + n.satisfaction, 0) /
      Math.max(1, plan.needs.length);
  const desire = Math.max(...plan.desires.map((d) => d.salience), 0.2);
  return clamp01(0.28 + plan.arcProgress * 0.2 + urgency * 0.22 + desire * 0.15);
}

export function pickDailyPursuitLocation(
  entity: TownEntity,
  locations: LocationRegistry,
  excludeId?: string
): CityLocation | undefined {
  const plan = entity.dailyPlan;
  if (!plan) return undefined;

  const open = plan.objectives.find((o) => !o.completed);
  if (!open) return undefined;

  if (open.targetLocationId) {
    const loc = locations.get(open.targetLocationId);
    if (loc && loc.id !== excludeId) return loc;
  }
  if (open.targetKinds?.length) {
    return locations.randomByKinds(open.targetKinds, excludeId);
  }
  return undefined;
}

export function formatNeedsLine(plan: DailyPlan): string {
  return plan.needs
    .map((n) => `${n.label}: ${Math.round(n.satisfaction * 100)}%`)
    .join(" · ");
}

export function formatDesiresLine(plan: DailyPlan): string {
  return plan.desires.map((d) => d.label).join(" · ");
}
