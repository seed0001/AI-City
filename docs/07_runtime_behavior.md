# Document 7 — Current Runtime Behavior

This document describes what actually happens when AI City is running. It walks a single simulation tick, traces a real decision and a real conversation, follows memory and event flow through the system, and ends with what a user sees and what the current rough edges are.

It is descriptive, not aspirational. It reflects the state of the code at the time of writing.

---

## 1. A single simulation tick

The browser frame loop calls `CitySimManager.tick(deltaSec, humanWorldPosition, humanRotationY)` every animation frame. `deltaSec` is the elapsed time since the last frame in seconds (typically 0.016 to 0.033 depending on framerate).

A single tick, in order, is:

1. **Guard.** If `simulationEnabled === false`, return immediately. The simulation is paused while the user is in the layout editor, on the landing page, or before any layout has been bootstrapped.

2. **Apply human pose.** The user's avatar (`HUMAN_ENTITY_ID`) has its position copied from the walk control's reported world position; rotation is set from the walk control's reported Y rotation. Then `updateEntityCurrentLocation` runs to detect whether the human entered or left a registered location.

3. **Iterate AI residents.** For each entity with `controllerType === "ai"`:
   - `ensureDailyPlanForDay(entity, locations)` — checks the local-calendar key. If it changed, regenerates the resident's `DailyPlan` for the new day, picks a fresh headline, regenerates objectives, resets needs to defaults.
   - `entity.energy = max(0, entity.energy - deltaSec * 0.012)` — energy decays linearly with time.
   - `entity.hunger = min(1, entity.hunger + deltaSec * 0.008)` — hunger rises linearly with time.
   - `moveTowardDestination(entity, deltaSec)` — if the entity has a destination, advance position toward it. Returns `true` on arrival.
   - On arrival: `onNpcArrivedAtLocation(entity, locations)` and `burgerService.onWorkerArrivedAtMarker(entity, currentLocationId, now)`. The first updates daily-plan progress when the arrived-at location matches an objective. The second drives the burger restaurant service flow.
   - `tickDailyNeeds(entity, deltaSec, locations)` — decays `rest`, `food`, `connection`, `purpose` need satisfactions with time, restores them when the resident is currently at the satisfying location.
   - `residentBrainAdapter.updateEntity(entity)` — fires a throttled HTTP `POST /brains/update` if the per-entity throttle has elapsed. The brain bundle ticks across all phases. This call is asynchronous; the world does not wait for it. The next tick may arrive before the HTTP response. The bridge stores the latest response on the entity for HUD purposes.

4. **Burger service tick.** `burgerService.tick(now)` advances the line at the burger counter, processes orders, dispatches workers, etc. This is a service-layer slice that uses the same `TownEntity` and `LocationRegistry` data structures.

5. **Conversation pump.** `conversations.tickActiveConversations(list, now)` walks every active `ConversationSession` (a persistent multi-turn arc — see Doc 11) and pumps its turns:
   - If `c.waitingForSpeech === true`, the pump checks `c.speechWaitUntil`. If the deadline has passed (TTS hung or errored), the gate is released. Otherwise, the session is skipped this tick.
   - If `c.pendingLines.length > 0` and `now - c.lastEmittedAt >= TURN_DELAY_MS`, the pump calls `emitNextPendingLine(c, now)`. This emits one line, increments the session's `turnIndex`, sets `waitingForSpeech = true`, and the host's speech promise gates the next line.
   - If pending lines have drained, the pump runs the per-tick interrupt check (`detectInterrupts`) and the continuation policy (`decideContinuation`). On a hard stop (separated, idle timeout, interrupt fired, or continuation says end) the session ends with a typed `endReason`. Otherwise it requests another 2-line batch from the LLM (or the stub).
   - The decision system's `inConversation` lock holds across all of this — a session keeps both participants attached until `endSession` runs.

6. **Encounter check.** Every `ENCOUNTER_CHECK_INTERVAL_MS` (~900 ms) accumulator overflow, `conversations.tryRandomEncounters(list, now)` runs. It scans every pair, filters via `canStartConversation`, scores remaining pairs, and offers the highest-scored pair to `tryBeginPair(a, b, now)`. At most `MAX_ACTIVE_CONVERSATIONS` run at once.

7. **Decision pump.** For each entity with `controllerType === "ai"`:
   - `runAiDecision(entity, locations, list, now)` runs the decision tree (engine-first, fallback heuristic). Document 3 Section 4 details this.

That sequence is fixed. No randomness, no priority queue, no event bus. Same order, every frame.

---

## 2. How a single decision is made

Take resident "Bob" at idle in the park, no current goal, low energy, midday.

### 2.1 The engine path

1. `runAiDecision(Bob, ...)` runs. Gates pass: he is AI, not in conversation, not walking, not service-locked, and his `nextDecisionAt` deadline has elapsed.
2. The function calls `residentBrainAdapter.getDecision(Bob, otherIds)`. The adapter checks its per-entity cache. If a cached suggestion is fresh (younger than 4.5 seconds) it returns it; otherwise it fires a `POST /brains/decision` and waits for the next tick to consume the response.
3. Suppose the cache returns:

   ```json
   {
     "intent": "go_home",
     "confidence": 0.41,
     "targetEntityId": null,
     "rationale": "drive=rest pressure (0.6); rhythm=midday-afternoon",
     "source": "full_brain_synthesis",
     "contributors": ["behavior.drive_model_seed.drive_model_seed", "bias.world_state_pressure"],
     "contributingEngines": [
       { "engineKey": "behavior.drive_model_seed.drive_model_seed",
         "role": "CONTROL", "method": "typed:get_active_drive",
         "weight": 9.80, "sourceBonus": 1.4 },
       { "engineKey": "bias.world_state_pressure",
         "role": "CONTROL", "method": "snapshot",
         "weight": 1.72, "sourceBonus": 1.0 }
     ]
   }
   ```

   The `contributingEngines` array shows that two sources voted for `go_home`: the drive-model engine (which decided "rest pressure" was the active drive) and the world-state pressure bias (which read `energy=0.22 < 0.28` from the snapshot). The combined weight (9.80 + 1.72 = 11.52) outpaced any other intent.
4. The switch matches `case "go_home"`. Bob's `homeMarkerKey` is `"home_bob"`; the LocationRegistry has it.
5. `entity.currentGoal = "Rest at home"`. `startWalkTo(Bob, home.position, home.id)` orients Bob and starts the walk.
6. `entity.decisionSource = "engine"`. `scheduleNextDecision(Bob, now)` schedules another decision in 4..8 seconds.

The next several ticks are walking ticks. Each tick advances Bob's position toward the home marker. On arrival, `currentAction` flips to `"idle"`, the daily-plan system marks any matching objective progressed, and Bob's `socialTolerance` and `energy` will start to recover (the daily-need tick handles this).

### 2.2 The fallback path

Imagine the brain service is offline. The bridge's `getDecision` returns `null`. The engine path is skipped.

1. `entity.decisionSource = "fallback"`.
2. Threat avoid: Bob's `avoidingEntityId` is null, branch skipped.
3. Tired: `entity.energy = 0.22 < 0.28`, and `homeMarkerKey === "home_bob"` exists. Branch fires: `currentGoal = "Rest at home"`, `startWalkTo` to home, return.

The resident behaves identically in this case. The fallback heuristic is intentionally aggressive about producing some action when the engine path declines or is unavailable.

The branches diverge when the engine's preferred intent does not align with the heuristic's preferred intent. With the engine on, Bob's drive model might prefer "seek_social" because he hasn't talked to anyone today even though he's tired; the engine wins. With the engine off, the heuristic always picks "go home" first when energy is below threshold.

---

## 3. How a conversation actually works

Take resident Bob and resident Mina, both at the park, within 5 meters of each other, neither in conversation, neither on cooldown.

### 3.1 Encounter

The encounter check runs (every ~900 ms). The scanner enumerates every pair:

```
proximity = 1 - clamp(dist / TALK_RADIUS, 0, 1)
bond = (friendliness + familiarity + trust) / 3 - tension * 0.35
socialUrgency = (1 - bothSocialTolerance) / 2
score = proximity * 0.55 + bond * 0.28 + socialUrgency * 0.22
```

Bob–Mina is the highest-scored eligible pair. `tryBeginPair(Bob, Mina, now)` is called.

### 3.2 Conversation start (session creation)

`tryBeginPair`:

1. Calls `createSession(Bob, Mina, now)`. This runs `computeConversationBudget(Bob, Mina, hints)` where `hints.openerText` is built from each NPC's `lastBrainIntent` and `currentGoal`. The result is `{ category, minTurns, maxTurns }`. Suppose Bob's intent is "catch up after yesterday's tension" — that contains no planning/work/emotional/deep keywords, and tension is moderate (0.18), so the inferred category is `casual` with bands `{ minTurns: 4, maxTurns: 8 }`.
2. Builds a `ConversationSession`: `id`, sorted `participants`, `locationId: park_central`, `startedAt: now`, `turns: []`, `turnIndex: 0`, `currentSpeakerId: null`, `topic: null`, `topicStack: []`, `conversationGoal: null`, `unresolvedQuestion: null`, `summarySoFar: ""`, `commitments: []`, `status: "active"`, `endReason: null`, `lastContinuationReason: "session opened"`, `emotionalTone` (computed from category + max tension + moods → here `neutral` or `warm`), `relationshipContext` (avg trust, max tension, max familiarity), `pendingLines: []`, `activeBatch: null`, `waitingForSpeech: false`, `speechWaitUntil: 0`, `canScheduleMore: true`.
3. Calls `attachEntity` for both: `Bob.inConversation = true`, `Bob.conversationId = c.id`, similarly for Mina. Sets `currentAction = "talking"` for both. The decision system's lock now holds for the entire session.
4. Triggers `runNpcPairBatch(c, Bob, Mina)` to request the first 2-line batch.

### 3.3 Engine context fetch

`runNpcPairBatch` runs:

1. Checks `residentBrainAdapter.isConnected()`. Suppose it is connected.
2. `Promise.all([adapter.awaitConversationContext(Bob, Mina.id), adapter.awaitConversationContext(Mina, Bob.id)])` runs. Each call:
   - Checks the conversation context cache for that entity. If it has a fresh entry (younger than 1.5 seconds), uses it.
   - Otherwise, fires `POST /brains/conversation-context` with a 6 second timeout. Stores the response in the cache.
   - Returns `null` if the service is offline or fails. Otherwise returns the structured response.
3. Suppose both returned successfully. `Bob.conversationSource = "engine"`, `Mina.conversationSource = "engine"`.

The structured response for Bob (representative shape, post-expansion):

```json
{
  "contextLines": [
    "Mood: calm, anxiety light.",
    "Recently with Mina: warm exchange; trust slightly up.",
    "Currently wanting to: catch up after yesterday's tension.",
    "Active goals: stay close to neighbors.",
    "Drive: connection.",
    "Self: practical, watchful, friendly.",
    "Recent episodes: brief greeting at the bakery yesterday."
  ],
  "moodLine": "Mood: calm, anxiety light.",
  "intentionLine": "Currently wanting to: catch up after yesterday's tension.",
  "memoryLine": "Recent episodes: brief greeting at the bakery yesterday.",
  "emotionSummary": "trust 0.55, anxiety 0.18, joy 0.12",
  "engineBrainContext": {
    "emotionalState": "trust 0.55, anxiety 0.18, joy 0.12",
    "relationshipReasoning": "Mina is a familiar neighbor; warm exchange yesterday.",
    "currentIntent": "catch up after yesterday's tension",
    "activeGoals": "stay close to neighbors",
    "driveState": "connection",
    "selfNarrative": "practical, watchful, friendly",
    "recentEpisodes": ["brief greeting at the bakery", "shared a bench at the park"],
    "extendedContext": [
      { "engineKey": "emotion.mental_health_beast.mental_health_engine_beast",
        "className": "MentalHealthEngineBeast", "role": "EMOTION",
        "summary": "depression=0.04, mania=0.00, ptsd=0.00, withdrawal=0.02",
        "relevance": 18 },
      { "engineKey": "memory.memory_reconciliation_gramps.memory_reconciliation_engine_gramps",
        "className": "MemoryReconciliationEngineGramps", "role": "MEMORY",
        "summary": "reconciliation_active=0.00, onboarding_active=0.00",
        "relevance": 17 },
      { "engineKey": "personality.personality_seed.personality_seed",
        "className": "PersonalitySeed", "role": "PERSONALITY",
        "summary": "patience=0.70, curiosity_level=0.50, verbosity=0.50",
        "relevance": 16 }
    ]
  },
  "extendedContext": [ /* same content, flat for HUD */ ],
  "contextSources": [
    { "engineKey": "memory.relational_memory_system.relational_memory_system",
      "field": "relationshipReasoning", "role": "CORE" },
    { "engineKey": "utility.intent_system.intent_system",
      "field": "currentIntent", "role": "CORE" }
  ]
}
```

The 7 core fields are unchanged from before the expansion — they remain the LLM prompt spine. `extendedContext` is the new parallel block: up to 8 ranked engine summaries surfacing the wider engine state, available to the HUD and to richer prompt experiments. `contextSources` makes every prompt-shaping signal traceable to a specific engine.

### 3.4 Packet construction

`buildNpcConversationScenePacket(a, b, locations, memories, sessionState, conversationTurns, engineContexts)` constructs the JSON the LLM (or stub) will see. The `sessionState` argument (a `SessionPacketState` snapshot) carries everything the prompt needs to keep the arc continuous:

```ts
{ turnIndex, minTurns, maxTurns, lastTopic, topicStack, category, status,
  emotionalTone, conversationGoal, unresolvedQuestion, summarySoFar,
  lastSpeakerIntent, lastListenerReaction }
```

The packet itself contains:

- Scene block (location label, time-of-day bucket, environment hint).
- Up to **8** recent turns of THIS session (raised from 4 so multi-turn arcs have continuity).
- `agentARecentSpoken` / `agentBRecentSpoken` — last lines per agent from any recent conversation, for anti-repetition.
- For each agent: identity (display name, gender, role, mood, currentAction, currentGoal, daily-plan slice), traits, memories (short / episodic / long-term summaries), `engineBrainContext` (the seven structured fields).
- **`conversationState`** mirroring the `sessionState` snapshot — the LLM sees `turnIndex`, `minTurns`, `maxTurns`, `category`, `status`, `emotionalTone`, `topic`, `topicStack`, `conversationGoal`, `unresolvedQuestion`, `summarySoFar`, prior speaker intent, prior listener reaction. (`turnNumber` is preserved as an alias of `turnIndex`.)
- `scriptGuidance.engineDriven = true`.

### 3.5 LLM call (or stub)

If `isOllamaDialogueEnabled()` returns true:

1. `fetchNpcNpcExchange(packet, fallback)` posts the packet to `/ollama/api/chat` (the Vite proxy → Ollama on `127.0.0.1:11434`).
2. The system prompt now opens: *"You are continuing an active multi-turn conversation in AI City. You write the next two spoken lines (agentA then agentB) inside an ongoing dialogue session, NOT a one-off scene."* It includes explicit SESSION RULES (do not reset, do not greet unless `turnIndex == 0`, respond directly to the previous line, keep the same topic unless reason to shift, address `unresolvedQuestion`, push `conversationGoal`, do not prematurely end), LINE QUALITY rules (no throwaway lines like "Yeah." / "Okay." / "Sounds good."), and CATEGORY-AWARE PACING guidance.
3. The user message prepends a structured `ENGINE BRAIN STATE` block (rendered from `engineBrainContext`), then a SESSION STATE block (category, status, tone, turn budget, topic, prior topics, conversationGoal, unresolvedQuestion, prior speaker intent, prior listener reaction, summarySoFar), then a labeled list of PREVIOUS LINES IN THIS CONVERSATION, then an `AVOID REPEATING THESE PRIOR LINES` block, then the JSON packet as supporting context.
4. The model returns a JSON response with two lines, emotion deltas, relationship deltas, scene outcome, summary, topic, and the optional session-arc fields: `nextTopic`, `conversationGoal`, `unresolvedQuestion`, `lastSpeakerIntent`, `lastListenerReaction`, `summaryDelta`, `commitments`.
5. `sanitizeNpcResult` extracts each field defensively, falling back to the stub's defaults on any malformed value. The result is assigned to `c.activeBatch`; the two lines are queued into `c.pendingLines`.

If Ollama is disabled or fails, `generateStubStructuredNpcExchange(packet)` runs. The stub is now **session-aware**:

- **Opener** (turn 0): establishes a real topic, `conversationGoal`, and `unresolvedQuestion` matched to the inferred category. A planning opener picks a subject and asks "what's stuck?". An emotional opener says "I've been carrying X" and the responder asks "what's sitting on you?". A casual opener references a recent episode and asks what's on the other's mind.
- **Mid-arc**: the stub pushes the topic — argument lines push back with concrete grievances, planning lines name blockers and propose phasing, emotional / deep lines surface feelings and ask what would help.
- **Wind-down** (within 2 turns of `maxTurns`): the stub explicitly confirms or tables the goal and clears `unresolvedQuestion`.
- The stub also detects `I'll handle / cover / take` patterns in B's reply and records them as `commitments` so the session-end memory captures the promise.

The stub is deliberately weaker than the LLM, but it is no longer generic. The same encounter at turn 0 vs turn 6 produces noticeably different lines, and the session is no longer dependent on Ollama to feel coherent.

### 3.6 Batch arrival → session folding

`applyArrivedBatch(c, Bob, Mina, result)` runs the moment the LLM returns:

1. Queues both lines into `c.pendingLines`. Sets `c.canScheduleMore = result.sceneOutcome.continue` (the LLM's raw signal — the actual continue/end decision is made later by `decideContinuation`, which is the engine-wins-on-stop policy).
2. Folds session-arc updates from the result into the live session:
   - **Topic shift:** if `result.nextTopic` (or `result.topic`) differs from the current `c.topic`, push the old topic onto `c.topicStack` (cap 6) and replace `c.topic`.
   - **`conversationGoal`** trims and replaces if the result included one.
   - **`unresolvedQuestion`** can be set to a string OR explicitly set to `null` (the LLM clears it by emitting `null`).
   - **`lastSpeakerIntent` / `lastListenerReaction`** track the latest speakers' framing.
   - **`summaryDelta`** appends to `c.summarySoFar` (trimmed to 700 chars).
   - **`commitments`** are validated (only commitments from the two participants are accepted, capped at 12) and pushed.
3. Re-classifies category with the new topic. Category may **only upgrade** (never downgrade) along the rank ladder `casual < work < planning < emotional < argument < deep`. So a session that opened "casual" but turns out to be planning gets the right budget once the topic is named, while a planning session that resolves quickly does not shrink back to casual budget.
4. Refreshes `emotionalTone` (from category + max tension + moods) and `relationshipContext` (avg trust, max tension, max familiarity).

### 3.7 Turn pumping and TTS gating

The next `tickActiveConversations` tick sees `c.pendingLines.length === 2` and `now - c.lastEmittedAt >= TURN_DELAY_MS`. It calls `emitNextPendingLine(c, now)`:

1. The first line is popped from `c.pendingLines`.
2. The line is pushed onto `c.turns` AND `recordLine(c, turn)` (rolls `recentLines` cap 8, increments `c.turnIndex`, sets `currentSpeakerId`).
3. `conversationLastLine` is updated for both Bob and Mina.
4. This is the FIRST line of two. The `applyStructuredNpcExchange` (per-batch memory + relationships) and `sendResidentEvent` calls are scheduled to run after the SECOND line emits, not now.
5. `beginSpeechWait(c, line.text)` flips `c.waitingForSpeech = true` and sets `c.speechWaitUntil = now + computeTimeoutMs(line.text)`.
6. The pump invokes `onDialogueLine(line)`, which is bound to `CitySimManager.appendDialogueLine`:
   - Pushes the line into `dialogueLog` and calls `uiBump()` so the chat panel re-renders immediately.
   - Calls `speakAiLine(speakerId, text, voiceId)` and returns the resulting Promise.
7. `speakAiLine` enqueues the request on the global speech queue. The next time the queue is empty, it tries Edge TTS first (fetches `/api/edge-tts?text=...&voice=...&rate=...&pitch=...`, plays the resulting audio), and falls back to Web Speech if Edge fails. The Promise resolves when audio fully ends, when an error fires, when an external pause cancels playback, or when a length-proportional safety timeout triggers.
8. When the Promise settles, `endSpeechWait(c)` flips `c.waitingForSpeech = false` and updates `c.lastEmittedAt = now`.

The next tick sees `c.pendingLines.length === 1`, the gate is open, `TURN_DELAY_MS` has elapsed; the pump emits the second line. This time, the emission is the FINAL of two, so:

- `applyStructuredNpcExchange(c, Bob, Mina, result)` runs:
  - Updates relationships in both directions: `applyConversationOutcome(Bob, Mina, trustDelta, tensionDelta, familiarityDelta)`.
  - Adds a `MemoryEvent` to the local `MemorySystem` for `[Bob, Mina]` (per-batch short-term feed; the consolidated arc memory is written later at session end).
- `residentBrainAdapter.sendResidentEvent` is called twice — once for each speaker — with a structured `conversation_outcome` payload that includes the spoken line, tone, partner id, partner name, topic, mood, social delta, relationship delta, and `resolved` flag.
- The bridge fires `POST /brains/event` for each. The brain bundles ingest the event through their typed adapters: `RelationalMemorySystem.store_memory` writes the structured tags, `IntentSystem.add_intent` may add a "Follow up with Mina about <topic>" intent if the outcome was tense, `DriveModelSeed.update_from_interaction` shifts drives, `GoalEngineGramps.update_goal_progress` nudges social-tagged goals, `EmotionKernelGramps.update` adjusts emotion, `SelfModelGramps.append_to_narrative` writes a narrative line.
- `decideContinuation(c, c.canScheduleMore)` runs. If it says continue, the pump will request another batch on the next idle tick. If it says end, an `endAfterSpeech` closure is captured.

### 3.8 Session-level decisions: continuation, interrupts, and end

After every batch (and on every idle tick once `pendingLines` are drained), the session goes through three checks before it either dispatches another batch or ends:

1. **Hard-end conditions.** Distance > `TALK_RADIUS * CONVERSATION_SEPARATION_MULTIPLIER` → `endReason = "separated"`. No batch landed inside `CONVERSATION_IDLE_TIMEOUT_MS` → `endReason = "idle_timeout"`.
2. **Interrupt detection** (`detectInterrupts([Bob, Mina], allEntities)`). Conservative thresholds — only true emergencies fire:
   - Either participant's `hunger >= 0.92` → `interrupt:hunger`.
   - Either's `energy <= 0.06` → `interrupt:fatigue`.
   - Either's `avoidingEntityId` resolves to a target within 4 units → `interrupt:danger`.
   - Either's daily-plan `purpose` need `<= 0.15` AND there's an unfinished objective → `interrupt:obligation`.
   - Dev/player commands (via `endAllConversations(reason)`) bypass `minTurns` with `interrupt:dev_command`.
3. **Continuation policy** (`decideContinuation(c, c.canScheduleMore)`). Engine-wins-on-stop:
   - `turnIndex >= maxTurns` → end (`max_turns_reached`).
   - `turnIndex < minTurns` → continue (LLM stop is overridden).
   - `unresolvedQuestion` non-null → continue regardless of LLM.
   - Tense or heavy tone → continue up to four extra turns past `minTurns`.
   - Otherwise honor the LLM signal: if `canScheduleMore === false`, end with `llm_stop_after_min`; else continue.
   The verdict's reason string is captured in `c.lastContinuationReason` and surfaced in the debug HUD.

If continuation says continue, the pump fires the next `runNpcPairBatch` (which re-fetches engine context, builds a packet with the updated session state, and dispatches the LLM call). If continuation says end, `endSession(c, Bob, Mina, now)` runs after the speech promise settles:

- Sets `c.status = "ended"`, preserves the typed `endReason`.
- Builds a single arc summary via `buildSessionArcSummary({session, participants})` — a paragraph-shaped string covering topic, turn count, goal, summary so far, tone, commitments, unresolved question, and any `(cut short by ...)` interrupt note.
- Writes ONE arc memory event (`type: "conversation_session"`) to **both** participants' `MemorySystem`. Salience is tuned by tone (warm tones bias positive, tense/guarded tones bias negative). This is the **long-term** memory the conversation leaves behind; the per-batch writes only fed short-term.
- For each commitment, writes a per-actor memory event (`type: "commitment"`) so the commitment-holder can recall the promise specifically.
- Applies follow-up actions (`linger` / `leave` / `goto` / `avoid`) from the last batch's action hints.
- Sets `conversationCooldownUntil`, calls `detachEntity` (clearing `inConversation` on both speakers), and `scheduleNextDecision` for each AI participant. The decision system's lock is now released.

The session is complete. Audio finished. Per-batch memories landed. Arc memory landed. Commitments recorded. Both residents back to idle and free to walk.

---

## 4. Memory flow

### 4.1 Local memory (browser)

Every conversation outcome adds a `MemoryEvent` to the browser's `MemorySystem`. Each event is filed under both speakers in:

- Short-term (cap 20 per actor).
- Episodic (cap 120 per actor).
- Long-term (cap 30 per actor, reinforced by normalized summary key).

The full state is persisted to `localStorage` under `ai-city-memory-v2`. On reload, it hydrates back. A `MemorySystem.subscribeEvents` hook lets `CitySimManager` forward every event to the brain bundle of any involved actor whose `brainKind === "engine"`.

### 4.2 Engine memory (Python service)

The same event arrives at the brain service via `POST /brains/event`. The bundle:

1. Stores the event on `last_input_event` and pushes it onto the bundle's `events` log (cap 400).
2. Refreshes `last_memory_summary`.
3. Fires the typed adapters for memory engines: `MemoryManagerLyra.store(content, meta)` and `MemoryManagerLyra.add_short_term(entityId, "user/assistant", spokenLine)`, `RelationalMemorySystem.store_memory(...)` with structured tags, `WordStoreSeed.add_word(...)` with words extracted from the summary.
4. Fires generic dispatch on every other engine; engines with compatible `record_event` / `process_event` / `ingest_event` / `append_to_narrative` methods absorb what they can.

Per-engine state is persisted on disk. On the next conversation, `EpisodeMemoryGramps.get_recent_episodes(3)` and `RelationalMemorySystem.get_reasoning_summary(3)` return values that include the most recent stored events, which then surface in the next `engineBrainContext`.

### 4.3 Daily plan progression

`onNpcArrivedAtLocation` and `onConversationEndedForDaily` advance daily plan objectives. When an objective is completed, `dailyPlan.completionsToday` increments, the objective's `progress` reaches 1.0, and the bundle's `lifeAdaptation` value drifts upward over many days.

---

## 5. The event feedback loop

In one tight diagram:

```
Encounter Bob+Mina ─► tryBeginPair
     │
     ▼
createSession(Bob, Mina) ── computeConversationBudget
     ──► category = "casual" | "work" | "planning" | "emotional"
     ──►            | "argument" | "deep"
     ──► minTurns / maxTurns from category band
     attachEntity → inConversation = true on both (lock holds entire arc)
     │
     ▼
For each batch in the session:
  │
  ▼
  Both speakers awaitConversationContext
  │
  ▼
  Brain bundles return engineBrainContext
  │
  ▼
  buildNpcConversationScenePacket assembles prompt
    (with full session state: turnIndex, category, topic,
     conversationGoal, unresolvedQuestion, summarySoFar,
     last 8 lines)
  │
  ▼
  Ollama (or session-aware stub) returns 2-line exchange + arc updates
  │
  ▼
  applyArrivedBatch folds session-arc updates into the live session
    (topic shift → topicStack push; goal/unresolvedQuestion follow result;
     summaryDelta appends; commitments push; category may upgrade)
  │
  ▼
  Pump emits line 1 ── recordLine ── speakAiLine ── audio ── settle
  │
  ▼
  Pump emits line 2 ── recordLine ── speakAiLine ── audio ── settle
  │
  ▼
  applyStructuredNpcExchange (per-batch short-term memory + relationships)
  │
  ▼
  sendResidentEvent for each speaker
  │
  ▼
  Brain bundles route via typed adapters:
    RelationalMemorySystem.store_memory(... partner tags ...)
    IntentSystem.add_intent("Follow up with Mina about <topic>")
    DriveModelSeed.update_from_interaction(... satisfaction, quality ...)
    GoalEngineGramps.update_goal_progress(... social-tagged goals ...)
    EmotionKernelGramps.update(... reflection ...)
    SelfModelGramps.append_to_narrative("Event: <summary>")
  │
  ▼
  decideContinuation(session, llmContinue):
    - turnIndex >= maxTurns → end (max_turns_reached)
    - turnIndex < minTurns  → continue (engine override)
    - unresolvedQuestion    → continue
    - tense/heavy + room    → continue (extra grace)
    - else honor LLM signal (llm_stop_after_min if stop)
  │
  per-tick: detectInterrupts (hunger/fatigue/danger/obligation)
  │
  └── continue: loop to next batch
  └── end: schedule endSession after speech finishes

endSession (single tear-down path):
     │
     ▼
buildSessionArcSummary
     │
     ▼
ONE arc memory ─► both participants' MemorySystem (long-term)
     type: "conversation_session"
     │
     ▼
For each commitment ─► commitment-holder's MemorySystem
     type: "commitment"
     │
     ▼
Apply follow-up actions (linger / leave / goto / avoid / idle)
detachEntity → inConversation = false (lock released)
Cooldown applied, scheduleNextDecision, daily connection-need nudged
     │
     ▼
... time passes ...
     │
     ▼
Next encounter: awaitConversationContext returns the *new* engineBrainContext
     ▼
Recent intents, recent episodes (now including the arc memory), and
recent relationship reasoning all carry through.
```

This is the closed loop. Document 4 Section 5.3 lists the typed adapters that close it; this document shows when each one fires.

---

## 6. What the user sees

A user opening AI City sees:

- A 3D town with placed homes, paths, parks, stores, and a burger restaurant if the layout includes it.
- Six to twelve resident NPCs (the seed roster) plus their own avatar.
- Residents walking between locations. Some idle. Some sit. Occasional pairs turn toward each other and talk.
- A left-side chat panel showing recent dialogue lines as they emit. Each line shows the speaker's name and the text. NPC voices are heard through the speakers (Edge TTS or Web Speech) one at a time, never overlapping.
- A right-side debug HUD showing each AI resident's current goal, mood, decision source ("engine" or "fallback"), conversation source ("engine" or "fallback"), last brain emotion summary, last brain intent, and a per-resident drilldown panel for engine inventory and last decision source.
- A burger counter, when placed in the layout, with workers taking and filling orders. Players can place orders for in-world money.

The user can:

- Walk freely with their avatar. Their position drives the human entity in the simulation.
- Approach an NPC and start a chat (Player↔NPC mode). The NPC responds with a single LLM- or stub-generated line, with engine context in the prompt.
- Talk in voice (when configured) or by typing into the chat input.
- Tweak TTS rate, pitch, voice override per resident, master AI enable, and persona slices through the AI settings drawer.
- Open the layout editor and reposition markers (homes, paths, social spots).

Over a session of 10–30 minutes:

- Residents will accumulate small relationship deltas with each other.
- Their daily plan completions will tick up.
- Their `townDaysLived` counter advances when the local-calendar key changes.
- Their brain bundles will accumulate events, with longer episodic histories. The next conversation context for that resident will reflect that history.

Across sessions:

- Layout persists.
- Browser-side layered memory persists.
- Engine state per resident persists on disk under `state/engines/<entityId>/`.
- Reload comes back to the same town with the same residents who remember (in their engines and locally) what happened before.

---

## 7. Current rough edges

These are the issues a user will encounter today, not the architectural problems. Document 9 covers the architectural side.

### 7.1 First-conversation thinness

When a fresh resident has no event history, their `recentEpisodes` and `relationshipReasoning` will be near-empty. The engine context still drives the prompt, but there is less to bind to, so the first dialogue often reads as cordial-but-generic. After three or four conversations, the context fills in and lines become more specific.

### 7.2 Latency on engine-driven conversations

`awaitConversationContext` has up to a 6 second timeout. In normal local operation it returns in tens to hundreds of milliseconds, but the first call after a cold brain service start can take longer. The conversation system deliberately blocks the prompt build on this fetch, because falling back to generic context defeats the goal of engine-driven dialogue. As a result, a brand-new conversation between two NPCs after a cold start can stall briefly while context is gathered. This is a deliberate trade-off.

### 7.3 Ollama latency

When Ollama is enabled, each two-line batch is one HTTP request to a local LLM. With `llama3.2` on a typical developer machine, this is about 2–6 seconds. Conversations therefore have visible "thinking" pauses between batches. The pump re-arms the next batch only after the current one has fully emitted (both lines spoken).

### 7.4 TTS variance

Edge TTS is a hosted online endpoint. It is fast and high-quality when reachable; when it is not, the system falls back to Web Speech. Web Speech voices vary by browser and operating system, sometimes wildly. The voice mapping per resident is best-effort.

The TTS gate is protective: the conversation never emits the next line until the previous one is fully spoken or has timed out. But TTS hiccups can still produce the same sentence with two different voices on consecutive sessions, since the available voice set differs by environment.

### 7.5 Repetition decreasing but not gone

The current prompt actively guards against repetition by including each speaker's recent spoken lines as an explicit "AVOID REPEATING THESE PRIOR LINES" block. This eliminated the most egregious repetition. Subtler repetition (similar phrasings across different residents) still occurs occasionally. This is a function of LLM tendency rather than missing context.

### 7.6 Generic feel for engines without typed adapters (improved)

After the engine influence expansion, ~73 of 103 engines now contribute captured output per tick, including most cognition engines whose state methods now feed into `extendedContext`. The features that should emerge from those engines (long-term reflection, deep review, deliberation, predictive processing) are now *surfaced* in the HUD's extendedContext block, but they are not *yet wired into the LLM prompt* — the prompt still anchors on the 7 core fields. Promoting specific cognition engines into typed adapters that contribute to the 7 core fields (or opting the prompt builder into reading `extendedContext`) is the remaining unlock. Document 9 §3.1 lists the priority cognition engines for typed-adapter conversion.

### 7.7 Player ↔ NPC is single-shot

Player ↔ NPC mode currently produces one NPC reply per user message and ends the conversation. There is no multi-turn back-and-forth pump for player conversations yet. The structure exists in `conversationPlayer.ts` to support it; the wiring is not complete.

### 7.8 Brain service must be running

The system tolerates the brain service being offline (fallback heuristic + engine-aware stub keep the world alive), but the engine path is what makes conversations specific. Without the brain, the world is functional but dramatically less interesting. Running `start_dev.py` is the recommended way to ensure both processes are up.

---

## 8. Summary statement

In one paragraph:

When AI City is running with the brain service online and Ollama enabled, every AI resident has a dedicated cognition bundle on disk; every decision is asked of that bundle first and only falls back to a heuristic when the bundle declines; every conversation between NPCs first awaits the structured engine brain context for both speakers and feeds it as the spine of the LLM prompt; every line is spoken sequentially with no overlap; and every conversation outcome flows back into the relevant engines so the next context will reflect what just happened. The world is alive enough to be surprising, partial enough to be uneven, and structured enough that the gap from "it sort of works" to "it works convincingly" is a list of named adapters and prompt refinements rather than a redesign.
