# Document 4 — Engine Library (Mind Layer)

This document describes the cognition library that the Resident Brain Service consumes. It is written so that someone with no Python access can understand what each engine domain is for, what kinds of engines exist, and how they are intended to combine into a single resident's mind.

The library lives at `Engines/` in the project root. It is curated as six packages: `emotion`, `personality`, `memory`, `cognitive`, `behavior`, `utility`. Across these packages there are 119 importable Python classes. After filtering out dataclasses and pure value records, 103 are real engine classes — the ones the brain service instantiates per resident.

This document focuses on **what** each domain is for and **how** the domains are designed to interact. Document 5 covers how the brain service drives them, and Document 6 covers integration status (which engines are actually contributing today vs which are loaded but only minimally invoked).

---

## 1. The six domains, in one paragraph each

### 1.1 Emotion (5 engines)

The emotion domain owns each resident's affective state — what they feel right now, how their feelings are evolving moment to moment, and how they react to specific events. Engines here keep numeric vectors over emotion components (love, anger, anxiety, trust, fear, joy, etc.), apply decay over time, and accept event-driven updates ("the user spoke to me warmly", "I was contradicted", "I have been silent for two hours"). They also expose a current-state read so the conversation context can render a short, human-readable emotional summary.

### 1.2 Personality (8 engines)

The personality domain owns the slow-moving structural facts about a resident: their traits, their identity, their narrative of self, their social circle, their drift over time. Personality engines are the longest-lived state in the system. They produce stable summaries the conversation layer uses to keep voices consistent across days, while also accepting reinforcement signals so personality can shift gradually through experience.

### 1.3 Memory (10 engines)

The memory domain owns everything a resident knows or remembers. Episode memory captures discrete recent events. Knowledge base captures distilled facts. Vector memory provides semantic lookup. Relational memory tracks symbolic and emotional tags per memory and answers "how does this resident relate to that other person, and what do they associate with them?" Reconciliation engines consolidate or flag contradictory memories. Continuity engines link past to present.

### 1.4 Cognitive (45 engines)

The cognitive domain is the largest by far. It owns reasoning, planning, reflection, deliberation, inner monologue, prethinking, goal tracking, action selection, deep review, sentence construction, knowledge fusion, neural emergence patterns, predictive processing, contextual awareness, dream integration, emotional momentum, hallucination monitoring, lambda-psi load tracking, journaling, songwriting, and creative writing. This domain is the closest to "the resident is thinking about something."

### 1.5 Behavior (7 engines)

The behavior domain owns the rhythms and pulses that govern when a resident wants to do something. Daily rhythm tracks the day-cycle phase. Drive model holds physiological/social drives. Behavioral pulse and seed dynamics turn drive state into selected behavior. Initiative scheduler and life scheduler decide when to interrupt one activity for another. Cycle engine regulates longer arcs.

### 1.6 Utility (28 engines)

The utility domain is everything that doesn't fit cleanly into the five domains above. Aging and adaptation. Audio synthesis. Avatar generation. Curiosity. A fallback phrase store for when no other source produced a line. Image generation. Web crawling and learning. Vocabulary enforcement. The intent system (a backlog of "things this resident wants to revisit"). The contact manager. Voice modulation. Vision modules. The dashboard, observer client, and lambda-psi instrumentation that monitor the whole bundle. Ollama client and system load balancer support the technical side.

---

## 2. The eight runtime roles

Every active engine in the bundle is assigned exactly one runtime role. The role determines which phase of the brain loop calls it and what the bundle expects from it. Document 6 lists every engine's assigned role. The eight roles, in plain language:

- **CONTROL** — engines that drive when something happens. Daily rhythm, drive model, behavioral pulse, initiative scheduler. They produce signals like "this resident is in their evening wind-down phase" or "their connection drive is high right now."
- **MEMORY** — engines that store, retrieve, or transform memory. Episode memory, knowledge base, vector memory, relational memory. They accept events and answer queries about the past.
- **EMOTION** — engines that maintain affective state. Emotion kernel, emotion model, mental health, emotional feedback. They are the "feelings" of the resident.
- **PERSONALITY** — engines that maintain personality and identity. Self-model, personality engines, story-of-self, identity engine, social circle. They are the "stable self."
- **COGNITION** — engines that think. Goal engine, deliberation, reflection, thought engine, inner monologue, prethink, deep review, action selection, reasoning, neural emergence. They produce intentions, judgments, and plans.
- **EXPRESSION** — engines that shape what a resident says or how they appear. Response engine, recomposition engine, knowledge fusion, songwriting, creative writing, voice modulation, avatar generator, vision module. They sit between the inner state and the outward surface.
- **UTILITY** — engines that provide ancillary services. Aging, contact manager, intent system, fallback phrases, web learner, vocabulary enforcer, audio engine, system load balancer.
- **PASSIVE_MONITOR** — engines that watch the bundle and surface diagnostics without driving behavior. Hallucination monitor, dashboard engine, observer client, lambda-psi instrumentation. They are read-only.

A ninth role, `DISABLED_WITH_REASON`, exists as a placeholder for engines that fail to instantiate. In the current state of the project, zero engines are in this state — every compatible class instantiates cleanly per resident.

---

## 3. The intended phase loop

Each resident's brain bundle runs a fixed phase loop on every tick. The phases are a structural ordering, not a temporal one — they all happen quickly within one tick, but the order matters because earlier phases produce inputs the later phases read.

```
PHASE 1: physiology
  CONTROL engines that advance internal clocks and decay state.
  Examples: emotion_kernel.tick(seconds=1), mental_health.decay_conditions().

PHASE 2: emotion
  EMOTION engines update from current action and recent events.
  Examples: emotion_kernel.update(event="user_message", intensity=0.45),
            connor_state_beast.update(event, intensity).

PHASE 3: memory
  MEMORY engines surface their current state for downstream phases.
  Examples: relational_memory_system.get_reasoning_summary,
            memory_manager_lyra.get_state.

PHASE 4: personality
  PERSONALITY engines pull traits and identity summaries.
  Examples: self_model_gramps.get_traits, identity_engine.get_state.

PHASE 5: cognition
  COGNITION engines think with everything above as context.
  Examples: goal_engine.get_active_goals, reflection_engine.reflect,
            deliberation_engine.consider, thought_engine.tick.

PHASE 6: behavior
  CONTROL/behavior engines combine drive + cognition to suggest action.
  Examples: drive_model.get_active_drive, behavioral_pulse.get_current_phase.

PHASE 7: expression
  EXPRESSION engines pull current narrative and speech surface state.
  Examples: response_engine.get_state, recomposition_engine.get_synthesis_stats.

PHASE 8: utility
  UTILITY + PASSIVE_MONITOR engines refresh diagnostics and summary state.
  Examples: intent_system.get_top_intent, dashboard_engine.snapshot.

PHASE event (when an event arrives):
  All domains that consume events get a structured payload with eventType,
  summary, spokenLine, partnerId, partnerName, tone, relationshipDelta,
  topic, mood, socialDelta, resolved.
  Typed adapters route the payload to the right method per engine.
```

The brain bundle doesn't blindly call every method on every engine. It uses two layers of dispatch, plus a one-time capability scan that decides what each engine can contribute:

1. **Typed adapters** — for engines whose method signatures are known and whose generic dispatch would crash or produce ambiguous output (e.g. `emotion_kernel_gramps.tick(int)` would receive a dict from a naive call). The adapter knows the right method to call for a given phase and crafts the right argument shape. The current set covers 16 engines: emotion kernel, connor state beast, mental health, emotional feedback, memory manager Lyra, self-model gramps, word store seed, reflection engine gramps, the four advanced-pairing composites, relational memory system, intent system, drive model seed, goal engine gramps. They produce the sharpest, most type-correct outputs.
2. **Capability registry + GenericEngineAdapter** — for every engine *without* a typed adapter. At bundle creation, `engine_capabilities.discover_capability(engine, ...)` scans each engine for ~70 known method names, classifies each into one of four buckets (decision / state / event / expression), and caches per-method signature metadata: arity, parameter names, parameter type kinds (`dict`, `str`, `int`, `float`, `bool`, `list`, `any`, `unknown`). The `GenericEngineAdapter` then provides four operations — `gather_state(ctx)`, `gather_decision_signals(ctx)`, `absorb_event(event, ctx)`, `expression_signal(ctx)` — that walk the cached method list, build the right argument shape from name shortcuts and type fallbacks, invoke each method, and return the captured outputs. Per-call exceptions are swallowed so one engine's signature mismatch never breaks the loop.

The capability registry also publishes two priority tables that the bundle's aggregation layers read:

- **`DECISION_PRIORITY`** — used by `synthesizeDecision` to weight each engine's vote: `CONTROL > EMOTION > MEMORY > COGNITION > PERSONALITY > EXPRESSION > UTILITY > PASSIVE_MONITOR`. CONTROL (drives, schedulers, daily rhythm) gets the loudest decision vote.
- **`CONTEXT_PRIORITY`** — used by `synthesizeConversationContext` to rank `extendedContext` summaries: `EMOTION > MEMORY > PERSONALITY > COGNITION > CONTROL > EXPRESSION > UTILITY > PASSIVE_MONITOR`. Different from decision priority on purpose: when shaping voice, feelings and memory should dominate over which behavioral schedule the resident is on.

After the engine influence expansion (Doc 10), the practical state is: 16 typed adapters with sharp output, ~10 capability-driven decision contributors, ~74 capability-driven state contributors that surface in `extendedContext`, ~19 capability-driven event absorbers. Document 6 details which engine sits in which tier.

---

## 4. Domain-by-domain detail

### 4.1 Emotion domain

| Engine | Role | What it does |
| --- | --- | --- |
| `EmotionKernelGramps` | EMOTION | Holds an emotion vector (love, trust, joy, anxiety, anger, fear, …). Has `tick(seconds: int)` for time decay and `update(event: str, intensity: float)` for event-driven updates. `get_state()` returns the current vector. Typed adapter wired. |
| `ConnorStateBeast` | EMOTION | Parallel emotion-tracking engine with a different decay/update model. Has `update`, `receive_input`, `sync_to_personality`. Typed adapter wired. |
| `EmotionModelSeed` | EMOTION | A simpler seed emotion model used for low-overhead state. Generic dispatch. |
| `EmotionalFeedbackBeast` | EMOTION | Scores an interaction against the previous emotional state and returns valence/arousal/tension. Typed adapter wired. Used for refining how the resident processes a conversation outcome. |
| `MentalHealthEngineBeast` | EMOTION | Tracks longer-arc mental health conditions with decay. `decay_conditions`, `update_current_state`, `update`, `process_input`, `get_state`. Typed adapter wired. |

The bundle's emotional summary in the conversation context is produced by sorting `EmotionKernelGramps.get_state()` by component value and returning the top 3 components.

### 4.2 Personality domain

| Engine | Role | What it does |
| --- | --- | --- |
| `IdentityEngine` | PERSONALITY | Long-arc identity tracking. |
| `PersonalityEngineBeast` | PERSONALITY | Beast variant of the personality model. |
| `PersonalityEngineLyra` | PERSONALITY | Lyra variant of the personality model. |
| `PersonalitySeed` | PERSONALITY | Seed personality with simpler trait vectors. |
| `SelfModelGramps` | PERSONALITY | The self-model engine: holds traits, narrative state, reflection cadence. `get_traits()` returns a dict of `trait → value`. `append_to_narrative(text)` and `should_reflect()` / `mark_reflection()` control the resident's inner story. Typed adapter wired. |
| `SelfModelSeed` | PERSONALITY | Seed self-model. |
| `SocialCircleLyra` | PERSONALITY | Tracks the resident's social circle (who they think of often, who they consider close). |
| `StoryOfSelfSeed` | PERSONALITY | Maintains a short narrative summary of the resident's life. |

The conversation context's `selfNarrative` field is built by sorting `SelfModelGramps.get_traits()` by value and emitting the top 3.

### 4.3 Memory domain

| Engine | Role | What it does |
| --- | --- | --- |
| `EpisodeMemoryGramps` | MEMORY | Discrete episode memory store. Exposes `get_recent_episodes(n)` for recent prose summaries; supports retrieval. The conversation context's `recentEpisodes` field is built from this engine when present. |
| `KnowledgeBaseGramps` | MEMORY | Structured knowledge facts the resident has confirmed. |
| `MemoryCoreGramps` | MEMORY | Core memory abstraction shared by gramps engines. |
| `MemoryManagerLyra` | MEMORY | The Lyra memory manager. SQL-backed memory store with short-term threading per user, embeddings, and `store(content, meta)` plus `add_short_term(user_id, role, text)`. Typed adapter wired. |
| `MemoryReconciliationEngineGramps` | MEMORY | Reconciles or flags contradictions in memory. |
| `RelationalMemorySystem` | MEMORY | Memory tagged with symbolic and emotional tags, plus a reasoning summary surface (`get_reasoning_summary(limit)`). Typed adapter wired: writes `store_memory` from conversation outcomes with partner tags. The conversation context's `relationshipReasoning` field is built from this engine. |
| `SeedMemory` | MEMORY | Seed-tier memory store with episodes. |
| `TemporalContinuitySeed` | MEMORY | Tracks temporal continuity across episodes. |
| `UnifiedMemorySeed` | MEMORY | Unified memory abstraction at the seed tier. |
| `VectorMemoryGramps` | MEMORY | Vector-embedded memory for semantic lookup. Falls back to text-only mode when sentence-transformers cannot load. |

### 4.4 Cognitive domain

This is the largest domain. The full inventory is in Document 6. The most load-bearing engines for current behavior:

| Engine | Role | What it does |
| --- | --- | --- |
| `GoalEngineGramps` | COGNITION | Maintains active goals and supports `update_goal_progress(goal_id, delta)`. The conversation context's `activeGoals` field is built from `get_active_goals`. Typed adapter wired (events with conversation outcomes nudge social-tagged goals). |
| `DeliberationEngineGramps` | COGNITION | Resident's deliberate reasoning surface. |
| `ReflectionEngineGramps` | COGNITION | Periodic reflection over recent events. `reflect(limit, _)` produces a reflection record. Typed adapter wired. |
| `ThoughtEngineGramps` | COGNITION | Per-tick thought generation. |
| `InnerMonologueGramps` | COGNITION | Manages the inner monologue stream the resident hears. |
| `ActionEngineGramps` | COGNITION | Selects an action from current state. |
| `DeepReviewEngineGramps` | COGNITION | Multi-step review of a topic or memory. |
| `PreThinkEngineConnor` | COGNITION | Prethinking scaffolding before a deliberate response. |
| `RegulatorConnor` | COGNITION | Regulatory engine moderating other connor engines. |
| `LambdaPsiEngineConnor` | COGNITION | Lambda/psi load tracking for cognitive throughput. |
| `QuantumReasoningEngineConnor` | COGNITION | Quantum-state-style reasoning over multiple superposed thoughts. |
| `RealIntelligenceEngineConnor` | COGNITION | Connor's umbrella reasoning engine. Composed of associative network, contextual awareness, dream integration, emotional momentum, memory consolidation, predictive processor. |
| `NeuralEmergenceSystemConnor` | COGNITION | Self-organizing cluster map + activation network + emergent thought engine. |
| `JournalingEngineBeast` | COGNITION | Per-day journaling output. |
| `SkillAcquisitionEngineGramps` | COGNITION | Tracks skill development. |
| `LLMDriftAnalysisEngine` | COGNITION | Detects when LLM responses are drifting away from the resident's persona. |
| `HallucinationMonitorGramps` | PASSIVE_MONITOR | Watches for hallucinations across cognitive outputs. |
| `CreativeEngines` | COGNITION | Composite creativity surface. |
| `CreativeWritingEngineGramps` | EXPRESSION | Long-form creative writing. |
| `SongwritingEngineLyra` | EXPRESSION | Songwriting surface. |
| `ResponseEngineBeast` | EXPRESSION | Response composition. |
| `SelfRegulationEngineBeast` | COGNITION | Self-regulation across the bundle. |
| `AdvancedPairingEngine` | COGNITION | Umbrella for the four composite engines below. |
| `WordLibrary`, `PatternLibrary`, `FactDatabase`, `ConceptDictionary`, `SentenceParser`, `RejectionDatabase`, `ConversationMemory`, `ResponseChunkBuilder`, `EmbeddingEngine` | COGNITION/EXPRESSION | Sub-engines of the advanced-pairing system. |
| `RecompositionEngine` | EXPRESSION | Composite. Constructed with WordLibrary, PatternLibrary, FactDatabase, ConceptDictionary, SentenceParser dependencies. Has `recompose_sentence`, `get_synthesis_stats`. Typed adapter wired. |
| `ReasoningEngine` (advanced_pairing) | COGNITION | Composite. Has `reason_about_sentence`, `get_reasoning_stats`. Typed adapter wired. |
| `KnowledgeFusionEngine` | COGNITION | Composite. Has `think_with_knowledge`, `get_fusion_stats`. Typed adapter wired. |
| `ReflectionEngine` (advanced_pairing) | COGNITION | Composite. Has `get_reflection_stats`. Typed adapter wired. |

### 4.5 Behavior domain

| Engine | Role | What it does |
| --- | --- | --- |
| `BehavioralPulseEngine` | CONTROL | Pulses behavior selection based on internal rhythms. |
| `CycleEngineGramps` | CONTROL | Long-cycle phase tracking (multi-day). |
| `DailyRhythmLyra` | CONTROL | Day-cycle phase (morning, midday, evening, night). |
| `DriveModelSeed` | CONTROL | Holds drives like "understand user", "rest", "connect". `get_active_drive()` returns the current dominant drive name; `get_state()` returns the full vector. `update_from_interaction(words_learned, satisfaction, quality)` adjusts drives. Typed adapter wired. The conversation context's `driveState` field is built from this engine. |
| `InitiativeSchedulerSeed` | CONTROL | Schedules when initiative kicks in. |
| `LifeSchedulerLyra` | CONTROL | Schedules longer-arc events in life. |
| `SeedDynamics` | CONTROL | Combines seed-tier behavior dynamics. |

### 4.6 Utility domain

| Engine | Role | What it does |
| --- | --- | --- |
| `AgingEngine` | UTILITY | Aging across days, drift in role and traits. |
| `AudioEngine` | UTILITY | Audio synthesis primitives. |
| `AvatarGeneratorLyra` | EXPRESSION | Visual avatar generator. |
| `CharacterVoiceSeed` | EXPRESSION | Voice profile seed. |
| `ContactManagerGramps` | UTILITY | Tracks contacts (other residents this resident knows about). |
| `CuriosityEngineSeed` | UTILITY | Generates curiosity drives. |
| `DashboardEngineBeast` | PASSIVE_MONITOR | Snapshot of bundle health and outputs. |
| `DJMusicEngineBeast` | EXPRESSION | DJ / music selection. |
| `FallbackPhrasesSeed` | UTILITY | Generic phrase store used when nothing else produces a line. |
| `ImageGenerationEngine` | EXPRESSION | Image synthesis (requires API key, otherwise warns and disables internally). |
| `LambdaPsiInstrumentationConnor` | PASSIVE_MONITOR | Lambda/psi instrumentation. |
| `IntentSystem` | UTILITY | Backlog of "things this resident wants to revisit". `add_intent`, `get_top_intent`, `get_intent_prompt_modifier`. Typed adapter wired (creates "Follow up with X about Y" intents from unresolved or tense conversation outcomes). The conversation context's `currentIntent` field is built from this engine. |
| `ObserverClientSeed` | PASSIVE_MONITOR | Observer client for centralized monitoring (no-op in current deployment). |
| `OllamaClientConnor` | UTILITY | Ollama HTTP client used by some connor engines. |
| `SystemLoadBalancer` | UTILITY | Balances internal load across engines. |
| `VisionEngine` | EXPRESSION | Vision processing (camera/image inputs). |
| `VisionModuleGramps` | EXPRESSION | Gramps-tier vision module. |
| `VocabularyEnforcerSeed` | UTILITY | Enforces vocabulary constraints on output. |
| `VoiceModulationEngineBeast` | EXPRESSION | Voice modulation parameters. |
| `WebCrawlerGramps` | UTILITY | Web crawling for new knowledge. |
| `WebLearnerSeed` | UTILITY | Web-learning loop. |
| `WordStoreSeed` | UTILITY | A vocabulary store. Typed adapter wired (extracts words from event summaries). |

---

## 5. How they're meant to work together

The central idea is that no engine is the answer. The answer is what falls out of all of them being asked simultaneously and combined.

### 5.1 Decision synthesis

When the world asks "what should this resident do right now?", the bundle runs a weighted voting aggregation across four sources:

1. **Tick first.** Run the full phase loop so engines update with the current context.
2. **Typed-adapter intent extraction.** For each typed-adapter engine, interpret the cached output via the class-aware `_TYPED_INTENT_METHOD` mapping:
   - `DriveModelSeed` → drive name → intent (`rest`/`tired` → `go_home`; `hunger` → `seek_food`; `connect`/`rapport`/`understand_user` → `seek_social`; etc.)
   - `IntentSystem` → top intent text → intent
   - `GoalEngineGramps` → active goal description → intent (only for clearly-mappable goals)
   - `DailyRhythmLyra` → current phase → intent (`evening`/`night` → `go_home`; etc.)
3. **Capability-driven votes.** For every engine without a typed adapter, the `GenericEngineAdapter.gather_decision_signals` invokes each decision-shaped method (`select_behavior`, `decide`, `recommend_action`, `next_action`, `synthesize_decision`, `choose_action`) and returns the outputs. Each is run through the strict `_normalize_intent` (which now refuses to chase substrings inside `str(some_dict)` to prevent false votes from state-shaped dicts).
4. **Three explicit bias channels.** Recorded as votes from synthetic engines `bias.emotional_pressure`, `bias.personality_consistency`, `bias.world_state_pressure` so they are visible in the breakdown:
   - **Emotional pressure** reads cached emotion-engine state. High anxiety → `go_home`. High anger → `avoid_entity`. High joy → `seek_social`. High sadness → `reflect`.
   - **Personality consistency** reads cached personality traits. Extraversion >0.51 → `seek_social`. Conscientiousness → `pursue_daily_objective`. Curiosity → `wander`. Threshold sits just above default (0.5) so even small trait differences produce divergence.
   - **World-state pressure** reads the snapshot the world handed in. Hunger >0.65 → `seek_food`. Energy <0.28 → `go_home`. (1 - socialTolerance) >0.5 → `seek_social`. Mood `nervous` + low energy → `go_home`. This is what makes two freshly-initialized residents diverge on first tick.
5. **Vote weighting.** `weight = DECISION_PRIORITY[role] * source_bonus[method] * confidence`. Source bonuses: drive surfaces 1.4× (loudest), goal surfaces 1.3×, intent surfaces 1.2×, generic decision methods 1.0×, phase surfaces 0.7×. Bias channels record their own weight directly (no priority multiplier).
6. **Aggregation.** Sum weights per intent. Highest total wins. Ties broken by lexicographic intent name for determinism.
7. **Confidence.** `clamp(0.25, 0.98, share * 0.85 + 0.15)` where `share` is the winning intent's portion of total weight.
8. **Output.** The response now includes a `contributors` list (engine keys whose vote landed on the winning intent), a `contributingEngines` array (full per-engine breakdown with role / method / weight / source bonus, capped at 12 entries), and a `source` flag (`"full_brain_synthesis"` if any engine voted; `"fallback"` otherwise).

The world layer then either follows the suggestion (if confidence ≥ 0.25) or runs its own heuristic. So engines and world both have veto authority: engines must produce a confident intent for it to win, and the world will not follow nonsensical intents.

### 5.2 Conversation context synthesis

When the world asks "build me the conversation context for this resident", the bundle:

1. Runs a tick.
2. Pulls a structured `engineBrainContext` with the **7 core fields** (the LLM prompt spine — deliberately stable to keep `ollamaDialogue.ts` calibrated):
   - `emotionalState` from `EmotionKernelGramps.get_state` (or a peer).
   - `relationshipReasoning` from `RelationalMemorySystem.get_reasoning_summary(3)`.
   - `currentIntent` from `IntentSystem.get_intent_prompt_modifier()` or `get_top_intent()`.
   - `activeGoals` from `GoalEngineGramps.get_active_goals()`.
   - `driveState` from `DriveModelSeed.get_active_drive()` or `get_state()`.
   - `selfNarrative` from `SelfModelGramps.get_traits()`.
   - `recentEpisodes` from `EpisodeMemoryGramps.get_recent_episodes(3)` (or recent events as fallback).
3. Builds a **parallel `extendedContext` array** — does NOT replace the 7 core fields, runs alongside them. Walks `last_engine_outputs`, skips the 7 core engines and passive monitors, summarizes each remaining engine's output via `summarize_engine_output(value, max_chars=120)`, scores by `CONTEXT_PRIORITY[role]` (with a +1 boost when the engine has a state method available), sorts, and caps at 8 entries with per-role caps to prevent flooding (cognition 4, memory 3, personality 3, emotion 3, expression/control/utility 2).
4. Tracks `contextSources` — per-field attribution for every CORE field plus one entry per extendedContext signal (`{ engineKey, field, role }`).
5. Composes prose context lines from the 7 core fields (this part is unchanged).
6. Returns both the structured object and the prose lines.

The conversation prompt (defined in `ollamaDialogue.ts`) places the 7 core fields at the top of the user message and instructs the LLM to make every spoken line visibly reflect them. `extendedContext` is currently surfaced in the HUD only — it is not yet injected into the LLM prompt (token-budget protection). The `contextSources` array is for debug visibility; it makes the source of every prompt-shaping signal traceable.

### 5.3 Event feedback

When the world tells the brain "this conversation just ended like this":

1. The bundle records the event in its short event log.
2. **Tags the event** via `classify_event_tags(event)`. Returns short labels describing what kind of event this is: `<eventType>`, `"social"`, `"emotional"`, `"goal-related"`, `"memory-worthy"`, `"conflict"`, `"positive"`, or `"ambient"`. Stored on `last_event_tags` and exposed in the debug HUD. Tags are informational right now — engines do not gate on them — they exist to make the propagation breadth visible.
3. For every engine with a typed adapter, the `event` phase fires with the structured payload (eventType, summary, spokenLine, partnerId, partnerName, tone, relationshipDelta, topic, mood, socialDelta, resolved).
4. For every engine *without* a typed adapter, the `GenericEngineAdapter.absorb_event(event, ctx)` walks every event-shaped method on the engine (per the cached capability), builds the right argument shape from the event payload (using both name shortcuts — `text`, `tone`, `partner_name`, `user_id` — and type fallbacks), and invokes each one. Per-call exceptions are swallowed.
5. Specific typed adapters route as designed:
   - `RelationalMemorySystem.store_memory(content=spokenLine, role="conversation", symbolic_tags=[topic, "with:<partner>"], emotional_tags=[tone, warming/cooling], emotion_state={valence, arousal, tension})`.
   - `IntentSystem.add_intent("Follow up with <partner> about <topic>", urgency, emotional_weight)` for unresolved or tense outcomes.
   - `DriveModelSeed.update_from_interaction(words_learned=0, user_satisfaction=...derived..., interaction_quality=...derived...)`.
   - `GoalEngineGramps.update_goal_progress` on social-tagged goals.
   - `EmotionKernelGramps.update("reflection", intensity=|relDelta|)` and similar.
   - `SelfModelGramps.append_to_narrative("Event: <summary>")`.

This is the "feedback loop" that closes the world → mind → world circle. Document 7 traces it in real time on a single tick. Document 6 §7.3 covers the post-expansion picture (typed adapters + generic absorption + tagging).

---

## 6. Why so many engines

A reasonable question. The library is large because the hypothesis behind AI City is that reasonably believable cognition emerges from many small specialized modules cooperating, not from one monolithic predictor. Each engine tends to do one thing — track an emotion vector, hold goals, schedule drives — and exposes a small surface area. The cost is the integration burden (typed adapters, phase scheduling, dispatch). The benefit, when it works, is that each resident has an audit trail of what produced their behavior. The conversation context can show "here is the emotional state, here is the active drive, here are the recent episodes," and a human or another agent can reason about why this resident is acting the way they are.

The library was significantly under-used before the engine influence expansion, and Document 6 used to capture that bluntly. After the expansion: roughly 16 engines have typed adapters with sharp output, ~10 more contribute decision votes via the capability registry's generic adapter, ~74 surface state in `extendedContext`, and ~19 absorb events via generic dispatch. **In a smoke run, ~73 of 103 engines now produce captured output per tick.** The gap between "instantiated" and "contributing" has narrowed substantially. The remaining gap — between "contributing" and "shaping the LLM prompt" — is bounded by the 7 core fields plus the choice (currently negative) of whether to inject `extendedContext` into the prompt.

---

## 7. What the engines are not

The engines are not a chat model. They do not, by themselves, write spoken lines. Lines are produced by the conversation prompt path, which is given the engine state as the spine and asks the LLM (when present) or the engine-aware stub (when not) to generate the words.

The engines are not a reinforcement learner. There is no global reward signal driving them. Each engine has its own small dynamics; the bundle synthesizes across them but does not train them.

The engines are not connected to the renderer. They do not know about positions, animations, or the GLB map. They receive sanitized in-world descriptions ("currentAction", "currentGoal", "mood", "energy", "hunger") and produce sanitized outputs.

This separation is deliberate. It is what lets the library be developed and tested independently of the world.
