/**
 * City simulation types. controllerType is engine-only and must never appear in AI prompts.
 */

export type Mood = "calm" | "annoyed" | "friendly" | "nervous" | "angry";

export type CurrentAction =
  | "idle"
  | "walking"
  | "talking"
  | "sitting"
  | "leaving";

/** Internal only — never serialize into PromptBuilder / LLM context */
export type ControllerType = "ai" | "human" | "autopilot";

export interface RelationshipState {
  trust: number;
  tension: number;
  familiarity: number;
  friendliness: number;
  avoid: boolean;
}

/** A single line in a continuing dialogue (NPC↔NPC or shared player↔NPC). */
export type ConversationTurn = {
  speakerId: string;
  text: string;
  timestamp: number;
};

/** One owned conversation; living state is updated by ConversationSystem. */
export type Conversation = {
  id: string;
  participants: string[];
  locationId: string;
  startedAt: number;
  lastTurnAt: number;
  turns: ConversationTurn[];
  active: boolean;
};

export interface MemoryEvent {
  id: string;
  type: string;
  timestamp: number;
  actorIds: string[];
  locationId: string | null;
  summary: string;
  emotionalImpact: number;
}

export type CityLocationKind =
  | "entry"
  | "interior"
  | "outdoor"
  | "path"
  | "home"
  | "store"
  | "park"
  | "social"
  /** Placed for businesses; not used for general NPC wandering via LocationRegistry. */
  | "service_spot"
  | "business";

export interface CityLocation {
  id: string;
  label: string;
  position: { x: number; y: number; z: number };
  type: CityLocationKind;
  interactionRadius: number;
}

export type ResidentKind = "npc" | "resident";

/** In-world social fact; used for dialogue / pronoun consistency (not controller metadata). */
export type CharacterGender = "male" | "female" | "nonbinary";

/** Intrinsic pressures for the day (0 = urgent, 1 = satisfied). */
export type DailyNeedKind = "rest" | "food" | "connection" | "purpose";

export interface DailyNeed {
  kind: DailyNeedKind;
  label: string;
  satisfaction: number;
}

/** Aspirational bias for destination / tone (generated per day). */
export interface DailyDesire {
  id: string;
  label: string;
  /** 0–1; higher desires steer decisions more often */
  salience: number;
}

export interface DailyObjective {
  id: string;
  summary: string;
  /** Exact POI to visit, if set */
  targetLocationId: string | null;
  /** Otherwise complete when standing at any of these kinds */
  targetKinds: CityLocationKind[] | null;
  /** 0–1 */
  progress: number;
  completed: boolean;
}

/** One in-world “day” arc: headline, concrete objectives, needs, desires, progress. */
export interface DailyPlan {
  dayKey: string;
  headline: string;
  objectives: DailyObjective[];
  needs: DailyNeed[];
  desires: DailyDesire[];
  /** Average progress across objectives (0–1) */
  arcProgress: number;
  /** Slow-moving sense of a day well spent (0–1) */
  fulfillment: number;
  /** How many objectives finished today */
  completionsToday: number;
}

export interface TownEntity {
  id: string;
  displayName: string;
  gender: CharacterGender;
  /** Chosen or evolved social role in town (merged with user settings in prompts). */
  role: string;
  position: { x: number; y: number; z: number };
  /** Y-axis rotation in radians */
  rotation: number;
  currentLocationId: string | null;
  destinationLocationId: string | null;
  destinationPosition: { x: number; y: number; z: number } | null;
  currentAction: CurrentAction;
  mood: Mood;
  hunger: number;
  energy: number;
  socialTolerance: number;
  traits: string[];
  /** Other entity id -> relationship */
  relationships: Record<string, RelationshipState>;
  memoryIds: string[];
  /**
   * True while in an active talk; at most one conversation per entity.
   * Use `conversationId` to look up the shared `Conversation` on ConversationSystem.
   */
  inConversation: boolean;
  /** Set when `inConversation`; cleared on end. */
  conversationId?: string;
  /**
   * Denormalized: last line in the current (or just-ended) turn-taking thread, for LLM world context.
   * Format: "Name: text"
   */
  conversationLastLine?: string;
  controllerType: ControllerType;
  /** Milliseconds timestamp until next autonomous decision */
  nextDecisionAt: number;
  /** Cooldown before starting another conversation */
  conversationCooldownUntil: number;
  /** Optional: actively avoiding another entity */
  avoidingEntityId: string | null;
  currentGoal: string;
  /** Preset marker key for this NPC's home (e.g. home_bob). */
  homeMarkerKey: string | null;
  /** NPCs treat the player as a normal resident, not as a human operator. */
  residentKind: ResidentKind;
  /** Who drives this entity in the engine (not exposed to LLM prompts). */
  controlledBy: "ai" | "human";
  /** False for all residents in-world (including the player avatar). */
  knownAsHuman: boolean;
  /** AI-only: regenerated per local calendar day */
  dailyPlan: DailyPlan | null;
  /**
   * Edge / Azure neural short name (e.g. en-US-AvaNeural) for TTS.
   * Set from character seed + optional localStorage override.
   */
  ttsVoiceId: string;
  /** Other ways they could belong here; the engine may shift `role` over time. */
  townRoleOptions: string[];
  /** 0-1: roots / adaptation to living here (from days, needs, memories). */
  lifeAdaptation: number;
  /** Number of in-sim local calendar days lived since first daily plan. */
  townDaysLived: number;
  /** @internal last calendar key used for `townDaysLived` (not for LLM) */
  lastSimDayKey: string | null;
  /**
   * Cash on hand (abstract currency units). Not exposed to LLM by default; economy layer
   * updates this for service flows (payment, later payroll, etc.).
   */
  money: number;
  /**
   * When true, autonomous `DecisionSystem` will not pick new random destinations; a service
   * or scripted flow owns movement.
   */
  serviceMovementLock: boolean;
}

export interface DialogueTurn {
  spokenText: string;
  tone: string;
  intent: string;
  reaction: string;
  suggestedNextAction: FollowUpAction;
}

export type FollowUpAction =
  | "continue"
  | "leave"
  | "goto"
  | "avoid"
  | "idle";

/**
 * Safe for LLM — no controller hints, no engine internals.
 */
export interface WorldContextPacket {
  self: {
    displayName: string;
    gender: CharacterGender;
    role: string;
    mood: Mood;
    currentAction: CurrentAction;
    currentGoal: string;
    dailyHeadline?: string;
    dayArcProgress?: number;
    dayFulfillment?: number;
    dailyNeedsLine?: string;
    dailyDesiresLine?: string;
    /** Body / social pressure to stay viable in the town. */
    survivalUrgencyLine?: string;
    /** Days here, growth, and how they relate to the place. */
    lifeInTownLine?: string;
    /** Speaking voice (Neural) + stable traits. */
    voiceAndPersonaLine?: string;
    /** Ways they could see themselves; current role is `role` above. */
    otherPossibleRolesLine?: string;
  };
  place: {
    locationId: string | null;
    label: string;
  };
  nearbyPeople: Array<{
    displayName: string;
    role: string;
    distance: number;
    apparentAction: CurrentAction;
  }>;
  memorySummaries: string[];
  relationshipWithFocus: {
    otherDisplayName: string;
    trust: number;
    tension: number;
    familiarity: number;
    friendliness: number;
  } | null;
  lastUtteranceInConversation: string | null;
}
