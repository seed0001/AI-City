/**
 * Player↔NPC: one LLM call = one NPC reply (player input comes from the game, not the model).
 * NPC↔NPC multi-line ticks live in conversationStructured.ts.
 */

import type { MemorySystem } from "./MemorySystem";
import type { LocationRegistry } from "./LocationRegistry";
import type { TownEntity } from "./types";
import { ensureRelationship, applyConversationOutcome } from "./SocialSystem";
import { getMergedAgentSlice } from "./settings/aiSimSettings";

export type PlayerNpcScenePacket = {
  scene: { locationLabel: string; locationId: string | null };
  npc: {
    id: string;
    displayName: string;
    role: string;
    traits: string[];
    mood: string;
    goal: string;
    personaNotes?: string;
  };
  playerResident: {
    id: string;
    displayName: string;
    /** In-world only — not "human operator". */
    apparentRole: string;
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

  return {
    scene: {
      locationLabel: loc?.label ?? "town",
      locationId: loc?.id ?? null,
    },
    npc: {
      id: npc.id,
      displayName: pn.displayName,
      role: pn.role,
      traits: [...pn.traits],
      mood: pn.mood,
      goal: npc.currentGoal,
      ...(pn.personaNotes ? { personaNotes: pn.personaNotes } : {}),
    },
    playerResident: {
      id: player.id,
      displayName: pl.displayName,
      apparentRole: pl.role,
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
