import type { FollowUpAction, Mood } from "./types";

/**
 * Follow-up inference after a structured exchange tick.
 * Primary dialogue generation lives in:
 * - conversationStructured.ts (NPC↔NPC, one JSON result per tick)
 * - conversationPlayer.ts (player↔NPC, one NPC reply per call)
 */

export function inferFollowUp(
  tension: number,
  mood: Mood,
  suggested: FollowUpAction
): FollowUpAction {
  if (suggested === "leave" || suggested === "avoid") return suggested;
  if (tension > 0.75) return "avoid";
  if (tension > 0.55 || mood === "angry") return "leave";
  if (Math.random() < 0.35) return "goto";
  return Math.random() < 0.5 ? "idle" : "continue";
}
