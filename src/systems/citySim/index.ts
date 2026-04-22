export { CitySimProvider, useCitySimContext } from "./CitySimContext";
export { useCitySim } from "./hooks/useCitySim";
export { CitySimManager } from "./CitySimManager";
export { buildWorldContext, worldContextToPromptJson } from "./PromptBuilder";
export type {
  CharacterGender,
  TownEntity,
  WorldContextPacket,
  MemoryEvent,
  DailyPlan,
  DailyObjective,
  DailyNeed,
  DailyDesire,
} from "./types";
export { HUMAN_ENTITY_ID } from "./data/townCharacters";
export {
  EDGE_TTS_VOICE_OPTIONS,
  DEFAULT_NPC_TTS_VOICE,
  resolveEdgeVoiceId,
} from "./speech/characterSpeech";
