/** Simulation tuning — prototype defaults */

export const TALK_RADIUS = 4;
export const PERCEPTION_RADIUS = 12;
export const MOVE_SPEED_NPC = 3.2;
export const CONVERSATION_MIN_DURATION_MS = 2800;
export const CONVERSATION_MAX_DURATION_MS = 5200;
/** Min delay between spoken lines in the same conversation (turn-taking). */
export const TURN_DELAY_MS = 3000;
/** End if no new line is emitted for this long (stalled or silent). */
export const CONVERSATION_IDLE_TIMEOUT_MS = 52000;
/** End if participants drift farther than TALK_RADIUS * this factor. */
export const CONVERSATION_SEPARATION_MULTIPLIER = 1.32;
/** Cap on simultaneous multilateral conversations. */
export const MAX_ACTIVE_CONVERSATIONS = 6;
export const DECISION_INTERVAL_MIN_MS = 4000;
export const DECISION_INTERVAL_MAX_MS = 9000;
export const CONVERSATION_COOLDOWN_MS = 6000;
export const ENTITY_Y = 1.65;

/** Default starting cash (abstract units) for new NPCs. */
export const DEFAULT_NPC_STARTING_MONEY = 180;
/** Default for the human resident. */
export const DEFAULT_PLAYER_STARTING_MONEY = 320;
