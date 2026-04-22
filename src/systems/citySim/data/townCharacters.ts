import type { Mood, TownEntity } from "../types";
import { ENTITY_Y } from "../constants";
import { DEFAULT_NPC_TTS_VOICE } from "../speech/edgeTtsVoiceCatalog";
import { getInitialTtsVoiceId } from "../ttsVoiceStorage";

export type CharacterSeed = {
  id: string;
  displayName: string;
  role: string;
  mood: Mood;
  traits: string[];
  /** Preset marker key for this character's home */
  homeMarkerKey: string;
  /** Default Edge neural voice (`edge-tts` short name); user can override in UI */
  defaultTtsVoice: string;
};

export const CHARACTER_SEEDS: CharacterSeed[] = [
  {
    id: "npc_bob",
    displayName: "Bob",
    role: "Shopkeeper",
    mood: "friendly",
    traits: ["chatty", "observant"],
    homeMarkerKey: "home_bob",
    defaultTtsVoice: "en-US-GuyNeural",
  },
  {
    id: "npc_sarah",
    displayName: "Sarah",
    role: "Student",
    mood: "nervous",
    traits: ["curious", "polite"],
    homeMarkerKey: "home_sarah",
    defaultTtsVoice: "en-US-AriaNeural",
  },
  {
    id: "npc_luna",
    displayName: "Luna",
    role: "Cook",
    mood: "calm",
    traits: ["direct", "tired"],
    homeMarkerKey: "home_luna",
    defaultTtsVoice: "en-US-AvaNeural",
  },
  {
    id: "npc_adam",
    displayName: "Adam",
    role: "Regular",
    mood: "annoyed",
    traits: ["skeptical", "quick"],
    homeMarkerKey: "home_adam",
    defaultTtsVoice: "en-US-EricNeural",
  },
];

export const HUMAN_ENTITY_ID = "resident_player";

export function createEntityFromSeed(
  seed: CharacterSeed,
  spawnPosition: { x: number; y: number; z: number }
): TownEntity {
  return {
    id: seed.id,
    displayName: seed.displayName,
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
    conversation: null,
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
  };
}

export function createHumanEntity(
  spawnPosition: { x: number; y: number; z: number },
  initialLocationId: string | null
): TownEntity {
  return {
    id: HUMAN_ENTITY_ID,
    displayName: "Alex",
    role: "Resident",
    position: { ...spawnPosition, y: ENTITY_Y },
    rotation: 0,
    currentLocationId: initialLocationId,
    destinationLocationId: null,
    destinationPosition: null,
    currentAction: "idle",
    mood: "calm",
    hunger: 0.3,
    energy: 0.7,
    socialTolerance: 0.6,
    traits: ["practical", "quiet"],
    relationships: {},
    memoryIds: [],
    conversation: null,
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
    ttsVoiceId: DEFAULT_NPC_TTS_VOICE,
  };
}
