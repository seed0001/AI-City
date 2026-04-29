import {
  CHARACTER_SEEDS,
  createEntityFromSeed,
  createHumanEntity,
  HUMAN_ENTITY_ID,
  createNetworkResidentEntity,
  NETWORK_PLAYER_ID_PREFIX,
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
import type { PlacedMarkerRecord } from "./townLayout/types";
import { tryBuildBurgerRuntimeFromLayout } from "./service/buildBurgerRuntimeFromLayout";
import { BURGER_LINE_WORKER_ID } from "./service/burgerConstants";
import { BurgerServiceController, type PlaceBurgerOrderResult } from "./service/burgerServiceController";
import { buildPlayerNpcScenePacket, applyPlayerNpcReply, generateStubPlayerNpcReply } from "./conversationPlayer";
import { fetchPlayerNpcReply } from "./llm/ollamaDialogue";
import { isOllamaDialogueEnabled } from "./llm/ollamaConfig";
import { residentBrainAdapter } from "./brains/ResidentBrainAdapter";
import { createChildResident } from "./lineage/createChildResident";

const ENCOUNTER_CHECK_INTERVAL_MS = 900;
const PLAYER_CHAT_NPC_RADIUS = 9;

export class CitySimManager {
  readonly entities = new EntityRegistry();
  readonly memories = new MemorySystem();
  /** Replaced when simulation boots from a saved marker layout. */
  locations: LocationRegistry;
  conversations: ConversationSystem;
  /** When false, CitySimLoop does not advance AI / encounters. */
  simulationEnabled = false;
  /**
   * Copy of the last bootstrapped layout’s markers (includes `business_spot` keys
   * that are not in `CityLocation` navigation).
   */
  private placedMarkers: Record<string, PlacedMarkerRecord> | null = null;
  /** First food-counter service slice; null if required burger markers are not placed. */
  burgerService: BurgerServiceController | null = null;

  /** Set from React (CitySimProvider) so async Ollama replies bump UI. */
  uiBump: () => void = () => {};

  /** Rolling log for the left chat panel (NPC lines + optional player typing). */
  dialogueLog: DialogueLine[] = [];

  private encounterAcc = 0;
  readonly brains = residentBrainAdapter;

  /**
   * Append a line; AI speakers get TTS (Edge TTS API in dev, else Web Speech).
   *
   * The text is pushed to the chat log and the UI bump fires immediately so
   * the user always sees the line right away. The returned promise resolves
   * only when the spoken audio finishes (or fails / times out) so the
   * conversation pump can wait before advancing turns.
   */
  appendDialogueLine(entry: Omit<DialogueLine, "id" | "at">): Promise<void> {
    const line: DialogueLine = {
      id: `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      at: Date.now(),
      speakerId: entry.speakerId,
      speakerName: entry.speakerName,
      text: entry.text,
    };
    this.dialogueLog.push(line);
    if (this.dialogueLog.length > 120) this.dialogueLog.shift();
    this.uiBump();
    if (entry.speakerId === HUMAN_ENTITY_ID) {
      return Promise.resolve();
    }
    const ent = this.entities.get(entry.speakerId);
    return speakAiLine(entry.speakerId, entry.text, ent?.ttsVoiceId);
  }

  private updateEntityCurrentLocation(entity: TownEntity): void {
    const nearest = this.locations.all().reduce<{ id: string; d: number } | null>(
      (best, loc) => {
        const dx = loc.position.x - entity.position.x;
        const dz = loc.position.z - entity.position.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (!best || d < best.d) return { id: loc.id, d };
        return best;
      },
      null
    );
    if (nearest && nearest.d < 6) entity.currentLocationId = nearest.id;
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
    this.memories.subscribeEvents((ev, actors) => {
      for (const actor of actors) {
        if (actor.brainKind !== "engine") continue;
        void this.brains.sendResidentEvent(actor, {
          actorId: actor.id,
          participants: ev.actorIds,
          locationId: ev.locationId,
          eventType: ev.type,
          summary: ev.summary,
          emotionalImpact: ev.emotionalImpact,
          timestamp: ev.timestamp,
        });
      }
    });
    void this.brains.refreshHealth();
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
    this.placedMarkers = null;
    this.burgerService = null;
    this.entities.clear();
    this.brains.clearAll();
  }

  /**
   * Full sim bootstrap: NPCs at homes, player near town center POI, registry = placed markers.
   */
  bootstrapFromSavedLayout(layout: SavedTownLayout): void {
    this.placedMarkers = { ...layout.markers };
    this.burgerService = null;
    const locs = placedMarkersToCityLocations(layout.markers);
    this.setLocations(locs);
    this.entities.clear();
    this.brains.clearAll();

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

    const br = tryBuildBurgerRuntimeFromLayout(layout.markers);
    if (br) {
      this.burgerService = new BurgerServiceController(br, {
        getEntity: (id) => this.entities.get(id),
        getHuman: () => this.getHuman(),
        appendDialogueLine: (entry) => this.appendDialogueLine(entry),
        getPlacedMarkers: () => this.placedMarkers,
        bump: this.uiBump,
      });
    }

    const maya = this.entities.get(BURGER_LINE_WORKER_ID);
    const counterPlaced = layout.markers["burger_worker_counter_spot"];
    if (maya && this.burgerService && counterPlaced) {
      maya.position = {
        x: counterPlaced.position.x,
        y: ENTITY_Y,
        z: counterPlaced.position.z,
      };
      maya.currentLocationId = "burger_worker_counter_spot";
      maya.destinationPosition = null;
      maya.destinationLocationId = null;
      maya.currentAction = "idle";
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

    this.memories.hydrateEntityMemoryIds(this.entities.all());
    for (const e of this.entities.all()) {
      if (e.controlledBy === "ai" || e.controlledBy === "network") {
        void this.brains.initializeEntity(e);
      } else {
        e.brainKind = "local";
      }
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
      this.updateEntityCurrentLocation(human);
    }

    const list = this.entities.all();

    for (const e of list) {
      if (e.controllerType === "ai") {
        ensureDailyPlanForDay(e, this.locations);
        e.energy = Math.max(0, e.energy - deltaSec * 0.012);
        e.hunger = Math.min(1, e.hunger + deltaSec * 0.008);
        const arrived = moveTowardDestination(e, deltaSec);
        if (arrived) {
          onNpcArrivedAtLocation(e, this.locations);
          this.burgerService?.onWorkerArrivedAtMarker(
            e,
            e.currentLocationId,
            now
          );
        }
        tickDailyNeeds(e, deltaSec, this.locations);
        void this.brains.updateEntity(e);
      }
    }

    this.burgerService?.tick(now);

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

  getEntity(id: string): TownEntity | undefined {
    return this.entities.get(id);
  }

  getNetworkEntityId(clientId: string): string {
    return `${NETWORK_PLAYER_ID_PREFIX}${clientId}`;
  }

  upsertNetworkPlayer(
    clientId: string,
    displayName: string,
    initialPosition?: { x: number; y: number; z: number }
  ): TownEntity {
    const id = this.getNetworkEntityId(clientId);
    const existing = this.entities.get(id);
    if (existing) {
      existing.displayName = displayName.trim() || existing.displayName;
      return existing;
    }
    const fallback = this.getHuman()?.position ?? this.locations.all()[0]?.position ?? {
      x: 0,
      y: ENTITY_Y,
      z: 2,
    };
    const spawn = initialPosition
      ? { x: initialPosition.x, y: initialPosition.y, z: initialPosition.z }
      : { ...fallback };
    const e = createNetworkResidentEntity(
      clientId,
      displayName,
      { ...spawn, y: ENTITY_Y },
      null
    );
    this.updateEntityCurrentLocation(e);
    this.entities.add(e);
    void this.brains.initializeEntity(e);
    this.uiBump();
    return e;
  }

  removeNetworkPlayer(clientId: string): void {
    const id = this.getNetworkEntityId(clientId);
    const e = this.entities.get(id);
    if (!e) return;
    this.entities.remove(id);
    this.brains.evictEntity(id);
    this.memories.forgetEntity(id);
    this.uiBump();
  }

  applyNetworkPlayerPose(
    clientId: string,
    pose: {
      position: { x: number; y: number; z: number };
      rotationY: number;
    }
  ): void {
    const id = this.getNetworkEntityId(clientId);
    const e = this.entities.get(id);
    if (!e) return;
    e.position.x = pose.position.x;
    e.position.y = pose.position.y;
    e.position.z = pose.position.z;
    e.rotation = pose.rotationY;
    e.currentAction = "walking";
    e.destinationPosition = null;
    e.destinationLocationId = null;
    this.updateEntityCurrentLocation(e);
  }

  private getNearestNpcToPlayer(player: TownEntity): TownEntity | null {
    let best: TownEntity | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const e of this.entities.aiEntities()) {
      const dx = e.position.x - player.position.x;
      const dz = e.position.z - player.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return bestD <= PLAYER_CHAT_NPC_RADIUS ? best : null;
  }

  async submitPlayerChat(playerId: string, text: string): Promise<{ ok: boolean; reason?: string }> {
    const line = text.trim();
    if (!line) return { ok: false, reason: "empty" };
    const player = this.entities.get(playerId);
    if (!player) return { ok: false, reason: "no_player" };
    const npc = this.getNearestNpcToPlayer(player);
    if (!npc) return { ok: false, reason: "no_npc_nearby" };

    this.appendDialogueLine({
      speakerId: player.id,
      speakerName: player.displayName,
      text: line,
    });

    const packet = buildPlayerNpcScenePacket(
      player,
      npc,
      this.locations,
      this.memories
    );
    const fallback = generateStubPlayerNpcReply(packet);
    const result =
      isOllamaDialogueEnabled()
        ? await fetchPlayerNpcReply(packet, fallback)
        : fallback;

    applyPlayerNpcReply(
      result,
      player,
      npc,
      this.memories,
      player.currentLocationId
    );
    this.appendDialogueLine({
      speakerId: npc.id,
      speakerName: npc.displayName,
      text: result.npcLine,
    });
    return { ok: true };
  }

  tryPlayerPlaceBurgerOrder(): PlaceBurgerOrderResult {
    if (!this.burgerService) {
      return { ok: false, reason: "inactive" };
    }
    return this.burgerService.tryPlayerPlaceBurgerOrder();
  }

  connectFamilyLink(parentAId: string, parentBId: string, childId: string): void {
    const a = this.entities.get(parentAId);
    const b = this.entities.get(parentBId);
    const child = this.entities.get(childId);
    if (!a || !b || !child) return;
    a.relationships[childId] = {
      trust: 0.75,
      tension: 0.06,
      familiarity: 0.85,
      friendliness: 0.76,
      avoid: false,
    };
    b.relationships[childId] = {
      trust: 0.75,
      tension: 0.06,
      familiarity: 0.85,
      friendliness: 0.76,
      avoid: false,
    };
    child.relationships[parentAId] = {
      trust: 0.72,
      tension: 0.08,
      familiarity: 0.82,
      friendliness: 0.74,
      avoid: false,
    };
    child.relationships[parentBId] = {
      trust: 0.72,
      tension: 0.08,
      familiarity: 0.82,
      friendliness: 0.74,
      avoid: false,
    };
  }

  createChildResidentFromParents(parentAId: string, parentBId: string): TownEntity | null {
    const child = createChildResident(this, parentAId, parentBId);
    if (child) this.uiBump();
    return child;
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
