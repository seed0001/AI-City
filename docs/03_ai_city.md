# Document 3 — AI City (World + Body Layer)

This document describes the browser-side stack: the simulation core, the entity model, the systems that operate on it, the rendering layer, and the optional LAN/mobile mode. The cognition layer is referenced where it intersects the world, but everything inside the brain service is covered separately in Documents 4 and 5.

---

## 1. The TownEntity

The TownEntity is the single source of truth for "a resident." Every resident — AI, the user's avatar, a remote LAN guest, a child created at runtime — is a TownEntity. The fields in `src/systems/citySim/types.ts` are intentional and deserve enumeration in plain language.

### 1.1 Identity and presentation

- `id` — stable string identifier. Used for relationship lookups, brain bundles, network routing.
- `displayName` — the in-world name of the resident, shown in chat and HUD.
- `gender` — `"male" | "female" | "nonbinary"`. Used for pronoun coherence in dialogue. Not for controller routing.
- `role` — chosen or evolved social role in town (e.g. "Cashier", "Neighbor", "New regular"). Fed into LLM context as "this is who I am here."
- `townRoleOptions` — alternate roles this resident could plausibly take. Used by the daily plan system and by the engine layer to suggest gradual role drift.
- `traits` — array of in-world traits (e.g. "practical", "playful", "watchful"). Influences both the simulation's internal scoring and the prompt-side persona shaping.
- `ttsVoiceId` — the Edge TTS short name for this resident's voice (e.g. `en-US-AvaNeural`). Persisted via `localStorage` overrides per entity.

### 1.2 Spatial state

- `position: { x, y, z }` — 3D world position. `y` is clamped to `ENTITY_Y` for ground-level residents.
- `rotation` — Y-axis rotation in radians, used by VRM avatars to face direction of travel.
- `currentLocationId` — id of the LocationRegistry entry the resident is currently inside. May be null if outside any registered location.
- `destinationLocationId` / `destinationPosition` — set when the resident is walking somewhere.
- `currentAction` — `"idle" | "walking" | "talking" | "sitting" | "leaving"`. The render layer keys VRM animations off this.

### 1.3 Body state

- `hunger` — 0..1, increases with time, drops when the resident eats at a store.
- `energy` — 0..1, decreases with activity, restored at home.
- `socialTolerance` — 0..1, how much social load the resident can take right now.
- `mood` — `"calm" | "annoyed" | "friendly" | "nervous" | "angry"`. The simulation's coarse mood label; the engine layer holds finer-grained emotion vectors.

### 1.4 Social and conversational state

- `relationships: Record<otherId, RelationshipState>` — per-pair `{ trust, tension, familiarity, friendliness, avoid }`. Updated by the SocialSystem after every conversation.
- `inConversation` — boolean.
- `conversationId` — non-null while inConversation; points to the shared `Conversation` in `ConversationSystem`.
- `conversationLastLine` — a denormalized "Name: text" string for the last spoken line in the current conversation.
- `conversationCooldownUntil` — millisecond timestamp; suppresses re-engagement until passed.
- `avoidingEntityId` — when set, the decision system will pick destinations far from this entity.

### 1.5 Goal and plan state

- `currentGoal` — short human-readable string ("Go to the bakery", "People-watch", "Avoid a tense encounter") shown in the HUD.
- `dailyPlan` — a `DailyPlan` regenerated per local-calendar day for AI residents. See Section 7.
- `nextDecisionAt` — timestamp the DecisionSystem uses to throttle re-evaluation.

### 1.6 Engine bridge state

- `brainKind` — `"local"` (heuristic-only) or `"engine"` (talking to the Python service).
- `brainConnected` — last-known service availability for this entity.
- `lastBrainIntent`, `lastBrainEmotion`, `lastBrainConversationContext`, `lastBrainMemoryEvent` — debug-only mirrors used by the HUD.
- `decisionSource` — `"engine" | "fallback"`. Set per decision tick; visible in the debug panel.
- `conversationSource` — `"engine" | "fallback"`. Set per dialogue tick; reflects whether the line was generated with engine context.

### 1.7 Town adaptation

- `homeMarkerKey` — id of the home location for this resident.
- `lifeAdaptation` — 0..1, how rooted this resident has become here, derived from days lived, satisfied needs, and long-term memory accumulation.
- `townDaysLived` — number of in-sim local-calendar days lived.
- `lastSimDayKey` — internal bookkeeping for the `townDaysLived` counter.
- `money` — abstract currency. Used by the BurgerServiceController for pay-on-order flows. Not exposed to LLM prompts by default.
- `serviceMovementLock` — when true, autonomous movement is suppressed because a service flow (e.g. burger line worker) is driving the resident.

### 1.8 Controller and provenance

- `controllerType` — `"ai" | "human" | "autopilot"`. Strictly internal. Never shipped to LLM or to the brain service in any prompt-bearing way.
- `controlledBy` — `"ai" | "human" | "network"`. Used by the LAN layer to identify network-driven residents.
- `residentKind` — `"npc" | "resident"`.
- `knownAsHuman` — false for every resident in-world. The player's avatar is just another resident; NPCs do not address the player as a human operator.

The deliberate split between "in-world" fields (visible to dialogue and to engines) and "controller" fields (strictly internal) is a load-bearing convention. The PromptBuilder and the conversation packets explicitly project only the in-world projection.

## 2. The simulation core: CitySimManager

`CitySimManager` is one class that owns the world. Three phases of its life matter:

### 2.1 Boot

1. Construct empty registries (`EntityRegistry`, `LocationRegistry` with `[]`, `MemorySystem`).
2. Construct an empty `ConversationSystem` whose `onDialogueLine` callback points back at `appendDialogueLine` (so emitted lines flow into the chat log and trigger TTS).
3. Subscribe to `MemorySystem` events. Whenever a memory event fires for an actor whose `brainKind === "engine"`, push a sanitized `sendResidentEvent` to the brain.
4. Start the brain adapter health check loop.

### 2.2 Layout bootstrap

`enterPlayMode()` (or its variants) loads a saved layout from `townLayout/`, calls `placedMarkersToCityLocations` to convert markers into `CityLocation` records, replaces `LocationRegistry` and `ConversationSystem` (the conversation system is re-created so it always has the current registries). The seeded NPCs (`CHARACTER_SEEDS`) are spawned via `createEntityFromSeed`. The user's avatar is spawned via `createHumanEntity`. Every spawned entity is initialized with the brain via `residentBrainAdapter.initializeEntity(e)`.

### 2.3 Tick

Called every animation frame:

```
CitySimManager.tick(deltaSec, humanWorldPosition, humanRotationY)
  if !simulationEnabled: return
  apply human pose to the human entity
  for each AI entity:
    ensureDailyPlanForDay
    decay energy / increase hunger
    moveTowardDestination
      if arrived: onNpcArrivedAtLocation, burger service hook
    tickDailyNeeds
    residentBrainAdapter.updateEntity(e)  (throttled)
  burgerService.tick
  conversations.tickActiveConversations
  every ENCOUNTER_CHECK_INTERVAL_MS (~900 ms): conversations.tryRandomEncounters
  for each AI entity: runAiDecision
```

That sequence is fixed. Decisions run AFTER conversation ticking, which means a resident exiting a conversation can immediately get a fresh decision in the same tick.

## 3. MovementSystem

`MovementSystem.ts` exposes `startWalkTo(entity, position, locationId)` and `moveTowardDestination(entity, deltaSec)`.

`startWalkTo` sets `currentAction = "walking"`, stores `destinationPosition` and `destinationLocationId`, and orients the entity toward the target. `moveTowardDestination` advances the entity at a fixed walk speed (constants in `constants.ts`), updates `position`, and returns `true` on arrival. On arrival the manager sets `currentAction = "idle"`, clears destination fields, and notifies higher-level systems (DailyPlanSystem, BurgerServiceController).

VRM avatars in the renderer pick up `currentAction` and play the appropriate animation. The renderer interpolates between positions so the character does not snap.

## 4. DecisionSystem

`DecisionSystem.runAiDecision(entity, locations, allEntities, now)` is the function that decides what an AI resident does next. It runs every tick for every AI entity, but it is gated by `nextDecisionAt`, so decisions are not re-evaluated every frame.

### 4.1 The engine-first path

1. Gate checks: skip if not AI, in conversation, currently walking, service-locked, or before `nextDecisionAt`.
2. Call `residentBrainAdapter.getDecision(entity, otherIds)`. This sends the resident's snapshot to the brain service and returns either a cached decision suggestion or `null` if the service is offline / not engine-backed / has not produced a confident answer.
3. If the suggestion exists and `confidence ≥ 0.25`, switch on its `intent`:
   - `go_home` — start walking to the home marker.
   - `seek_food` — random store destination.
   - `seek_social` — random park or social location.
   - `start_conversation` — approach the suggested target (or nearest other) and stage a "talk" goal.
   - `avoid_entity` — set `avoidingEntityId`, walk to a far destination.
   - `pursue_daily_objective` — pick a target from the daily plan.
   - `reflect` / `idle` — stop and set a quiet goal.
   - `wander` — pick a random destination.
4. Set `entity.decisionSource = "engine"`, schedule the next decision tick, return.

### 4.2 The fallback heuristic

If the engine path returned no usable suggestion, the function sets `entity.decisionSource = "fallback"` and runs an in-line tree:

1. **Threat avoidance** — if a recently flagged avoidance target is too close, walk to a far destination with 70% probability and clear the avoidance flag.
2. **Tired** — if `energy < 0.28` and a home marker exists, walk home.
3. **Hungry** — if `hunger > 0.65`, walk to a random store.
4. **Social urge** — if `(1 - socialTolerance) > 0.52` or daily connection-need is below 0.34, walk to a random park or social spot.
5. **Daily objective pull** — with probability `pull * 0.88` (computed from daily-plan urgency), walk to the daily objective location.
6. **Random** — 55% wander, 25% idle, 20% sit and people-watch.

The fallback exists so the simulation never freezes. It is intentionally aggressive about producing *some* action.

## 5. ConversationSystem

`ConversationSystem.ts` runs every active conversation and starts new ones. Each in-flight conversation is a **`ConversationSession`** — a persistent arc-shaped object that owns its participants until `endSession` runs. The decision system's `inConversation` lock holds for the full arc; the session decides when to release it.

The full change record is in Doc 11; this section describes the post-session shape.

### 5.1 Encounter detection

`tryRandomEncounters(entities, now)` scans every pair, filters via `canStartConversation` (not in conversation, not on cooldown, within `TALK_RADIUS`, not avoiding each other), and scores remaining pairs:

```
score = proximity * 0.55 + bond * 0.28 + socialUrgency * 0.22
```

where `bond = (friendliness + familiarity + trust)/3 - tension*0.35`. The highest-scored pair is offered to `tryBeginPair`, which calls `createSession(a, b, now)` and attaches both residents (`inConversation = true`, `currentAction = "talking"`).

`MAX_ACTIVE_CONVERSATIONS` (in `constants.ts`) caps how many sessions can run in parallel. Beyond the cap, new encounters are deferred.

### 5.2 Session creation and budget

`createSession` builds a `ConversationSession` carrying:

- **Identity**: `id`, sorted `participants`, `locationId`, `startedAt`.
- **Arc state**: `topic`, `topicStack`, `conversationGoal`, `unresolvedQuestion`, `lastSpeakerIntent`, `lastListenerReaction`, `summarySoFar`, `commitments`.
- **Pacing**: `category`, `minTurns`, `maxTurns`, `turnIndex` (line count), `currentSpeakerId`.
- **Status**: `active` / `winding_down` / `ended`, `endReason`, `lastContinuationReason`.
- **Tone / context**: `emotionalTone` (warm/neutral/playful/tense/heavy/guarded), `relationshipContext` (trust/tension/familiarity), `recentLines` (last 8).

Budget comes from `computeConversationBudget(a, b, hints)` which picks a `ConversationCategory` (`casual` / `work` / `planning` / `emotional` / `argument` / `deep`) using opener content (the brain's `currentIntent`, the resident's `currentGoal`) and relationship state, then maps to bands per the spec:

```
casual:    minTurns 4,  maxTurns 8
work:      minTurns 4,  maxTurns 10
planning:  minTurns 6,  maxTurns 14
emotional: minTurns 8,  maxTurns 16
argument:  minTurns 8,  maxTurns 20
deep:      minTurns 10, maxTurns 24
```

Severe survival pressure (extreme hunger or fatigue) trims `minTurns` toward (but never below) a hard floor of 2. Argument-category sessions with high tension get a small `maxTurns` extension.

A "turn" is one speaker's line. The LLM is still called in 2-line batches — that is the delivery mechanism — but `turnIndex` counts individual lines, so `minTurns: 6` really means six spoken turns (= three batches).

### 5.3 Engine context fetch

When the next batch is requested, the system calls `residentBrainAdapter.awaitConversationContext(a, b.id)` and `awaitConversationContext(b, a.id)` in parallel. These return the structured engine brain context (the 7 fields: emotionalState, relationshipReasoning, currentIntent, activeGoals, driveState, selfNarrative, recentEpisodes) plus prose context lines. When the brain service is online this call is **required**, not optional, before the prompt is built.

### 5.4 Packet construction and dispatch

`buildNpcConversationScenePacket(a, b, locations, memories, session: SessionPacketState, conversationTurns, engineContexts)` builds a JSON object containing:

- The scene (location, time-of-day bucket, environment hint).
- Up to **8** recent turns of THIS conversation (anti-repetition within the thread; raised from 4 so multi-turn arcs have continuity).
- The recent spoken lines for each agent (anti-repetition across recent dialogue).
- For each agent: identity, mood, traits, current action, activity line, daily-plan slice, the engine brain context, and the recent layered memory summaries.
- **Conversation state**: `turnIndex`, `minTurns`, `maxTurns`, `category`, `status`, `emotionalTone`, `topic`, `topicStack`, `conversationGoal`, `unresolvedQuestion`, `summarySoFar`, `lastSpeakerIntent`, `lastListenerReaction`. (The legacy `turnNumber` is preserved as an alias of `turnIndex`.)
- A `scriptGuidance.engineDriven` flag, true when both agents had engine context this tick.

If Ollama is enabled, `fetchNpcNpcExchange(packet, fallback)` runs. The system prompt instructs the model that this is a **continuing multi-turn session**, never a fresh scene: do not greet unless `turnIndex == 0`, respond directly to the previous line, keep the same topic unless reason to shift, address `unresolvedQuestion`, push `conversationGoal`, and never prematurely end. The JSON contract is extended to include `nextTopic`, `conversationGoal`, `unresolvedQuestion`, `lastSpeakerIntent`, `lastListenerReaction`, `summaryDelta`, `commitments`. `sanitizeNpcResult` extracts each defensively, falling back to the stub's defaults.

If Ollama is disabled or fails, `generateStubStructuredNpcExchange(packet)` returns a session-aware structured fallback. The stub is opener-aware (turn 0 establishes topic + goal + question), mid-arc-aware (subsequent turns push the topic, surface concrete grievances or memories, propose plans, name blockers), and wind-down-aware (turns near `maxTurns` confirm or table the goal). It is category-flavored (argument lines push back; planning lines name blockers and propose phasing; emotional / deep lines surface feelings) and detects `I'll handle / cover / take` patterns as commitments.

The result is queued into `c.pendingLines` (two lines) and `c.activeBatch`. Session-arc fields (topic shift, goal, unresolvedQuestion, summaryDelta, commitments) fold into the live session in `applyArrivedBatch`. Category may upgrade (only upward in the rank ladder casual < work < planning < emotional < argument < deep) so an opener misclassified as casual gets the right budget once the topic is named.

### 5.5 Turn pumping with TTS gating

Each frame, `tickActiveConversations` pumps the session. The pump enforces the same TTS-aware turn timing as before, plus per-tick interrupt detection and the continuation policy:

```
if c.waitingForSpeech:
  if speechWaitUntil expired: release (hard fail-safe)
  else: return
if pendingLines.length and now - lastEmittedAt ≥ TURN_DELAY_MS:
  emitNextPendingLine
else if pendingLines drained:
  if separated or idle: end (separated / idle_timeout)
  if detectInterrupts: end (interrupt:<reason>)
  if !decideContinuation: end
  else: runNpcPairBatch (next batch)
```

`emitNextPendingLine`:

1. Push the line into `c.turns` AND `recordLine(session, turn)` (increments `turnIndex`, sets `currentSpeakerId`, rolls `recentLines` cap 8).
2. Update `conversationLastLine` for both speakers.
3. If this is the second of two lines: run `applyStructuredNpcExchange` (per-batch memory + relationships, feeding short-term memory), fold session-arc updates from the result into the live session (topic shifts push old onto `topicStack`, `conversationGoal`/`unresolvedQuestion` follow the result, `summaryDelta` appends to `summarySoFar`, commitments push), upgrade category if the result reveals a stronger arc, refresh `emotionalTone` and `relationshipContext`, dispatch `conversation_outcome` events to both speakers' brain bundles, and run `decideContinuation` to capture the next-step reason. If continuation says end, capture an `endAfterSpeech` closure.
4. Set `c.waitingForSpeech = true` with a hard-cap deadline.
5. Call `onDialogueLine(...)`. The host (CitySimManager) returns a Promise from `appendDialogueLine` that resolves only when the spoken audio finishes.
6. On settle, `endSpeechWait` releases the gate and any deferred end closure runs.

### 5.6 Continuation policy and interrupts

The end-of-batch tick runs **`decideContinuation(session, llmContinue)`** — the engine-wins-on-stop policy:

- `turnIndex >= maxTurns` → end (`max_turns_reached`).
- `turnIndex < minTurns` → continue (the LLM's "stop" is overridden).
- `unresolvedQuestion` non-null → continue regardless of LLM.
- Tense or heavy tone → continue up to four extra turns past `minTurns`.
- Otherwise honor the LLM signal: if it said stop, end with `llm_stop_after_min`; if it said continue, continue.

**Interrupt detection** (`detectInterrupts(participants, allEntities)`) runs every conversation tick. Conservative thresholds — only true emergencies break a session below `minTurns`:

- `hunger >= 0.92` → `interrupt:hunger`
- `energy <= 0.06` → `interrupt:fatigue`
- Avoiding-entity within 4u → `interrupt:danger`
- Daily-plan `purpose` need `<= 0.15` AND an unfinished objective → `interrupt:obligation`

Dev/player commands route through `endAllConversations(reason)`, which bypasses `minTurns` with `interrupt:dev_command`.

### 5.7 Session end and arc memory

`endSession(c, a, b, now)` is the single tear-down path. It:

1. Sets `status = "ended"`, preserves any `endReason` already set (or defaults to `natural_resolution`).
2. Writes ONE arc memory event (`type: "conversation_session"`) to both participants' local memory via `MemorySystem.add`. This is the consolidated arc summary that survives in long-term memory; per-batch writes already fed short-term.
3. Writes per-actor commitment memories (`type: "commitment"`) for each promise made during the session.
4. Applies follow-up actions (`linger` / `leave` / `goto` / `avoid`) from the last batch's action hints.
5. Sets cooldowns, clears `inConversation`, calls `scheduleNextDecision` for each AI participant.

The **`inConversation` lock** holds for the entire session — `runAiDecision` returns immediately for any entity flagged `inConversation`, so the decision system cannot pull either resident out into wandering or unrelated behavior until `endSession` runs.

### 5.8 Player ↔ NPC mode

When one participant is the user's avatar (or a network player), the system runs the single-shot reply path: it builds a `PlayerNpcScenePacket` with the NPC's engine brain context, runs Ollama (or the stub), produces one NPC reply, applies the relationship outcome, and ends the session after the audio finishes. The session object is created and torn down in one batch with `closedByPlayerFlow: true` reserved for future multi-turn extension. Multi-turn player ↔ NPC pumping is not yet wired (Doc 9 §1.7).

## 6. MemorySystem (local layered memory)

`MemorySystem.ts` is the browser-side memory store. It maintains three layers per actor:

- **Short-term**: up to 20 most recent event ids.
- **Episodic**: up to 120 event ids, stored chronologically.
- **Long-term**: up to 30 distilled records keyed by a normalized summary, with reinforcement counters and decaying salience.

When `memory.add([a, b], event)` is called, the event id is pushed into both actors' short-term and episodic indices, the event is stored globally with a 1200-entry cap, and the long-term reinforce path checks for an existing record by normalized key. If found, salience is recomputed as `clamp01(prev * 0.82 + base * 0.28)` and reinforcements increment. If new, a fresh record is added.

The full state is persisted to `localStorage` under `ai-city-memory-v2`. On reload, the state hydrates back. This is the simulation's local memory, distinct from the engine layer's per-resident memory engines (which live in the brain service).

The MemorySystem's `subscribeEvents(...)` hook fires for every memory event, and CitySimManager forwards every such event to the brain bundle of any involved actor whose `brainKind === "engine"`. This is the principal feedback channel from the world into the mind.

`memories.layeredSummariesFor(entity, { shortTermLimit, episodicLimit, longTermLimit })` returns plain-text summaries used by the conversation packets and prompt context.

## 7. SocialSystem and relationships

`SocialSystem.ts` exposes:

- `ensureRelationship(entity, otherId)` — creates a default relationship record `{ trust: 0.5, tension: 0.2, familiarity: 0.0, friendliness: 0.4, avoid: false }` if one does not exist for that pair.
- `applyConversationOutcome(a, b, trustDelta, tensionDelta, familiarityDelta)` — bumps both directions of the relationship, clamped to 0..1. Familiarity always increases on contact; trust/tension move based on the structured outcome of the exchange.

Avoidance is handled at the DecisionSystem level: when `avoid` is true, the resident is biased toward distant destinations, and `avoidingEntityId` can be set explicitly by an "avoid_entity" engine intent or by the fallback's threat-avoid branch.

## 8. DailyPlanSystem and LifeArcSystem

### 8.1 DailyPlanSystem

`DailyPlanSystem.ts` regenerates a per-day plan for every AI resident as the local calendar key changes. A `DailyPlan` contains:

- `dayKey` — local-calendar key (e.g. "2026-04-28").
- `headline` — a one-line theme for the day ("Stay close to home", "Run errands and check in", "Try something new in town").
- `objectives` — concrete `DailyObjective` entries with optional `targetLocationId`, `targetKinds`, progress, and `completed` flag.
- `needs` — four `DailyNeed` entries: `rest`, `food`, `connection`, `purpose`. Each has a `satisfaction` value (0 = urgent, 1 = satisfied) that ticks with time and is restored by relevant actions.
- `desires` — `DailyDesire` entries with `salience` (0..1). Bias destination and tone.
- `arcProgress`, `fulfillment`, `completionsToday` — aggregate progress metrics.

`tickDailyNeeds(entity, deltaSec, locations)` decays satisfaction values over time. `onNpcArrivedAtLocation(entity, locations)` and `onConversationEndedForDaily(a, b)` advance objective progress and restore the relevant need.

`pickDailyPursuitLocation(entity, locations, exclude)` is consulted by both the engine path (when intent is `pursue_daily_objective`) and the fallback heuristic (when daily-objective pull rolls high). It picks the next uncompleted objective's target, honoring `targetLocationId` first, then `targetKinds`.

### 8.2 LifeArcSystem

`LifeArcSystem.ts` builds the LLM-safe "life in town" lines for an entity:

- `survivalUrgencyLine` — body / social pressure to stay viable.
- `lifeInTownLine` — days here, growth, how they relate to the place.
- `voiceAndPersonaLine` — speaking voice (TTS short name) plus stable traits.
- `otherPossibleRolesLine` — alternative roles this resident could take.

`lifeAdaptation` is updated incrementally based on `townDaysLived`, daily-plan fulfillment, and reinforced long-term memory. The number is shown in the debug HUD and used by the prompt builder to color tone.

## 9. PromptBuilder

`PromptBuilder.buildWorldContext(self, registry, locations, memories, conversationPartnerId)` is the in-world projection used by player ↔ NPC chat and by anywhere general world context is needed. It deliberately includes only resident-perceivable facts:

- self block (display name, gender, role, mood, current action, current goal, daily plan slice, life-in-town lines, optional brain state line).
- place (location id, label).
- nearbyPeople (display name, role, distance, apparentAction).
- shortTermMemories, episodicMemories, longTermMemories.
- relationshipWithFocus (trust, tension, familiarity, friendliness — for the focused partner only).
- lastUtteranceInConversation.

`controllerType` is never included. Engine internals are never included. The function exists so prompt assembly always pulls from the same sanitized projection.

## 10. Rendering layer

### 10.1 Scene graph

`src/scene/Scene.tsx` mounts the canvas, lights, sky, GLB town map, walk control, and a list of avatars. The 3D map is loaded from `public/models/`. Lighting is driven by a day/night controller; the sky uses a procedural night material when applicable.

### 10.2 VRM avatars

NPC and player avatars are loaded with `@pixiv/three-vrm`. Each avatar:

- Reads its associated `TownEntity` from `CitySimContext`.
- Updates position smoothly toward the entity's `position`.
- Faces the direction of travel using `rotation`.
- Plays animations keyed off `currentAction` and walking/idle state.

VRMA animation files are stored under `public/models/` and loaded with `@pixiv/three-vrm-animation`.

### 10.3 First-person walk control

The user controls a single resident (the human entity). The walk control reads keyboard / pointer / mobile-touch input and updates a target position that the simulation later snaps the human entity to. Movement is intentionally lightweight; the simulation does not try to enforce physics for the human.

### 10.4 HUDs

- `LeftHud.tsx` — the chat panel (recent dialogue lines + a "stop TTS" button), plus a small AI settings drawer for TTS rate, pitch, voice override, and Ollama enable.
- `CitySimDebugPanel.tsx` — the right-side debug overlay. For each AI resident: emotion summary, current goal, last brain intent, decision source, conversation source, last memory event, memories count.
- `ResidentBrainDebugSection.tsx` — embedded in the debug panel, polls `/brains/{entityId}/debug` for engine-level detail: total engines instantiated, active engines by role, disabled engines with reasons, last decision source, expanded inventory.

### 10.5 Speech

`src/systems/citySim/speech/characterSpeech.ts` is the speech surface. `speakAiLine(speakerId, text, voiceId)` returns a `Promise<void>` that resolves only when the spoken audio fully ends — Edge TTS via the dev API, Web Speech as fallback, with a global queue so two NPC voices never overlap. The Promise also resolves on error and on a length-proportional timeout, so a broken TTS event cannot freeze the simulation. `stopAllSpeech()` cancels both layers and resets the queue.

The conversation pump passes that Promise back from `appendDialogueLine` and uses it to gate the next turn (`waitingForSpeech` flag on the `RuntimeSession`). This guarantees that lines are spoken in order without overlapping or being cut off, while still letting text appear in the chat panel immediately when the line is emitted.

## 11. LAN / shared mode

AI City supports a host-authoritative LAN mode. The components:

- `vite-plugin-lan-hub.ts` — a Vite plugin that opens a websocket hub on the dev server. Handles register/ping, host/client routing, broadcasting world snapshots, relaying client pose and chat to the host.
- `src/systems/citySim/network/protocol.ts` — strict TypeScript types for hub messages: `register`, `ping`, `clientPose`, `clientChat`, `hostSnapshot`, `welcome`, `hostStatus`, `hostToClientSnapshot`, `clientToHostPose`, `clientToHostChat`, `error`.
- `src/systems/citySim/network/LanHostBridge.tsx` — mounted only when `?mode=host`. Connects to the hub as host, owns the simulation, periodically sends `HostWorldSnapshot` snapshots (entities + dialogue tail) and forwards client pose/chat events into CitySimManager.
- `src/mobile/ThinClientApp.tsx` — the mobile thin client. Mounted only when `?mode=client`. Connects as client, renders a minimal avatar/chat surface, sends pose and chat to the host, displays world snapshots from the host.

For each connected client, the host calls `CitySimManager.upsertNetworkPlayer(clientId, displayName, position)` to spawn a network resident. That resident is a real `TownEntity` with `controlledBy = "network"`, `serviceMovementLock = true` (the host does not autonomously move it), and its own brain bundle on the brain service. When the client disconnects, `removeNetworkPlayer(clientId)` removes the entity.

The protocol is intentionally minimal: pose updates and chat lines, with a single host snapshot type for world state. Authoritative state lives only on the host. No prediction, no rollback. This is "LAN play" not "production multiplayer."

## 12. Boot modes and the landing page

`App.tsx` reads `mode` from the URL query string:

- `?mode=client` — mounts `ThinClientApp` only. No 3D town, no full HUD.
- (default / `?mode=landing` / `?mode=select`) — mounts `ModeLanding`, a simple page that lets the user pick host or client without typing query strings.
- `?mode=host` — mounts the full simulation with `LanHostBridge`.
- any other mode — mounts the full simulation without LAN bridging.

The CitySim and TownLayout providers wrap the scene and HUDs; they expose React-friendly views into the underlying singletons.

## 13. Settings and persistence

- `src/systems/citySim/settings/aiSimSettings.ts` — persists per-character persona slices, master AI enable, TTS rate/pitch, voice URI overrides, system prompt suffixes, conversation cadence tweaks. Backed by `localStorage`.
- `src/systems/citySim/ttsVoiceStorage.ts` — per-entity Edge voice overrides.
- `src/systems/citySim/townLayout/` — saved layout (placed markers) under `localStorage`. Includes a 3D editor for placing markers and a validation pass when entering play mode.
- `src/systems/citySim/MemorySystem.ts` — layered memory persistence under `ai-city-memory-v2`.

The browser side is, in this sense, completely standalone. With the brain service offline, `MemorySystem`, `DecisionSystem` (fallback), and the layered memory persistence let the town keep running. The brain service makes it richer, not functional.

## 14. Boundary conventions, restated

These rules are enforced at the boundary, not by hope:

- LLM prompts and engine bridge payloads only contain in-world fields.
- `controllerType`, engine class names, and engine method signatures never appear in prompts.
- Brain bundle state is per-resident under `state/engines/<entityId>/`. Two residents never share engine state.
- The simulation tolerates an offline brain service. The fallback heuristic and the stub dialogue keep the world alive.
- The speech layer guarantees no audio overlap and never blocks the simulation forever.

The next document (Document 4) describes the cognition library that the brain service consumes, without referencing any of the world state above.
