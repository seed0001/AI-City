import type { PersonaFile } from "./personaTypes";
import npcAdam from "./npc_adam.json";
import npcBob from "./npc_bob.json";
import npcChris from "./npc_chris.json";
import npcLuna from "./npc_luna.json";
import npcMaya from "./npc_maya.json";
import npcMina from "./npc_mina.json";
import npcOmar from "./npc_omar.json";
import npcRiver from "./npc_river.json";
import npcSarah from "./npc_sarah.json";
import npcTina from "./npc_tina.json";
import residentPlayer from "./resident_player.json";

const ALL_PERSONAS: PersonaFile[] = [
  npcAdam as PersonaFile,
  npcBob as PersonaFile,
  npcChris as PersonaFile,
  npcLuna as PersonaFile,
  npcMaya as PersonaFile,
  npcMina as PersonaFile,
  npcOmar as PersonaFile,
  npcRiver as PersonaFile,
  npcSarah as PersonaFile,
  npcTina as PersonaFile,
  residentPlayer as PersonaFile,
];

const PERSONA_BY_ID = new Map(ALL_PERSONAS.map((p) => [p.id, p] as const));

export function getAllPersonas(): readonly PersonaFile[] {
  return ALL_PERSONAS;
}

export function getPersonaById(id: string): PersonaFile | undefined {
  return PERSONA_BY_ID.get(id);
}

export function getPersonaNotesForEntity(id: string): string | undefined {
  return PERSONA_BY_ID.get(id)?.personaNotes;
}

export function getNpcPersonas(): ReadonlyArray<PersonaFile & { homeMarkerKey: string }> {
  return ALL_PERSONAS.filter(
    (p): p is PersonaFile & { homeMarkerKey: string } =>
      p.id.startsWith("npc_") && typeof p.homeMarkerKey === "string" && p.homeMarkerKey.length > 0
  );
}

