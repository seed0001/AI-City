import type { CharacterGender, Mood } from "../types";

export type PersonaFile = {
  id: string;
  displayName: string;
  gender: CharacterGender;
  role: string;
  mood: Mood;
  traits: string[];
  /**
   * Preset marker key for homes. Null for non-NPC residents, like the player avatar.
   */
  homeMarkerKey: string | null;
  /**
   * Default neural voice for this resident. Runtime settings can override this.
   */
  defaultTtsVoice: string;
  /**
   * Ways they may come to see themselves over time.
   */
  townRoleOptions: string[];
  /**
   * Stable identity notes used as baseline persona context for prompts.
   */
  personaNotes: string;
  values: string[];
  speakingStyle: string[];
  boundaries: string[];
};

