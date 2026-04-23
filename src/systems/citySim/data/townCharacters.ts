import type { CharacterGender, Mood, TownEntity } from "../types";
import { DEFAULT_NPC_STARTING_MONEY, DEFAULT_PLAYER_STARTING_MONEY, ENTITY_Y } from "../constants";
import { DEFAULT_NPC_TTS_VOICE } from "../speech/edgeTtsVoiceCatalog";
import { getInitialTtsVoiceId } from "../ttsVoiceStorage";

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

export const CHARACTER_SEEDS: CharacterSeed[] = [
  {
    id: "npc_bob",
    displayName: "Bob",
    gender: "male",
    role: "Shopkeeper",
    mood: "friendly",
    traits: ["chatty", "observant"],
    homeMarkerKey: "home_bob",
    defaultTtsVoice: "en-US-GuyNeural",
    townRoleOptions: [
      "Shopkeeper",
      "Counter confidant",
      "The one who reads the block",
    ],
  },
  {
    id: "npc_sarah",
    displayName: "Sarah",
    gender: "female",
    role: "Student",
    mood: "nervous",
    traits: ["curious", "polite"],
    homeMarkerKey: "home_sarah",
    defaultTtsVoice: "en-US-AriaNeural",
    townRoleOptions: [
      "Student",
      "Night-class hopeful",
      "Part-time at the store",
    ],
  },
  {
    id: "npc_luna",
    displayName: "Luna",
    gender: "female",
    role: "Cook",
    mood: "calm",
    traits: ["direct", "tired"],
    homeMarkerKey: "home_luna",
    defaultTtsVoice: "en-US-AvaNeural",
    townRoleOptions: [
      "Cook",
      "Kitchen lead",
      "The one who feeds the block",
    ],
  },
  {
    id: "npc_adam",
    displayName: "Adam",
    gender: "male",
    role: "Regular",
    mood: "annoyed",
    traits: ["skeptical", "quick"],
    homeMarkerKey: "home_adam",
    defaultTtsVoice: "en-US-EricNeural",
    townRoleOptions: [
      "Regular",
      "Grumbling loyalist",
      "Freelance odd-jobber",
    ],
  },
  {
    id: "npc_maya",
    displayName: "Maya",
    gender: "female",
    role: "Line cook",
    mood: "friendly",
    traits: ["fast", "focused", "early-shift"],
    homeMarkerKey: "home_maya",
    defaultTtsVoice: "en-US-JennyNeural",
    townRoleOptions: [
      "Line cook",
      "Grill lead",
      "Burger window",
    ],
  },
  {
    id: "npc_river",
    displayName: "River",
    gender: "nonbinary",
    role: "Shift lead",
    mood: "calm",
    traits: ["measured", "de-escalator", "planner"],
    homeMarkerKey: "home_river",
    defaultTtsVoice: "en-US-BrandonNeural",
    townRoleOptions: [
      "Shift lead",
      "Floor minder",
      "Closes the loop on chaos",
    ],
  },
  {
    id: "npc_tina",
    displayName: "Tina",
    gender: "female",
    role: "Nurse on days off",
    mood: "calm",
    traits: ["warm", "quiet humor"],
    homeMarkerKey: "home_tina",
    defaultTtsVoice: "en-US-ElizabethNeural",
    townRoleOptions: [
      "Neighbor",
      "Night shifter on pause",
    ],
  },
  {
    id: "npc_omar",
    displayName: "Omar",
    gender: "male",
    role: "Electrician",
    mood: "friendly",
    traits: ["jokes on purpose", "early riser"],
    homeMarkerKey: "home_omar",
    defaultTtsVoice: "en-US-RogerNeural",
    townRoleOptions: [
      "Contractor in town",
      "Weekend tinkerer",
    ],
  },
  {
    id: "npc_mina",
    displayName: "Mina",
    gender: "female",
    role: "Librarian",
    mood: "nervous",
    traits: ["bookish", "apologetic"],
    homeMarkerKey: "home_mina",
    defaultTtsVoice: "en-US-EmmaNeural",
    townRoleOptions: [
      "Librarian",
      "Stashes novels",
    ],
  },
  {
    id: "npc_chris",
    displayName: "Chris",
    gender: "male",
    role: "Cyclist",
    mood: "annoyed",
    traits: ["wiry", "honest", "caffeine"],
    homeMarkerKey: "home_chris",
    defaultTtsVoice: "en-US-ChristopherNeural",
    townRoleOptions: [
      "Courier habits",
      "Goes everywhere by bike",
    ],
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
  };
}

export function createHumanEntity(
  spawnPosition: { x: number; y: number; z: number },
  initialLocationId: string | null
): TownEntity {
  return {
    id: HUMAN_ENTITY_ID,
    displayName: "Alex",
    gender: "male",
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
    ttsVoiceId: DEFAULT_NPC_TTS_VOICE,
    townRoleOptions: ["Resident", "Neighbor", "New regular"],
    lifeAdaptation: 0.05,
    townDaysLived: 0,
    lastSimDayKey: null,
    money: DEFAULT_PLAYER_STARTING_MONEY,
    serviceMovementLock: false,
  };
}
