# Document 9 — Known Problems and Next Steps

This document is the "where the system is failing or only partially succeeding, and what to do about it" companion to Documents 6 and 7. It is deliberately blunt. The intent is that someone reading this should walk away with a concrete picture of the technical debt and the prioritized backlog, not the impression of a finished product.

---

## 1. Current limitations

### 1.1 Engine wiring is partial (down from "incomplete")

This was the biggest single issue. After the engine influence expansion (Doc 10) it is no longer the dominant problem, but it is still partial.

- 103 engines instantiate per resident. 16 of them (~15%) have typed adapters that produce sharp, type-correct outputs.
- A capability registry now scans every engine at startup and a `GenericEngineAdapter` invokes each engine's compatible methods via signature-aware dispatch. As measured in a smoke run: **~73 of 103 engines now contribute captured output** (was: ~16). **~10 engines beyond the typed set vote on `synthesizeDecision`** through their decision-shaped methods (was: 0 reliably). **Up to 8 ranked engine summaries surface in `extendedContext`** per conversation context request (was: 0).
- The decision pipeline now diverges between residents on the first tick. Two residents with different snapshots produce different intents without waiting for engine state to drift. Three explicit bias channels (`bias.emotional_pressure`, `bias.personality_consistency`, `bias.world_state_pressure`) participate in voting and are visible in the per-resident `decisionBreakdown`.
- The conversation context now exposes the wider engine state through `extendedContext` and `contextSources`. The 7 core fields (LLM prompt spine) are unchanged.

What's still partial:

- The 7 core `engineBrainContext` fields still pull from the same 7 named engines. Promoting personality/memory engines beyond `SelfModelGramps` / `RelationalMemorySystem` / `EpisodeMemoryGramps` into structured contributors of those fields requires hand-written typed adapters (Section 3.4 below).
- The LLM prompt does not yet read `extendedContext`. That's a deliberate token-budget decision; it can be revisited as a quality experiment.
- ~30 engines remain "silent" — active but with no captured output, usually because their state methods returned None or because their outputs are too cryptic for `summarize_engine_output` to render meaningfully.

Implication: the system is using significantly more of its cognitive surface than before. The remaining high-leverage work is converting the strongest Tier-2 engines (capability-driven) into Tier-1 typed adapters where their domain demands it.

### 1.2 Conversation context, while structured, is still LLM-shaped

Conversations are now persistent multi-turn `ConversationSession` objects with category-aware turn budgets, engine-wins-on-stop continuation, conservative interrupt detection, topic / goal / unresolved-question continuity, and one consolidated arc memory written at session end. The prompt is told this is a continuing session, not a fresh scene. The full change record is in Doc 11. The earlier "conversations end after one batch" symptom is fixed.

What is still LLM-shaped:

- The conversation prompt now anchors on `engineBrainContext` AND on the live session state (turnIndex, category, topic, conversationGoal, unresolvedQuestion, summarySoFar). But the LLM is still the actor that turns that context into spoken English. So the personality of the LLM (Ollama with a default `llama3.2`) leaks into every line.
- When the LLM is unavailable, the session-aware stub uses the same context but produces a markedly thinner result — though the stub now has opener / mid-arc / wind-down branches and is category-flavored, so the gap between LLM-on and LLM-off lines is smaller than it used to be.
- Different residents technically have different `engineBrainContext`, but with a fresh memory base they end up with similar contexts (`emotionalState: "calm, low arousal"`, `currentIntent: "(none)"`, `recentEpisodes: [empty]`). Until the simulation has run long enough to diverge state, the prompts converge.
- The LLM is told to fill `nextTopic`, `conversationGoal`, `unresolvedQuestion`, `commitments`, and `summaryDelta`. Nothing enforces that it does. If the model returns a malformed result, we fall back to the stub's defaults — so the session still has a topic and a goal, but they may not match what the spoken lines actually said.

Implication: the prompt is well-shaped and the arc is now persistent, but the spoken line quality is still downstream of how interesting the engine state is and how well the LLM follows the session contract.

### 1.3 TTS robustness depends on environment

The Promise-based, queued, gated TTS layer has fixed the main turn-timing issues. But:

- Edge TTS (the higher-quality path) requires a working network connection. In offline use, only Web Speech is available.
- Web Speech voice availability and quality is wildly inconsistent across browsers and operating systems. The voice mapping per resident is best-effort: if the requested neural voice is not available, the system picks the closest match, which can produce a noticeably different character.
- Long lines (more than ~25 seconds of audio) hit the proportional safety timeout. The conversation pump will release the gate even if audio is still playing in the worst case. This is the right default — refusing to release would freeze the simulation — but it can produce noticeable cuts on a slow TTS engine.

Implication: TTS works, but it is the layer most exposed to environmental variance. This is unlikely to ever be eliminated.

### 1.4 Composite engines beyond advanced_pairing are not wired

The four advanced_pairing composites (`RecompositionEngine`, `ReasoningEngine`, `KnowledgeFusionEngine`, `ReflectionEngine`) are wired with sibling injection. They have typed adapters and contribute to expression and cognition phases.

Other composites in the library — particularly the connor and beast tier engines that internally compose other engines — are not wired with sibling injection. They run with their default constructors, which means the dependencies they would normally cooperate with are missing or stubbed. The behavior is not crashing, but it is also not what the engines were designed for.

Implication: the cognitive richness available from the connor and beast layers is significantly under-tapped.

### 1.5 RelationalMemorySystem reads from a global file

The typed adapter for `RelationalMemorySystem` correctly writes per-conversation tags via `store_memory`. The read surface, `get_reasoning_summary(limit)`, currently reads from a global `reasoning_chains.json` in the working directory of the brain service. Two different residents querying this engine see the same global summary, not their own.

Implication: the `relationshipReasoning` field of the conversation context is not currently per-resident. This is a subtle but real isolation leak. The fix is small but unsigned: redirect the engine's read path to a per-resident file under `state/engines/<entity_id>/`.

### 1.6 Event payloads do not include the full TownEntity world state

The `tickContext` and `decisionContext` payloads send a sanitized subset: mood, energy, hunger, social tolerance, current goal, current action, life adaptation, days lived, town role options. They do not include:

- The full `dailyPlan` (objectives, needs, desires).
- The full `relationships` map.
- The list of memory event ids.
- The current location's neighbors / nearby people detail.
- The most recent dialogue turn.

Some of this is intentional (the brain doesn't need the full memory list), but some of it is missing because no one has wired it. Engines that could reason over relationships or daily plans don't get the chance to.

Implication: deeper engine reasoning over the town's social and planning data is not yet possible. The data exists; it isn't being passed.

### 1.7 Player ↔ NPC dialogue is single-shot

The Player↔NPC mode produces one NPC reply per user message and ends the conversation. There is no multi-turn back-and-forth pump. The NPC's `engineBrainContext` is used in the prompt; the user's message is used; one reply comes back; the conversation ends.

The NPC↔NPC session work in Doc 11 created the `ConversationSession` machinery the player path could reuse. The session object is already created for player↔NPC pairs (with `isPlayerHumanPair: true` and `closedByPlayerFlow` reserved), but `tickOneConversation` early-returns for it — only the original single-shot reply runs. To upgrade, we would need to keep the session alive after the NPC replies, gate the next NPC line on the next player input, and wire continuation / interrupt / arc-memory logic the same way as NPC↔NPC.

Implication: meaningful dialogues with the player do not yet exist. The session infrastructure is there; the player-input pump that drives turn alternation is not.

### 1.8 No autonomous reproduction

`createChildResident` exists and works, but is only called by explicit dev paths. There is no logic in the simulation that recognizes "these two residents are close enough that a child is plausible." The lineage system is therefore manual.

Implication: the town has no organic population growth.

### 1.9 No mortality or removal

A resident, once spawned, never leaves. Family links accumulate. State files grow. Long-running towns will eventually accumulate residents whose existence is not necessary.

Implication: the town can grow but cannot shed. This will become an issue with multi-day in-sim play.

### 1.10 LAN mode is functional but not robust

Host-authoritative LAN works. The protocol is minimal. But:

- No prediction or rollback on the client. Network jitter is visible.
- No reconnection logic. A dropped client must rejoin.
- No authentication. Any device on the LAN that can reach the dev server can connect.

Implication: LAN mode is fine for development and small in-room demos. It is not production multiplayer.

### 1.11 No save/load UX, just persistence

State persists. Memory persists. Brain bundles persist. But there is no "load a specific town" or "branch a saved state" UX. There is one rolling state, automatically saved.

Implication: experimental branches require manual file copying. There is no in-app way to checkpoint a town.

---

## 2. Technical debt

A separate list from the architectural limitations above. These are smaller, fixable, and nagging.

### 2.1 UTF-8 decode warning on `MemoryManagerLyra` state

Engines occasionally write binary state files (sqlite, vector indexes) that the bundle's generic state loader tries to decode as UTF-8. The result is a console warning at startup. Cosmetic, not breaking.

**Fix:** make the bundle's state loader skip non-text engines or detect file types up front.

### 2.2 Ollama model warning when model is missing

When Ollama is enabled but the configured model is not pulled, the system warns repeatedly: `[Ollama] Warning: Model 'mistral' not found.` This does not disable Ollama; the warning logs every conversation attempt.

**Fix:** detect at boot, disable Ollama for the session if the model is missing, log once.

### 2.3 Health check polls when service is offline

`residentBrainAdapter.refreshHealth()` polls every few seconds. If the service is offline, every poll is a small failure that logs to the network panel. Cosmetic.

**Fix:** exponential backoff, capped at a maximum interval.

### 2.4 Conversation cache cleanup (RESOLVED)

`ResidentBrainAdapter.conversationContextCache`, `suggestions`, `pendingDecision`, `pendingConversation`, `lastUpdateAt`, `lastDecisionAt`, `lastConversationAt`, and `inFlightConversation` are now drained via three eviction paths on `ResidentBrainAdapter`:

- `evictEntity(entityId)` — drops every per-entity cache for one id.
- `clearAll()` — wipes every cache (for layout mode entry / bootstrap into a new town).
- `pruneToActive(activeEntityIds)` — periodic safety net, drops anything not in the active set.
- `cacheSizes()` — diagnostic for the HUD and leak regressions.

Wired in `CitySimManager`: `enterLayoutMode` and `bootstrapFromSavedLayout` call `brains.clearAll()`. `removeNetworkPlayer` calls `brains.evictEntity(id)` plus `memories.forgetEntity(id)`.

The original doc claim that `inFlightConversation` accumulates was incorrect — that map is properly drained in the `finally` block of `awaitConversationContext`. The genuine leak was `conversationContextCache`. That now drains.

### 2.5 Stub fallbacks should clearly identify themselves

The engine-aware stub produces lines that are visibly less interesting than LLM lines. There is no UI signal beyond `conversationSource`. Reviewers may misattribute "thin" lines to the LLM.

**Fix:** show "stub" on the dialogue line in dev builds when the conversation went through the stub path.

### 2.6 The HUD's "active engines by role" is collapsed (PARTIALLY DONE)

The debug panel now shows the inline `contributing/silent` count, last event tags, and the top-4 of `decisionBreakdown` per resident. The expanded view adds the silent-engine list, contribution counters, and conversation context sources. The flat 103-engine list is still long — a per-role expandable grouping is still the next refinement.

**Fix:** small UI work in `ResidentBrainDebugSection.tsx` to group by role with expand/collapse per role.

### 2.7 `start_dev.py` does not reload engine source on change

The brain service is started once and runs until killed. Engine source changes require a manual restart. The Vite dev server hot-reloads its TypeScript, but the brain doesn't have a watch mode.

**Fix:** add `--reload` to the uvicorn invocation in `start_dev.py` or run uvicorn with `watchfiles`.

### 2.8 No formal API tests

Endpoints are exercised manually during development. There are no automated tests for the brain service. A regression in `synthesizeDecision` or `synthesizeConversationContext` would only surface when an NPC starts behaving oddly in the world.

**Fix:** add `pytest` smoke tests against `EngineBundle` directly.

### 2.9 Browser-side memory persistence is not pruned (PARTIALLY RESOLVED)

`ai-city-memory-v2` in localStorage already enforces per-actor caps (short-term 20, episodic 120, long-term 30) and a global `MAX_GLOBAL_EVENTS = 1200`. The remaining leak was per-actor index entries staying forever for entities removed from the simulation. That now drains via:

- `MemorySystem.forgetEntity(entityId)` — removes per-actor short/episodic/long-term entries, removes the id from each remaining event's actorIds, drops events that end up with zero actors, persists.
- `MemorySystem.pruneToActiveActors(activeIds)` — periodic safety net.
- `MemorySystem.diagnostics()` — diagnostic for the HUD.

Wired in `CitySimManager.removeNetworkPlayer`. A coarse age-based prune on hydrate (the original suggested fix) is still TODO — nothing currently age-prunes events older than X days. With the global cap, that's bounded; without it, only very long-lived sessions hit the bound.

### 2.10 The character voice override system is browser-local

`saveTtsVoiceOverride(entityId, voiceUri)` writes to `localStorage`. Voice overrides are not synchronized across devices. A LAN client sees its own preferences only.

**Fix:** include voice overrides in the host snapshot when running LAN.

---

## 3. Next steps to reach full engine-driven cognition

The honest path forward, ordered by impact-per-effort. **Items resolved by the engine influence expansion (Doc 10) are marked DONE** and kept here for traceability rather than removed.

### 3.0 Engine influence expansion (DONE — Doc 10)

The seven phases of the engine influence expansion landed:

- Phase 1 — capability discovery + classification (`engine_capabilities.py`): every engine's methods are scanned once at startup and bucketed into decision / state / event / expression.
- Phase 2 — auto-adapter generation (`GenericEngineAdapter`): each engine without a typed adapter gets a signature-aware fallback caller.
- Phase 3 — decision integration: `synthesizeDecision` rewritten with weighted voting, priority-bias, source-bonus per method, and `contributingEngines` breakdown.
- Phase 4 — conversation context expansion: parallel `extendedContext` block alongside the 7 core fields.
- Phase 5 — event propagation upgrade: `classify_event_tags` + capability-driven event absorption + `last_event_tags`.
- Phase 6 — priority system: `DECISION_PRIORITY` and `CONTEXT_PRIORITY` tables.
- Phase 7 — debug + visibility: `contributingEngines`, `silentEngines`, `decisionBreakdown`, `contextSources`, `lastEventTags`, `contributionCounters` exposed in the debug snapshot and surfaced in the HUD.

Acceptance criteria from the spec all met: ≥50 engines influencing decisions / context / memory (measured 73-74); decisions list multiple contributing engines; different residents produce visibly different behavior without LLM dependence; no crashes from generic adapter calls.

### 3.0b Conversation session system (DONE — Doc 11)

The five phases of the conversation session work landed:

- Phase 1 — `conversationSession.ts`: `ConversationSession` type, six-category budget table (casual 4–8, work 4–10, planning 6–14, emotional 8–16, argument 8–20, deep 10–24), `decideContinuation` (engine-wins-on-stop), `detectInterrupts` (conservative thresholds), `buildSessionArcSummary`, `recordLine`.
- Phase 2 — `conversationStructured.ts`: `computeConversationBudget(a, b, hints)` returning category + min/max turns; `NpcConversationScenePacket.conversationState` extended with the full session view; `StructuredNpcExchangeResult` extended with optional session-arc fields (`nextTopic`, `conversationGoal`, `unresolvedQuestion`, `lastSpeakerIntent`, `lastListenerReaction`, `summaryDelta`, `commitments`); session-aware stub generator with opener / mid-arc / wind-down branches per category.
- Phase 3 — `ConversationSystem.ts`: `EngineConversation` → `RuntimeSession extends ConversationSession`; `turnIndex` counts individual lines; per-tick interrupt check; engine-wins-on-stop continuation policy; category drift upward only; consolidated arc memory written at session end (`type: "conversation_session"`); per-actor commitment memories (`type: "commitment"`); `endAllConversations(reason)` dev/player kill switch with typed end reason.
- Phase 4 — LLM prompt rewritten to instruct the model that this is a continuing multi-turn session (not a fresh scene); prompt surfaces full session state and prior turns; JSON contract extended; `sanitizeNpcResult` extracts new fields defensively.
- Phase 5 — debug HUD surfaces every session field (category, status, tone, lock, turnIndex/min/max, topic, conversationGoal, unresolvedQuestion, last line, lastContinuationReason, arc summary, commitment count, endReason).

Acceptance criteria (Tests A–D in the spec): planning openers reach ≥6 turns; emotional/work openers with high tension reach ≥8 turns via tone-based continuation grace; casual chats reach ≥4 turns; danger/fatigue/hunger/obligation interrupts cleanly end sessions with typed reasons. The decision system's existing `inConversation` lock now holds for the entire arc — there was never a missing lock, only conversations that ended too soon.

### 3.1 Add typed adapters for the cognition tier

Still the biggest remaining unlock. The capability registry now invokes these engines' state/event surfaces, but type-correct decision-shaped output and event handling require hand-written adapters. Priority list:

1. `ThoughtEngineGramps` — surfaces a "current thought" string that should appear in `engineBrainContext`.
2. `InnerMonologueGramps` — surfaces an internal voice line that should bias spoken lines.
3. `DeliberationEngineGramps` — surfaces a deliberation result that contributes to decision votes.
4. `ActionEngineGramps` — produces a concrete action recommendation that contributes to decision votes.
5. `JournalingEngineBeast` — produces a journal entry per day; the entry should feed the next day's `engineBrainContext.recentEpisodes`.
6. `DeepReviewEngineGramps` — runs longer-arc review of memory; should surface `reviewedTopics` for `engineBrainContext`.
7. `LLMDriftAnalysisEngine` — should provide a "stay in character" hint to the prompt.
8. `RegulatorConnor` and `LambdaPsiEngineConnor` — should adjust the bundle's cognitive load and surface a load summary in `engineBrainContext`.
9. `RealIntelligenceEngineConnor` — Connor's umbrella; once typed, surfaces an integrated reasoning result.
10. `NeuralEmergenceSystemConnor` — produces emergent thought patterns; should surface `currentEmergentThought`.

Each adapter is roughly the size of the existing 16. The work is mechanical: identify the engine's main method, craft the right argument shape, capture the right return value, register it in `TYPED_ADAPTERS`.

### 3.2 Per-resident state isolation for global-file engines

`RelationalMemorySystem` is the known case. Audit all engines for fixed-file writes; redirect each through a per-resident path. Document 6 Section 8 lists the engines most likely to need this.

### 3.3 Expand the tickContext payload

Pass the full `dailyPlan`, the full `relationships` map keyed by participant id, and a small recent-dialogue window in every `tickContext`. This lets engines reason over richer state without each one having to ask for it.

### 3.4 Add personality-engine surfaces to `engineBrainContext`

`engineBrainContext.selfNarrative` currently uses `SelfModelGramps.get_traits()`. Add structured surfaces from `IdentityEngine`, `StoryOfSelfSeed`, and `SocialCircleLyra`. Build a richer self block:

```json
"selfNarrative": {
  "traits": [...],
  "identityCore": "...",
  "narrativeArc": "...",
  "socialCircle": [...]
}
```

This gives the LLM a multi-axis sense of who is speaking, not just a trait list.

### 3.5 Wire memory engines beyond MemoryManagerLyra (PARTIALLY DONE)

These engines now appear in `extendedContext` because the capability scan picks up their state methods. To enter the LLM prompt spine they would still need typed adapters that produce structured contributions to the 7 core fields:

- `KnowledgeBaseGramps`: a "what this resident knows about the topic" surface keyed off the conversation's topic.
- `VectorMemoryGramps`: top-3 semantically similar past memories given the current conversation context.
- `MemoryReconciliationEngineGramps`: any flagged contradictions that should color tone.

The simpler unlock: opt the LLM prompt builder into reading `extendedContext` (top 3 by relevance) and treat the resulting block as a supplementary spine. This experiment has not been run.

### 3.6 Enable multi-turn Player ↔ NPC

Refactor the Player↔NPC path in `ConversationSystem` to support multi-turn pumps with the same TTS-aware turn timing. The session infrastructure is already there — Doc 11's `ConversationSession` is created for player↔NPC pairs (with `isPlayerHumanPair: true` and `closedByPlayerFlow` reserved). What's still missing is a player-input pump that drives turn alternation: keep the session alive after the NPC replies, gate the next NPC line on the next player input, and let `decideContinuation` / `detectInterrupts` / `endSession` apply the same way they do for NPC↔NPC. The single-shot path then becomes a special case of "session ended by `closedByPlayerFlow`".

### 3.6b Wire commitments into daily-plan objectives

Conversation sessions record commitments (e.g. "Omar agreed to evaluate the public garden idea") as memories with `type: "commitment"` on the commitment-holder. They are NOT yet inserted into `dailyPlan.objectives`. Wiring this requires:

1. A new `DailyPlanSystem` API for inserting mid-day objectives that don't blow away the existing day arc.
2. Mapping commitment text → an objective with a target location or kind.
3. Optionally adding a "commitments to a partner" tracker so the partner can hold the commitment-holder accountable.

Until this lands, commitments are visible in the HUD and in long-term memory but do not change behavior on subsequent ticks.

### 3.6c Session-complete events to engines

Per-batch `conversation_outcome` events fire to the brain bundle today. There is no parallel `conversation_session_complete` event. Adding one (with the arc summary, commitments, end reason, total turn count) would let typed engines like `IntentSystem`, `GoalEngineGramps`, and the long-form memory engines reason over session-level outcomes instead of reconstructing them from the per-batch stream. Bounded follow-up.

### 3.7 Lineage adapters per engine domain

The lineage path (Document 8) needs typed inheritance operations per engine. Start with the simplest:

- `EmotionKernelGramps`: average parents' state vectors, attenuate slightly.
- `SelfModelGramps`: weighted union of parent traits, generate a "born of A and B" narrative seed.
- `RelationalMemorySystem`: insert parent contacts as known relationships from day one.

Then iterate to memory and cognition engines.

### 3.8 Autonomous reproduction logic

Detect "couple-eligible" pairs: high familiarity, high friendliness, low tension, sustained over multiple days. With probability, schedule a child creation event. Run `createChildResident` automatically.

### 3.9 Mortality and entity removal

Add an aging-driven removal path. When a resident's `townDaysLived` exceeds some threshold and `lifeAdaptation` plateaus, mark them as "leaving" — they walk to a far location with a goodbye line, then are removed. State is archived to `state/archive/<entityId>/` so it can be inspected.

### 3.10 Population dashboard

A new HUD section showing the town's demographics: count by role, average lifeAdaptation, average daily-plan completion, count of active conversations, count of recent encounters. Useful for debugging long-running sessions.

---

## 4. Next steps to reach believable dialogue

A separate axis. Even with full engine wiring, dialogue will need:

### 4.1 Topic continuity

**Within a session: done.** A `ConversationSession` carries `topic`, `topicStack`, `conversationGoal`, and `unresolvedQuestion` across batches; the LLM is told not to reset the scene; the stub is opener / mid-arc / wind-down aware. See Doc 11 §2.

**Across sessions: still open.** Two consecutive talks between Bob and Mina can still be on completely different topics. The session-end arc memory (`type: "conversation_session"`) captures the topic and is queryable via `MemorySystem.layeredSummariesFor(...)`, but nothing consults it at the start of the next session to seed continuity ("we were just talking about the bakery yesterday"). A topic-continuity hint at session creation would close this — read the most recent `conversation_session` memory between this pair, surface its topic / unresolvedQuestion as an opener hint into `computeConversationBudget` and the prompt.

### 4.2 Sense of place

Conversations rarely reference where they are. The packet includes the location label, but the LLM prompt doesn't strongly emphasize "you are at the park, by the bench" in its spine. Strengthening this would dramatically improve grounding.

### 4.3 Voice-character separation

Today, Bob's lines and Mina's lines can sound similar because the LLM is producing both with the same persona shaping. Adding stronger per-resident voice differentiation in the prompt — "Bob speaks tersely, like someone who has worked the counter for years; Mina speaks more loosely, with a small-town warmth" — would help. This is a per-resident persona injection that already exists (`aiSimSettings`); making sure it gets into the engine-first prompt slot is a small refinement.

### 4.4 Emotional reaction language

The LLM is told to make lines reflect emotional state, but the wording it picks is often abstract ("I'm feeling a bit stretched today" rather than "Couldn't sleep last night, three coffees down"). Adding a small "concrete reaction examples" block to the prompt biases away from abstraction.

### 4.5 Anti-monotony at the structural level

The prompt anti-repetition uses recent spoken lines as a literal "AVOID THESE" block. This catches verbatim repetition. It does not catch structural repetition — every line opening with "Hey, ..." or every line ending with "... I guess." Adding a structural fingerprint to the anti-repetition guard would help.

### 4.6 LLM upgrade discipline

Right now the system uses Ollama with whatever local model is available. The dialogue quality is bottlenecked on the model. A more capable model (or an external API path with disabled training) would lift the ceiling. The architecture supports either; the current default of `llama3.2` is the floor.

---

## 5. Next steps to reach stable long-term simulation

A third axis. Aside from cognition and dialogue, the simulation itself needs:

### 5.1 Day rollover handling

The local-calendar key changes when midnight passes in the user's clock. Daily plans regenerate at that point. There is no notion of in-sim time scaling; a real day is a sim day. For a long-arc simulation, day acceleration (e.g. one sim day per 30 real minutes) would be useful.

### 5.2 Persistence performance

Each event triggers a brain bundle save. With many residents and frequent events, save frequency adds up. Adding a debounced save (coalesce rapid mutations) would reduce disk write pressure.

### 5.3 Engine state migration

When an engine's serialization format changes, residents with old state files break. There is no migration path. Adding a versioned schema per engine and a migrate-on-load step would protect long-running residents.

### 5.4 Brain service horizontal scale

Today the brain service is one process. With many residents (tens, hundreds), the per-tick cost grows linearly. The architecture supports sharding bundles across processes (each process owns a subset of bundle ids). Doing so would let the simulation scale beyond a single machine's CPU.

### 5.5 Memory budget caps (PARTIALLY RESOLVED — observability + archive)

`MemorySystem` has caps. Engine state files still do not have explicit size caps because the brain service cannot safely auto-prune arbitrary engine state without per-engine knowledge of each engine's data schema. What landed:

- `StateStore.state_size(entity_id)` — per-resident disk footprint with per-file breakdown and largest-file pointer.
- `StateStore.total_state_size()` — aggregate across every resident.
- `GET /brains/{entity_id}/state-size` and `GET /brains/state-size` — endpoints. `/health` now also returns `stateBytes`, `stateResidents`, `stateBiggestResident`.
- `StateStore.archive(entity_id)` and `POST /brains/{entity_id}/archive` — move state to `state/archive/<id>_<timestamp>/`, drop from `BUNDLES`.
- `StateStore.delete(entity_id)` and `DELETE /brains/{entity_id}` — permanent removal (use for accidental creates / corruption only).

Salience-driven per-engine pruning still requires hand-written adapters per engine — see Doc 9 §3.1 for the priority list of cognition adapters. The relational_memory_system / episode_memory_gramps / memory_manager_lyra adapters specifically should grow a `prune_to(target_bytes)` method.

### 5.6 Telemetry

For debugging long sessions: log per-tick durations, per-engine call durations, per-conversation latencies. Currently there is `DashboardEngineBeast` and `LambdaPsiInstrumentationConnor` for engine-side telemetry, plus the debug HUD on the world side. A unified time-series view would help diagnose drift over hours.

---

## 6. The honest summary

The system has good bones. Three real layers, clean separation, working HTTP boundary, working speech queue, real per-resident persistence, 103 engines instantiating cleanly, a closed feedback loop on conversation outcomes. The architecture is correct.

The system has thin flesh. Most engines tick but do not contribute observably. The prompt is structured but reliant on a moderate LLM. The lineage system spawns children but does not yet inherit much from parents. Player conversations end after one reply. Long-arc effects are not yet visible.

The work to bridge from one to the other is enumerable. It is in this document. None of it is research. All of it is engineering: typed adapters, payload expansion, prompt sharpening, lineage operations, multi-turn refactor, telemetry. Each item has a name.

That is the right state for a project in active development to be in. The next session of work will move concrete items off this list.
