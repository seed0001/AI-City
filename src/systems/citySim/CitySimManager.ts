import {
  CHARACTER_SEEDS,
  createEntityFromSeed,
  createHumanEntity,
  HUMAN_ENTITY_ID,
} from "./data/townCharacters";
import { placedMarkersToCityLocations } from "./townLayout/markerToLocations";
import type { SavedTownLayout } from "./townLayout/types";
import { EntityRegistry } from "./EntityRegistry";
import { LocationRegistry } from "./LocationRegistry";
import { MemorySystem } from "./MemorySystem";
import { ConversationSystem } from "./ConversationSystem";
import { moveTowardDestination } from "./MovementSystem";
import { runAiDecision, scheduleNextDecision } from "./DecisionSystem";
import type { CityLocation, TownEntity } from "./types";
import { ENTITY_Y } from "./constants";
import type { DialogueLine } from "./dialogueTypes";
import { speakAiLine } from "./speech/characterSpeech";
import { saveTtsVoiceOverride } from "./ttsVoiceStorage";
import {
  ensureDailyPlanForDay,
  onConversationEndedForDaily,
  onNpcArrivedAtLocation,
  tickDailyNeeds,
} from "./DailyPlanSystem";

const ENCOUNTER_CHECK_INTERVAL_MS = 900;

export class CitySimManager {
  readonly entities = new EntityRegistry();
  readonly memories = new MemorySystem();
  /** Replaced when simulation boots from a saved marker layout. */
  locations: LocationRegistry;
  conversations: ConversationSystem;
  /** When false, CitySimLoop does not advance AI / encounters. */
  simulationEnabled = false;

  /** Set from React (CitySimProvider) so async Ollama replies bump UI. */
  uiBump: () => void = () => {};

  /** Rolling log for the left chat panel (NPC lines + optional player typing). */
  dialogueLog: DialogueLine[] = [];

  private encounterAcc = 0;

  /** Append a line; AI speakers get TTS (Edge TTS API in dev, else Web Speech). */
  appendDialogueLine(entry: Omit<DialogueLine, "id" | "at">): void {
    const line: DialogueLine = {
      id: `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      at: Date.now(),
      speakerId: entry.speakerId,
      speakerName: entry.speakerName,
      text: entry.text,
    };
    this.dialogueLog.push(line);
    if (this.dialogueLog.length > 120) this.dialogueLog.shift();
    if (entry.speakerId !== HUMAN_ENTITY_ID) {
      const ent = this.entities.get(entry.speakerId);
      speakAiLine(entry.speakerId, entry.text, ent?.ttsVoiceId);
    }
    this.uiBump();
  }

  private makeConversationSystem(): ConversationSystem {
    return new ConversationSystem(
      this.memories,
      this.locations,
      () => this.entities.all(),
      () => this.uiBump(),
      (e) => this.appendDialogueLine(e),
      (a, b) => onConversationEndedForDaily(a, b)
    );
  }

  constructor() {
    this.locations = new LocationRegistry([]);
    this.conversations = this.makeConversationSystem();
  }

  /** Swap destination graph (marker-derived) and rebuild conversation helper. */
  setLocations(locations: CityLocation[]): void {
    this.locations = new LocationRegistry(locations);
    this.conversations = this.makeConversationSystem();
  }

  /** Persisted in localStorage — Edge neural short name (e.g. en-US-AvaNeural). */
  setNpcTtsVoice(entityId: string, voiceId: string): void {
    const e = this.entities.get(entityId);
    if (!e || e.controllerType !== "ai") return;
    e.ttsVoiceId = voiceId;
    saveTtsVoiceOverride(entityId, voiceId);
    this.uiBump();
  }

  /** Layout editor: no running sim, no NPCs. */
  enterLayoutMode(): void {
    this.simulationEnabled = false;
    this.entities.clear();
  }

  /**
   * Full sim bootstrap: NPCs at homes, player near town center POI, registry = placed markers.
   */
  bootstrapFromSavedLayout(layout: SavedTownLayout): void {
    const locs = placedMarkersToCityLocations(layout.markers);
    this.setLocations(locs);
    this.entities.clear();

    const jitter = () => (Math.random() - 0.5) * 1.2;

    for (const seed of CHARACTER_SEEDS) {
      const home = layout.markers[seed.homeMarkerKey];
      if (!home) continue;
      const pos = {
        x: home.position.x + jitter(),
        y: ENTITY_Y,
        z: home.position.z + jitter(),
      };
      const e = createEntityFromSeed(seed, pos);
      e.currentLocationId = seed.homeMarkerKey;
      this.entities.add(e);
    }

    const store = layout.markers["store_main"];
    const square = layout.markers["square_main"];
    const humanPlaced = square ?? store;
    if (humanPlaced) {
      const p = {
        x: humanPlaced.position.x + jitter() * 0.5,
        y: ENTITY_Y,
        z: humanPlaced.position.z + jitter() * 0.5,
      };
      this.entities.add(createHumanEntity(p, humanPlaced.key));
    } else if (locs[0]) {
      const p = { ...locs[0].position };
      this.entities.add(createHumanEntity(p, locs[0].id));
    }

    const now = Date.now();
    for (const e of this.entities.aiEntities()) {
      ensureDailyPlanForDay(e, this.locations);
      scheduleNextDecision(e, now);
    }
    this.simulationEnabled = true;
  }

  /** Call from useFrame. deltaSec is seconds (Three.js delta). */
  tick(
    deltaSec: number,
    humanWorldPosition: {
      x: number;
      y: number;
      z: number;
    } | null,
    humanRotationY: number
  ): void {
    if (!this.simulationEnabled) return;

    const now = Date.now();
    const deltaMs = deltaSec * 1000;

    const human = this.entities.get(HUMAN_ENTITY_ID);
    if (human && humanWorldPosition) {
      human.position.x = humanWorldPosition.x;
      human.position.y = humanWorldPosition.y;
      human.position.z = humanWorldPosition.z;
      human.rotation = humanRotationY;
      const nearest = this.locations.all().reduce<{ id: string; d: number } | null>(
        (best, loc) => {
          const dx = loc.position.x - human.position.x;
          const dz = loc.position.z - human.position.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (!best || d < best.d) return { id: loc.id, d };
          return best;
        },
        null
      );
      if (nearest && nearest.d < 6) human.currentLocationId = nearest.id;
    }

    const list = this.entities.all();

    for (const e of list) {
      if (e.controllerType === "ai") {
        ensureDailyPlanForDay(e, this.locations);
        e.energy = Math.max(0, e.energy - deltaSec * 0.012);
        e.hunger = Math.min(1, e.hunger + deltaSec * 0.008);
        const arrived = moveTowardDestination(e, deltaSec);
        if (arrived) onNpcArrivedAtLocation(e, this.locations);
        tickDailyNeeds(e, deltaSec, this.locations);
      }
    }

    this.conversations.tickActiveConversations(list, now);

    this.encounterAcc += deltaMs;
    if (this.encounterAcc >= ENCOUNTER_CHECK_INTERVAL_MS) {
      this.encounterAcc = 0;
      this.conversations.tryRandomEncounters(list, now);
    }

    for (const e of this.entities.aiEntities()) {
      runAiDecision(e, this.locations, list, now);
    }
  }

  getHuman(): TownEntity | undefined {
    return this.entities.get(HUMAN_ENTITY_ID);
  }

  snapshot(): { entities: TownEntity[]; tick: number } {
    return {
      entities: JSON.parse(
        JSON.stringify(this.entities.all())
      ) as TownEntity[],
      tick: Date.now(),
    };
  }
}
