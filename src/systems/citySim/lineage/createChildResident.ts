import type { CitySimManager } from "../CitySimManager";
import type { TownEntity } from "../types";
import { ENTITY_Y } from "../constants";

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function pick<T>(arr: T[], fallback: T): T {
  if (!arr.length) return fallback;
  return arr[Math.floor(Math.random() * arr.length)] ?? fallback;
}

function blendTraits(a: TownEntity, b: TownEntity): string[] {
  const pool = unique([...a.traits, ...b.traits]);
  const selected = pool.sort(() => Math.random() - 0.5).slice(0, 4);
  if (Math.random() < 0.35) selected.push("adaptable");
  return unique(selected);
}

function deriveChildDisplayName(a: TownEntity, b: TownEntity): string {
  const left = a.displayName.replace(/[^A-Za-z]/g, "").slice(0, 3) || "Res";
  const right = b.displayName.replace(/[^A-Za-z]/g, "").slice(-3) || "Kid";
  return `${left}${right}-${Math.floor(Math.random() * 90 + 10)}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function createChildResident(
  manager: CitySimManager,
  parentAId: string,
  parentBId: string
): TownEntity | null {
  const a = manager.getEntity(parentAId);
  const b = manager.getEntity(parentBId);
  if (!a || !b) return null;

  const locs = manager.locations.all();
  if (!locs.length) return null;
  const near = locs[0]!;
  const jitter = () => (Math.random() - 0.5) * 1.5;
  const id = `npc_child_${Math.random().toString(36).slice(2, 8)}`;

  const roleOptions = unique([
    ...a.townRoleOptions.slice(0, 3),
    ...b.townRoleOptions.slice(0, 3),
    "Young resident",
  ]);

  const child: TownEntity = {
    id,
    displayName: deriveChildDisplayName(a, b),
    gender: pick([a.gender, b.gender, "nonbinary"], "nonbinary"),
    role: pick(roleOptions, "Young resident"),
    position: { x: near.position.x + jitter(), y: ENTITY_Y, z: near.position.z + jitter() },
    rotation: 0,
    currentLocationId: near.id,
    destinationLocationId: null,
    destinationPosition: null,
    currentAction: "idle",
    mood: pick([a.mood, b.mood, "calm"], "calm"),
    hunger: clamp01((a.hunger + b.hunger) * 0.5 * 0.6),
    energy: clamp01((a.energy + b.energy) * 0.5 * 1.1),
    socialTolerance: clamp01((a.socialTolerance + b.socialTolerance) * 0.5),
    traits: blendTraits(a, b),
    relationships: {},
    memoryIds: [],
    inConversation: false,
    controllerType: "ai",
    nextDecisionAt: Date.now() + 300,
    conversationCooldownUntil: 0,
    avoidingEntityId: null,
    currentGoal: "Learn the neighborhood rhythm",
    homeMarkerKey: a.homeMarkerKey ?? b.homeMarkerKey ?? null,
    residentKind: "npc",
    controlledBy: "ai",
    knownAsHuman: false,
    dailyPlan: null,
    ttsVoiceId: pick([a.ttsVoiceId, b.ttsVoiceId], a.ttsVoiceId),
    townRoleOptions: roleOptions,
    lifeAdaptation: 0.04,
    townDaysLived: 0,
    lastSimDayKey: null,
    money: 20 + Math.floor(Math.random() * 20),
    serviceMovementLock: false,
    brainKind: "local",
    brainConnected: false,
  };

  manager.entities.add(child);
  manager.connectFamilyLink(parentAId, parentBId, child.id);
  void manager.brains.initializeEntity(child);
  void manager.brains.createChildBrainState(
    parentAId,
    parentBId,
    {
      id: child.id,
      displayName: child.displayName,
      role: child.role,
      traits: child.traits,
      mood: child.mood,
      townRoleOptions: child.townRoleOptions,
    },
    {
      mood: a.mood,
      role: a.role,
      traits: a.traits,
      lastBrainEmotion: a.lastBrainEmotion,
    },
    {
      mood: b.mood,
      role: b.role,
      traits: b.traits,
      lastBrainEmotion: b.lastBrainEmotion,
    }
  );
  manager.appendDialogueLine({
    speakerId: child.id,
    speakerName: child.displayName,
    text: "Hey... I'm new around here.",
  });
  return child;
}

