import type { CharacterGender, Mood, TownEntity } from "../types";
import { DEFAULT_NPC_STARTING_MONEY, DEFAULT_PLAYER_STARTING_MONEY, ENTITY_Y } from "../constants";
import { DEFAULT_NPC_TTS_VOICE } from "../speech/edgeTtsVoiceCatalog";
import { getInitialTtsVoiceId } from "../ttsVoiceStorage";
import { getNpcPersonas, getPersonaById } from "../personas/personaRegistry";

export type CharacterSeed = {
  id: string;
  displayName: string;
  gender: CharacterGender;
  role: string;
  mood: Mood;
  traits: string[];
  /** Preset marker key for this character's home */
  homeMarkerKey: string;
  /** Default Edge neural voice (`edge-tts` short name); user can override in UI */
  defaultTtsVoice: string;
  /** Ways they may come to see themselves; includes initial `role` and alternates. */
  townRoleOptions: string[];
};

export const CHARACTER_SEEDS: CharacterSeed[] = getNpcPersonas().map((p) => ({
  id: p.id,
  displayName: p.displayName,
  gender: p.gender,
  role: p.role,
  mood: p.mood,
  traits: [...p.traits],
  homeMarkerKey: p.homeMarkerKey,
  defaultTtsVoice: p.defaultTtsVoice,
  townRoleOptions: [...p.townRoleOptions],
}));

export const HUMAN_ENTITY_ID = "resident_player";
export const NETWORK_PLAYER_ID_PREFIX = "resident_net_";

export function createEntityFromSeed(
  seed: CharacterSeed,
  spawnPosition: { x: number; y: number; z: number }
): TownEntity {
  return {
    id: seed.id,
    displayName: seed.displayName,
    gender: seed.gender,
    role: seed.role,
    position: { ...spawnPosition, y: ENTITY_Y },
    rotation: 0,
    currentLocationId: seed.homeMarkerKey,
    destinationLocationId: null,
    destinationPosition: null,
    currentAction: "idle",
    mood: seed.mood,
    hunger: 0.4 + Math.random() * 0.3,
    energy: 0.5 + Math.random() * 0.3,
    socialTolerance: 0.45 + Math.random() * 0.35,
    traits: [...seed.traits],
    relationships: {},
    memoryIds: [],
    inConversation: false,
    controllerType: "ai",
    nextDecisionAt: 0,
    conversationCooldownUntil: 0,
    avoidingEntityId: null,
    currentGoal: "Settle in",
    homeMarkerKey: seed.homeMarkerKey,
    residentKind: "npc",
    controlledBy: "ai",
    knownAsHuman: false,
    dailyPlan: null,
    ttsVoiceId: getInitialTtsVoiceId(seed.id, seed.defaultTtsVoice),
    townRoleOptions: [
      ...new Set(
        [seed.role, ...seed.townRoleOptions]
          .map((r) => r.trim())
          .filter(Boolean)
      ),
    ],
    lifeAdaptation: 0.06,
    townDaysLived: 0,
    lastSimDayKey: null,
    money:
      DEFAULT_NPC_STARTING_MONEY + Math.floor(Math.random() * 40),
    serviceMovementLock: false,
    brainKind: "local",
    brainConnected: false,
    decisionSource: "fallback",
    conversationSource: "fallback",
  };
}

export function createHumanEntity(
  spawnPosition: { x: number; y: number; z: number },
  initialLocationId: string | null
): TownEntity {
  const residentPersona = getPersonaById(HUMAN_ENTITY_ID);
  return {
    id: HUMAN_ENTITY_ID,
    displayName: residentPersona?.displayName ?? "Alex",
    gender: residentPersona?.gender ?? "male",
    role: residentPersona?.role ?? "Resident",
    position: { ...spawnPosition, y: ENTITY_Y },
    rotation: 0,
    currentLocationId: initialLocationId,
    destinationLocationId: null,
    destinationPosition: null,
    currentAction: "idle",
    mood: residentPersona?.mood ?? "calm",
    hunger: 0.3,
    energy: 0.7,
    socialTolerance: 0.6,
    traits: residentPersona?.traits?.length ? [...residentPersona.traits] : ["practical", "quiet"],
    relationships: {},
    memoryIds: [],
    inConversation: false,
    controllerType: "human",
    nextDecisionAt: Number.POSITIVE_INFINITY,
    conversationCooldownUntil: 0,
    avoidingEntityId: null,
    currentGoal: "Explore the block",
    homeMarkerKey: null,
    residentKind: "resident",
    controlledBy: "human",
    knownAsHuman: false,
    dailyPlan: null,
    ttsVoiceId: residentPersona?.defaultTtsVoice ?? DEFAULT_NPC_TTS_VOICE,
    townRoleOptions:
      residentPersona?.townRoleOptions?.length
        ? [...new Set(residentPersona.townRoleOptions.map((r) => r.trim()).filter(Boolean))]
        : ["Resident", "Neighbor", "New regular"],
    lifeAdaptation: 0.05,
    townDaysLived: 0,
    lastSimDayKey: null,
    money: DEFAULT_PLAYER_STARTING_MONEY,
    serviceMovementLock: false,
    brainKind: "local",
    brainConnected: false,
    decisionSource: "fallback",
    conversationSource: "fallback",
  };
}

export function createNetworkResidentEntity(
  networkClientId: string,
  displayName: string,
  spawnPosition: { x: number; y: number; z: number },
  initialLocationId: string | null
): TownEntity {
  const base = createHumanEntity(spawnPosition, initialLocationId);
  return {
    ...base,
    id: `${NETWORK_PLAYER_ID_PREFIX}${networkClientId}`,
    displayName: displayName.trim() || "Guest",
    role: "Resident visitor",
    controllerType: "human",
    controlledBy: "network",
    nextDecisionAt: Number.POSITIVE_INFINITY,
    serviceMovementLock: true,
  };
}
