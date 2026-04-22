/**
 * Player↔NPC: one LLM call = one NPC reply (player input comes from the game, not the model).
 * NPC↔NPC multi-line ticks live in conversationStructured.ts.
 */

import type { MemorySystem } from "./MemorySystem";
import type { LocationRegistry } from "./LocationRegistry";
import type { CharacterGender, TownEntity } from "./types";
import { ensureRelationship, applyConversationOutcome } from "./SocialSystem";
import { getMergedAgentSlice } from "./settings/aiSimSettings";
import { formatDesiresLine, formatNeedsLine } from "./DailyPlanSystem";
import { buildLlmLifeFields } from "./LifeArcSystem";

export type PlayerNpcScenePacket = {
  scene: { locationLabel: string; locationId: string | null };
  npc: {
    id: string;
    displayName: string;
    gender: CharacterGender;
    role: string;
    traits: string[];
    mood: string;
    goal: string;
    personaNotes?: string;
    dailyHeadline?: string;
    dayProgressLine?: string;
    dailyNeedsLine?: string;
    dailyDesiresLine?: string;
    survivalUrgencyLine?: string;
    lifeInTownLine?: string;
    voiceAndPersonaLine?: string;
    otherPossibleRolesLine?: string;
  };
  playerResident: {
    id: string;
    displayName: string;
    gender: CharacterGender;
    /** In-world only — not "human operator". */
    apparentRole: string;
    survivalUrgencyLine?: string;
    lifeInTownLine?: string;
    voiceAndPersonaLine?: string;
    otherPossibleRolesLine?: string;
  };
  relationship: { trust: number; tension: number };
  recentNpcMemories: string[];
};

export type PlayerNpcReplyResult = {
  npcLine: string;
  tone: "warm" | "neutral" | "sharp";
  trustDelta: number;
  tensionDelta: number;
  memorySummary: string;
};

export function buildPlayerNpcScenePacket(
  player: TownEntity,
  npc: TownEntity,
  locations: LocationRegistry,
  memories: MemorySystem
): PlayerNpcScenePacket {
  const loc =
    (player.currentLocationId
      ? locations.get(player.currentLocationId)
      : undefined) ?? locations.all()[0];
  const r = ensureRelationship(npc, player.id);
  const pn = getMergedAgentSlice(npc);
  const pl = getMergedAgentSlice(player);

  const plan = npc.dailyPlan;
  const lifeNpc = buildLlmLifeFields(npc);
  const lifePl = buildLlmLifeFields(player);
  const dailyExtra =
    plan && npc.controllerType === "ai"
      ? (() => {
          const total = plan.objectives.length;
          const done = plan.objectives.filter((o) => o.completed).length;
          return {
            dailyHeadline: plan.headline,
            dayProgressLine: `${done}/${total} objectives · arc ${(plan.arcProgress * 100).toFixed(0)}% · fulfillment ${(plan.fulfillment * 100).toFixed(0)}%`,
            dailyNeedsLine: formatNeedsLine(plan),
            dailyDesiresLine: formatDesiresLine(plan),
          };
        })()
      : {};

  return {
    scene: {
      locationLabel: loc?.label ?? "town",
      locationId: loc?.id ?? null,
    },
    npc: {
      id: npc.id,
      displayName: pn.displayName,
      gender: pn.gender,
      role: pn.role,
      traits: [...pn.traits],
      mood: pn.mood,
      goal: npc.currentGoal,
      ...(pn.personaNotes ? { personaNotes: pn.personaNotes } : {}),
      ...lifeNpc,
      ...dailyExtra,
    },
    playerResident: {
      id: player.id,
      displayName: pl.displayName,
      gender: pl.gender,
      apparentRole: pl.role,
      ...lifePl,
    },
    relationship: { trust: r.trust, tension: r.tension },
    recentNpcMemories: memories.recentFor(npc, 3).map((m) => m.summary),
  };
}

/** Stub single NPC reply — swap for one LLM call returning JSON matching PlayerNpcReplyResult. */
export function generateStubPlayerNpcReply(
  packet: PlayerNpcScenePacket
): PlayerNpcReplyResult {
  const t = packet.relationship.tension;
  const line =
    t > 0.6
      ? "Make it quick."
      : "Hey — didn't expect you here.";

  return {
    npcLine: line,
    tone: t > 0.55 ? "sharp" : "neutral",
    trustDelta: t > 0.55 ? -0.02 : 0.03,
    tensionDelta: t > 0.55 ? 0.04 : -0.02,
    memorySummary: `${packet.npc.displayName} spoke briefly with ${packet.playerResident.displayName} near ${packet.scene.locationLabel}.`,
  };
}

export function applyPlayerNpcReply(
  result: PlayerNpcReplyResult,
  player: TownEntity,
  npc: TownEntity,
  memory: MemorySystem,
  locationId: string | null
): void {
  applyConversationOutcome(
    npc,
    player,
    result.trustDelta,
    result.tensionDelta,
    0.03
  );
  memory.add([player, npc], {
    type: "conversation",
    locationId,
    summary: result.memorySummary,
    emotionalImpact: result.tensionDelta > 0 ? -0.1 : 0.08,
  });
}
