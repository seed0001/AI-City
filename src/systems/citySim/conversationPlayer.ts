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
import type { EngineBrainContext } from "./brains/residentBrainClient";

export type PlayerNpcScenePacket = {
  scene: { locationLabel: string; locationId: string | null };
  scriptGuidance: { engineDriven: boolean };
  npc: {
    id: string;
    displayName: string;
    gender: CharacterGender;
    role: string;
    traits: string[];
    mood: string;
    goal: string;
    personaNotes?: string;
    episodicMemorySummaries?: string[];
    longTermMemorySummaries?: string[];
    dailyHeadline?: string;
    dayProgressLine?: string;
    dailyNeedsLine?: string;
    dailyDesiresLine?: string;
    survivalUrgencyLine?: string;
    lifeInTownLine?: string;
    voiceAndPersonaLine?: string;
    otherPossibleRolesLine?: string;
    brainContextLine?: string;
    /** STRUCTURED engine cognition context (must dominate the prompt). */
    engineBrainContext?: EngineBrainContext;
    /** Last NPC lines spoken (anti-repetition). */
    npcRecentSpoken?: string[];
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
  episodicNpcMemories?: string[];
  longTermNpcMemories?: string[];
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
  memories: MemorySystem,
  engineCtx: {
    npc?: EngineBrainContext;
    engineDriven: boolean;
    npcRecentSpoken?: string[];
  } = { engineDriven: false }
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

  const layeredNpcMemories = memories.layeredSummariesFor(npc, {
    shortTermLimit: 3,
    episodicLimit: 6,
    longTermLimit: 5,
  });

  return {
    scene: {
      locationLabel: loc?.label ?? "town",
      locationId: loc?.id ?? null,
    },
    scriptGuidance: { engineDriven: engineCtx.engineDriven },
    npc: {
      id: npc.id,
      displayName: pn.displayName,
      gender: pn.gender,
      role: pn.role,
      traits: [...pn.traits],
      mood: pn.mood,
      goal: npc.currentGoal,
      episodicMemorySummaries: layeredNpcMemories.episodic,
      longTermMemorySummaries: layeredNpcMemories.longTerm,
      ...(pn.personaNotes ? { personaNotes: pn.personaNotes } : {}),
      ...(npc.lastBrainConversationContext
        ? { brainContextLine: npc.lastBrainConversationContext }
        : {}),
      ...(engineCtx.npc ? { engineBrainContext: engineCtx.npc } : {}),
      ...(engineCtx.npcRecentSpoken ? { npcRecentSpoken: engineCtx.npcRecentSpoken } : {}),
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
    recentNpcMemories: layeredNpcMemories.shortTerm,
    episodicNpcMemories: layeredNpcMemories.episodic,
    longTermNpcMemories: layeredNpcMemories.longTerm,
  };
}

/** Stub single NPC reply — swap for one LLM call returning JSON matching PlayerNpcReplyResult. */
export function generateStubPlayerNpcReply(
  packet: PlayerNpcScenePacket
): PlayerNpcReplyResult {
  const t = packet.relationship.tension;
  const ec = packet.npc.engineBrainContext;
  const intent = ec?.currentIntent;
  const drive = ec?.driveState;
  const ep = ec?.recentEpisodes?.[0];

  const sharp = t > 0.55;
  const baseLine = sharp
    ? `Make it quick.${drive ? ` ${drive} is on me.` : ""}`
    : `Hey — didn't expect you here.${ep ? ` Still thinking about ${ep}.` : ""}`;
  const tail = !sharp && intent ? ` ${intent}` : "";
  const line = `${baseLine}${tail}`.trim();

  return {
    npcLine: line,
    tone: sharp ? "sharp" : "neutral",
    trustDelta: sharp ? -0.02 : 0.03,
    tensionDelta: sharp ? 0.04 : -0.02,
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
