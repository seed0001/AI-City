# Document 5 — Resident Brain Service

This document describes the Python service that hosts every resident's cognition. It explains why the service exists, how the EngineBundle is structured, how state is isolated per resident, what the lifecycle looks like, and what each HTTP endpoint actually does.

The code lives in `server/residentBrain/`.

---

## 1. Why the service exists

The cognition library (Documents 4 and 6) is Python. It depends on packages — sqlite3, optional torch, optional sentence-transformers, requests for an internal Ollama client, and so on — that are not viable in a browser. The simulation, on the other hand, has to render in a browser to be useful. The service exists to bridge those constraints.

A second reason is isolation. Cognition state for one resident must never contaminate another. If two residents are talking at the same time, each has to think their own thoughts. A single shared Python process can hold per-resident state cleanly; bundling cognition into the front end would force compromises on either isolation or performance.

A third reason is replaceability. The HTTP boundary means the brain service can be swapped — for a different cognition library, a different engine layout, or even a different language — without touching the simulation. The simulation only knows the shape of the wire format.

---

## 2. Process shape

The service is a single FastAPI app served by uvicorn. Default port is `8787`. The browser talks to it over HTTP via `residentBrainAdapter` (see Document 2).

```
server/residentBrain/
  main.py                  FastAPI app + endpoints
  brain_bundle.py          EngineBundle definition (the heart of the service)
  engine_factory.py        discovery, classification, instantiation primitives
  engine_adapters.py       hand-written typed adapters per engine class
  engine_capabilities.py   per-engine method capability registry +
                           GenericEngineAdapter (capability-driven dispatch)
                           + DECISION_PRIORITY / CONTEXT_PRIORITY tables
                           + classify_event_tags
                           + summarize_engine_output
  schemas.py               Pydantic models for HTTP payloads
  state_store.py           per-resident bundle JSON persistence
  state/
    <entityId>.json        bundle envelope state
    engines/<entityId>/<engine_key>.json   per-engine internal state
```

When the service boots, `main.py` calls `engine_factory.ensure_engines_on_path()` to add the `Engines/` directory to `sys.path`. It then constructs a `StateStore` rooted at `state/`. The `BUNDLES` dictionary is empty at boot — bundles are created lazily on first reference.

---

## 3. EngineBundle structure

`EngineBundle` is the central per-resident data structure. One instance exists per resident in the `BUNDLES` dictionary, keyed by `entityId`.

### 3.1 Fields

The relevant fields, paraphrased from the dataclass definition:

| Field | Purpose |
| --- | --- |
| `entity_id` | Stable id; matches the TownEntity `id` in the world layer. |
| `display_name` | Human-readable name, used in summaries. |
| `state` | Free-form per-bundle JSON: snapshot, last event, inherited defaults for children. |
| `events` | Bounded log of recent events received via `recordEvent` (cap 400). |
| `engines` | Dict of `<engine_key>` → engine instance. |
| `inventory` | List of dicts describing each discovered class (active, excluded, or composite). |
| `excluded_classes` | List of dicts for filtered data containers. |
| `engine_contracts` | Per-engine constructor signature, role, package, module. |
| `active_engines` | Dict of `<engine_key>` → metadata for each instantiated, non-disabled engine. |
| `disabled_engines` | Dict of `<engine_key>` → reason string for engines that failed at runtime. |
| `last_engine_outputs` | Per-engine most-recent output captured during phase calls or events. |
| `total_classes_discovered` | Count of classes seen in the engine packages. |
| `total_engines_discovered` | Count of true engines (after data-container filter). |
| `total_engines_instantiated` | Count of engines that constructed successfully. |
| `total_excluded_data_containers` | Count of dataclasses/enums skipped on purpose. |
| `total_composites_wired` | Count of composite engines wired with sibling dependencies. |
| `last_input_event` | Description of the most recent stimulus received (event, decision request, conversation context request). |
| `last_decision_output` | The most recent decision dict. |
| `last_decision_source` | `"full_brain_synthesis"` or `"fallback"`. |
| `last_emotion_summary` / `last_personality_summary` / `last_memory_summary` | Cached short summaries used by debug and as fallbacks for the conversation context. |
| `capabilities` | Per-engine `EngineCapability` map, built once after engines are wired. Each entry lists the engine's decision / state / event / expression methods with cached signature metadata. Used to skip incompatible calls and to drive the generic adapter. |
| `generic_adapters` | Per-engine `GenericEngineAdapter` instances, cached. Stateless beyond the capability reference; does the actual signature-aware invocation for engines without a typed adapter. |
| `last_decision_breakdown` | Per-engine vote info from the last `synthesizeDecision` call: `{ engineKey, role, method, intent, weight, sourceBonus }` for each vote (capped at 60 entries). |
| `last_context_sources` | Which engines fed which fields in the last `synthesizeConversationContext` call. CORE entries cover the 7 named fields; extendedContext entries cover the parallel multi-engine block. |
| `last_event_tags` | Tags assigned by `classify_event_tags` to the most recent event (`"social"`, `"emotional"`, `"memory-worthy"`, `"conflict"`, etc.). |
| `contribution_counters` | Cumulative count of how many times each engine has contributed to a winning decision. Useful for spotting which engines actually drive behavior over a session. |

### 3.2 Construction: `EngineBundle.create(entity_id, snapshot)`

The construction sequence:

1. Allocate an `EngineBundle` with the entity id and display name from the snapshot.
2. Compute the per-resident state directory `state/engines/<entity_id>/`.
3. Call `engine_factory.discover_engine_inventory()` to enumerate every importable class across the six engine packages. Each class is tagged as `is_data_container` (a dataclass, enum, or value record), `is_composite` (one of the advanced-pairing composites that needs sibling injection), or neither.
4. Filter out data containers — they are not engines. They are recorded in `excluded_classes` for transparency.
5. Defer composites for a second pass; instantiate the rest first via `_instantiate_engine`.
6. After regular engines are built, run `_wire_advanced_pairing_composites` to construct the four advanced-pairing composites (`RecompositionEngine`, `ReasoningEngine`, `KnowledgeFusionEngine`, `ReflectionEngine`) with their sibling dependencies (`WordLibrary`, `PatternLibrary`, `FactDatabase`, `ConceptDictionary`, `SentenceParser`).
7. Run `_wire_known_dependencies` to feed dependencies for non-composite engines that need them (e.g. `pulse_engine` needs `emotion_kernel`).
8. Run `_build_capabilities()` to scan every active engine ONCE and produce the per-engine capability registry. Each scan probes ~70 known method names against the engine, records arity and parameter type information, and buckets the methods into `decision_methods` / `state_methods` / `event_methods` / `expression_methods`. The result is cached on `capabilities[key]`. A `GenericEngineAdapter` is then constructed per engine and cached on `generic_adapters[key]`. This is the only expensive step at startup (roughly 3000 method probes for 103 engines), and it is the reason runtime ticks are fast: per-tick dispatch reads cached metadata, never re-inspects.
9. For each successfully instantiated engine, classify its runtime role (`CONTROL`, `MEMORY`, `EMOTION`, `PERSONALITY`, `COGNITION`, `EXPRESSION`, `UTILITY`, `PASSIVE_MONITOR`) by package and class name heuristics. Record the role on `active_engines[key]`.
10. Persist initial bundle state via `state_store.save`.

After construction, `bundle.engines` contains roughly 103 instances per resident, each with its own state directory, and `bundle.capabilities` lists which methods each engine exposes for runtime dispatch.

### 3.3 Per-engine state isolation

This is the critical property the bundle enforces. Each engine that supports loading state is constructed with a state path under `state/engines/<entity_id>/<engine_key>.json`. The factory passes that path into the engine's constructor when the constructor accepts a `state_path` parameter. The engine writes its state to that file when it persists.

The result is that two residents cannot share state. Resident A's `EmotionKernelGramps` reads and writes only to `state/engines/<A>/emotion_emotion_kernel_gramps_emotion_kernel_gramps.json`. Resident B's reads and writes only to its own analog. There is no global shared "feelings" file that both modify.

A small caveat: a few engines in the library write to fixed file names (e.g. `RelationalMemorySystem.get_reasoning_summary` reads from a global `reasoning_chains.json` in the working directory). Those writes are not yet redirected per resident. Document 9 calls this out as known technical debt.

### 3.4 Reload: `EngineBundle.from_state(entity_id, saved)`

When a resident's bundle is requested but no in-memory instance exists, the service tries to load saved JSON from `state/<entity_id>.json` and call `EngineBundle.from_state`. This rehydrates the envelope (counts, inventory, last summaries, last events) and re-instantiates engines from the same per-engine state files. Engines that depend on persistent state (memory, vocabulary, identity) come back with that state; transient engines start fresh.

If no saved JSON exists, the service falls back to `EngineBundle.create(entity_id, snapshot or {})`.

The reload also restores the runtime visibility fields (`last_decision_breakdown`, `last_context_sources`, `last_event_tags`, `contribution_counters`) when present, so the HUD does not flash empty between server restarts. The capability registry is always rebuilt fresh on reload — capabilities are derived from the live engine instances, not cached on disk.

### 3.5 Capability registry + GenericEngineAdapter

The capability registry is the central piece of the engine influence expansion (see Document 10 for the seven-phase upgrade summary). Conceptually:

- A bundle holds 103 engine instances. Each engine exposes some subset of method names: `tick`, `update`, `get_state`, `decide`, `select_behavior`, `record_event`, `process_event`, `recompose_sentence`, etc. Many engines share method names; few engines support all of them.
- Naive dispatch ("call `update` on every engine, ignore exceptions") works but is slow (every call re-inspects the signature) and produces many no-ops.
- The capability registry inspects each engine's methods ONCE at bundle creation time, classifies each method into one of four buckets (decision / state / event / expression), and caches signature metadata: arity, parameter names, parameter type kinds (`dict`, `str`, `int`, `float`, `bool`, `list`, `any`, `unknown`).
- The `GenericEngineAdapter` is a thin per-engine wrapper that holds a reference to the engine and its capability. Its public surface is `gather_state(ctx)`, `gather_decision_signals(ctx)`, `absorb_event(event, ctx)`, and `expression_signal(ctx)`. For each bucket, the adapter walks the engine's known methods, builds the right argument shape from name shortcuts (`ctx`/`context`/`tick_ctx` get the dict; `event`/`event_data` get the event; `text`/`content`/`message` get the primary text; `user_id`/`owner_id` get the entity id; `limit`/`count`/`n` get a small int; etc.) and type fallbacks (`dict`/`any` get the context, `str` gets the primary text, `int` gets 3, `float` gets 0.5), and invokes the method. Per-call exceptions are swallowed so one engine's mismatch never breaks the loop.
- Typed adapters in `engine_adapters.py` always take precedence at call time. The capability registry is consulted only for engines whose class is not in `TYPED_ADAPTERS`. This is the hard rule: the 16 hand-written adapters remain the engines with sharp, type-correct outputs, and the generic adapter is the fallback that lifts every other engine into at least *some* contribution.

The capability registry also publishes two priority tables that the rest of the bundle reads:

- `DECISION_PRIORITY` — `CONTROL > EMOTION > MEMORY > COGNITION > PERSONALITY > EXPRESSION > UTILITY > PASSIVE_MONITOR`. Used by `synthesizeDecision` to weight votes by the role of the contributing engine. CONTROL engines (drives, schedulers, daily rhythm) get the loudest vote, which biases NPC behavior toward "follow the body" rather than "follow the abstract thought."
- `CONTEXT_PRIORITY` — `EMOTION > MEMORY > PERSONALITY > COGNITION > CONTROL > EXPRESSION > UTILITY > PASSIVE_MONITOR`. Different from `DECISION_PRIORITY` on purpose: when assembling conversation context, "how to speak" should be dominated by feelings, memory, personality, and thought, not by which behavioral schedule the resident is in. The two orderings are explicit and named so the divergence is visible.

The `summarize_engine_output(value, max_chars)` helper renders any engine output into a prompt-safe ≤140-char string. Numeric dicts are sorted by absolute magnitude (so `joy=0.6, anxiety=0.3` becomes `joy=0.60, anxiety=0.30`); list outputs render the first few items; arbitrary objects fall back to `str()`. This is the function that turns engine state into the strings the HUD shows and the conversation prompt embeds via `extendedContext`.

---

## 4. The lifecycle

The bundle exposes five lifecycle entry points. Each maps to one or more endpoints. They correspond to the five things the world ever asks the brain to do.

### 4.1 init

Called from the world layer when a resident first comes online (or when the world reconnects after the brain service restarted). The world sends an in-world snapshot: id, display name, role, mood, traits, lifeAdaptation, socialTolerance, energy, hunger, townDaysLived, townRoleOptions, knownAsHuman.

The service either creates a fresh bundle or rehydrates a saved one. It returns:

- `ok` — true if the bundle is healthy.
- `emotionSummary` — short string ("joy=0.0, sadness=0.0, …") rendered from the bundle's last emotion read.
- `brainKind` — `"engine"` (the world flips the entity's `brainKind` based on this).

### 4.2 tick

Called by the simulation periodically (throttled at the bridge) with the current tickContext: `mood`, `energy`, `hunger`, `socialTolerance`, `currentGoal`, `currentAction`, `lifeAdaptation`, `townDaysLived`.

The bundle runs its phase loop:

```
phase: physiology → emotion → memory → personality → cognition →
       behavior → expression → utility
```

For each phase the bundle iterates through every active engine of the relevant role. For each engine it picks the dispatch path:

- If a typed adapter exists for the engine class name, call it with `(engine, phase, context, event={})` and capture the return value into `last_engine_outputs[key]`.
- Otherwise, the bundle uses the cached `GenericEngineAdapter` for that engine. It walks the phase-relevant method names from the bundle's per-phase list (e.g. for `emotion` phase: `update`, `tick`, `process_event`), and for each one, calls `adapter._try(method_info, ctx=context, event=last_event)`. The `MethodInfo` was built once at bundle creation; the adapter does not re-inspect signatures. When no method in the explicit list fires, the adapter falls back to `gather_state(context)` to capture any state read the engine exposes.

The capability registry's most measurable benefit at this layer is **skipping**: engines whose capability has no methods for the current phase are not iterated at all. Where the old generic dispatch would attempt 8 method calls per engine per phase (most failing), the new path either calls a typed adapter, calls one or two known methods, or skips the engine entirely.

After every phase, summary fields update: emotion, personality, and memory summaries are pulled from the most recent compatible engine output. The tick returns `{ ok, emotionSummary, summary }` for the world's debug HUD.

### 4.3 decision

Called when the world wants the resident's next action. The decisionContext payload includes `mood`, `hunger`, `energy`, `socialTolerance`, `currentGoal`, `currentAction`, `nearbyEntityIds`, `homeMarkerKey`, `dailyPlanHeadline`.

`synthesizeDecision` runs a weighted voting aggregation that pulls from four sources:

1. **Tick first.** `tick(decision_ctx)` runs the full phase loop so every engine has fresh state and `last_engine_outputs` reflects current reads.

2. **Typed-adapter intent extraction.** For each engine with a typed adapter, the bundle uses a class-aware mapping (`_TYPED_INTENT_METHOD`) to interpret the cached output:

   - `DriveModelSeed` cached output → `_signal_to_intent_hint("get_active_drive", ...)` maps drive names to intents (rest/sleep/tired → `go_home`; hunger/food → `seek_food`; connect/social/respond/understand_user → `seek_social`; etc.).
   - `IntentSystem` cached output → mapped via the intent hint and the generic `_normalize_intent`.
   - `GoalEngineGramps` cached output → keyword-mapped to intents (rest/sleep/home → `go_home`, eat/food → `seek_food`, meet/social → `seek_social`, objective/task/errand → `pursue_daily_objective`).
   - `DailyRhythmLyra` cached output → phase-mapped (`evening`/`night` → `go_home`, `morning`/`midday` → `pursue_daily_objective`, `afternoon` → `seek_social`).

3. **Capability-driven votes from the rest.** For each engine without a typed adapter, the bundle calls `generic_adapters[key].gather_decision_signals(decision_ctx)`. The adapter invokes the engine's decision-shaped methods (`select_behavior`, `decide`, `recommend_action`, `next_action`, `synthesize_decision`, etc.) and returns `(method_name, raw_output)` pairs. Each output is run through the strict `_normalize_intent` (which now refuses to chase substrings inside `str(some_dict)` to prevent false votes) and `_signal_to_intent_hint` for hint-shaped methods.

4. **Three explicit bias channels:**

   - `_emotional_pressure_bias(ctx)` reads cached emotion-engine state. High anxiety (>0.55) votes `go_home`. High anger votes `avoid_entity`. High joy votes `seek_social`. High sadness votes `reflect`.
   - `_personality_consistency_bias()` reads cached personality traits. Extraversion >0.51 votes `seek_social`. Conscientiousness votes `pursue_daily_objective`. Curiosity votes `wander`. Threshold is intentionally just above default (0.5) so even small trait differences between residents produce divergence.
   - `_world_state_bias(decision_ctx)` reads the snapshot the world handed in. Hunger >0.65 → `seek_food`. Energy <0.28 → `go_home`. (1 - socialTolerance) >0.5 → `seek_social`. Mood `nervous` + low energy → `go_home`. Mood `annoyed`/`angry` → `avoid_entity`. This bias is what makes two freshly-initialized residents diverge on first tick — without it, default-state engines produce the same intent.

5. **Vote weighting.** Each contribution is recorded as:

   ```
   weight = DECISION_PRIORITY[role] * source_bonus[method] * confidence
   ```

   Source bonuses: drive surfaces 1.4× (loudest, per spec), goal surfaces 1.3×, intent surfaces 1.2×, generic decision methods 1.0×, phase surfaces 0.7× (weakest, since rhythm is suggestive not declarative). Bias channels are recorded with their own role and a 1.0× source bonus, so a bias vote = `DECISION_PRIORITY[bias_role] * 3.0 * intensity` for world-state biases (the 3.0 multiplier ensures biases meaningfully participate without dominating typed-adapter votes).

6. **Aggregation.** Sum weights per intent. The intent with the highest total wins. Ties are broken by lexicographic intent name for determinism.

7. **Confidence.** `confidence = clamp(0.25, 0.98, share * 0.85 + 0.15)` where `share` is the winning intent's portion of total weight. Floor of 0.25 ensures the world will follow whenever there was at least one contributor; soft cap of 0.98 because the system is never perfectly certain.

8. **Output.** `last_decision_source = "full_brain_synthesis"` if any engine voted; otherwise `"fallback"`. Returns:

   ```json
   {
     "intent": "seek_social",
     "confidence": 0.481,
     "targetEntityId": null,
     "rationale": "drive=connection rapport; world_state social_urge 0.60",
     "emotionSummary": "trust 0.50, self_worth 0.50, anxiety 0.20",
     "source": "full_brain_synthesis",
     "contributors": ["behavior.drive_model_seed.drive_model_seed", "bias.world_state_pressure"],
     "contributingEngines": [
       { "engineKey": "behavior.drive_model_seed.drive_model_seed",
         "role": "CONTROL", "method": "typed:get_active_drive",
         "weight": 9.80, "sourceBonus": 1.4 },
       { "engineKey": "bias.world_state_pressure",
         "role": "CONTROL", "method": "snapshot",
         "weight": 0.99, "sourceBonus": 1.0 }
     ]
   }
   ```

   The full per-engine breakdown is stored on `last_decision_breakdown` (capped at 60 entries) and also exposed in the `/brains/{entityId}/debug` endpoint as `decisionBreakdown`. Every contributor is updated in `contribution_counters` so over a session the HUD can show which engines actually drive behavior.

The world layer reads `intent`, `confidence`, and `targetEntityId`, then either follows or falls back, as described in Document 3.

### 4.4 conversation context

Called when the world wants the resident's conversation context. The conversationContext payload includes `mood`, `role`, `currentGoal`, `otherEntityId` (the other speaker), `dailyHeadline`.

`synthesizeConversationContext`:

1. Calls `tick(ctx)`.
2. Calls `_build_engine_brain_context(ctx)` which directly queries seven specific engines (with safe-call wrappers) to assemble the seven core fields documented in Document 4 Section 5.2. **The 7 core fields are deliberately stable** — they are the LLM prompt spine, and `ollamaDialogue.ts` is calibrated against them. Adding fields here would balloon the prompt and reduce per-turn quality.
3. Calls `_build_extended_context(ctx)` which **does not replace the 7 core fields** — it produces a parallel `extendedContext` array. The function:
   - Walks `last_engine_outputs` (cached during the tick).
   - Skips engines in `_CORE_CONTEXT_KEYS` (the 7 named engines, to avoid double-counting).
   - Skips `PASSIVE_MONITOR` and disabled engines.
   - For each remaining engine with non-None output, summarizes the output via `summarize_engine_output(value, max_chars=120)`.
   - Scores each by `relevance_score(role)` (uses `CONTEXT_PRIORITY`, which orders `EMOTION > MEMORY > PERSONALITY > COGNITION > CONTROL > EXPRESSION > UTILITY`). Engines with a `state` method available get a +1 boost.
   - Sorts by `(-relevance, engineKey)` for determinism.
   - Caps at 8 total entries, with per-role caps to prevent any role flooding (`COGNITION: 4, MEMORY: 3, PERSONALITY: 3, EMOTION: 3, EXPRESSION: 2, CONTROL: 2, UTILITY: 2`).
4. Tracks `last_context_sources` — a list of `{ engineKey, field, role }` describing both CORE entries (per-field per-engine attribution for the 7 core fields) and extendedContext entries.
5. Composes prose context lines that merge the 7 core fields with last emotion / personality / memory summaries (this part is unchanged).
6. Returns:

```json
{
  "contextLines": [...seven prose lines...],
  "moodLine": "...",
  "intentionLine": "...",
  "memoryLine": "...",
  "emotionSummary": "...",
  "engineBrainContext": {
    "emotionalState": "trust 0.50, self_worth 0.50, anxiety 0.20",
    "relationshipReasoning": "...",
    "currentIntent": "Previously wanted to: Follow up with Bex about tension",
    "activeGoals": "...",
    "driveState": "understand user",
    "selfNarrative": "Ada sees themself as confidence 0.50, uncertainty 0.00",
    "recentEpisodes": ["..."],
    "extendedContext": [
      { "engineKey": "emotion.mental_health_beast.mental_health_engine_beast",
        "className": "MentalHealthEngineBeast", "role": "EMOTION",
        "summary": "depression=0.00, mania=0.00, ptsd=0.00, withdrawal=0.00",
        "relevance": 18 },
      { "engineKey": "memory.memory_reconciliation_gramps.memory_reconciliation_engine_gramps",
        "className": "MemoryReconciliationEngineGramps", "role": "MEMORY",
        "summary": "reconciliation_active=0.00, onboarding_active=0.00, ...",
        "relevance": 17 },
      { "engineKey": "personality.personality_seed.personality_seed",
        "className": "PersonalitySeed", "role": "PERSONALITY",
        "summary": "patience=0.70, curiosity_level=0.50, verbosity=0.50",
        "relevance": 16 }
      // up to 8 entries
    ]
  },
  "extendedContext": [ /* same array as engineBrainContext.extendedContext, flat */ ],
  "contextSources": [
    { "engineKey": "memory.relational_memory_system.relational_memory_system",
      "field": "relationshipReasoning", "role": "CORE" },
    { "engineKey": "utility.intent_system.intent_system",
      "field": "currentIntent", "role": "CORE" },
    /* ...other CORE entries... */
    { "engineKey": "emotion.mental_health_beast.mental_health_engine_beast",
      "field": "extendedContext", "role": "EMOTION" }
    /* ...other extended entries... */
  ]
}
```

The world places the 7 core `engineBrainContext` fields at the spine of the LLM prompt; the prose lines are used by the broader world-context projection. `extendedContext` is currently surfaced in the HUD only — the LLM prompt does not yet read from it (token-budget protection). A future experiment may inject a small slice of `extendedContext` (top 3 by relevance) into the prompt to test whether dialogue richness improves enough to justify the token cost.

### 4.5 event recording

Called whenever the world has something to tell the brain: a memory event, a conversation outcome, an arrival, a relationship change. The event payload always includes an `eventType` and at minimum a `summary`. For conversation outcomes specifically, the payload includes `spokenLine`, `tone`, `partnerId`, `partnerName`, `topic`, `mood`, `socialDelta`, `relationshipDelta`, `resolved`.

`recordEvent`:

1. Stores the event on `last_input_event` and pushes it onto `events` (cap 400).
2. Refreshes `last_memory_summary` from the event summary.
3. **Tags the event** via `classify_event_tags(event)`. The function returns a list of short tags describing what kind of event this is, based on the event payload:
   - `<eventType>` (always, if non-empty: e.g. `"conversation_outcome"`)
   - `"social"` if the event has a partner or is a conversation outcome
   - `"emotional"` if `|relationshipDelta| > 0.04` or `|socialDelta| > 0.04` or `|emotionalImpact| > 0.04`
   - `"goal-related"` if the summary or eventType implies a goal/objective
   - `"memory-worthy"` for any event with a meaningful summary or one of the canonical memory-creating eventTypes
   - `"conflict"` if `relationshipDelta < -0.1` or eventType is `avoidance`/`conflict`/`tension`
   - `"positive"` if `relationshipDelta > 0.1` or eventType is `praise`/`warmth`
   - `"ambient"` if no other tag fired
   The tags are stored on `last_event_tags` and exposed in the debug endpoint. Currently they are informational — engines do not gate on them. They make the propagation breadth visible in the HUD.
4. **Routes the event to every engine.** For each active engine:
   - If a typed adapter exists for the engine class, call it with `(engine, "event", ctx, event)`. The 6 adapters that actually do work on `conversation_outcome` events are listed in Doc 6 §7.3. Any non-None return is captured into `last_engine_outputs[key]`.
   - Otherwise, call `generic_adapters[key].absorb_event(event, ctx)`. The generic adapter walks every event-shaped method on the engine (per the cached capability), builds the right argument shape from the event payload, and invokes each one. Per-call exceptions are swallowed; one engine's signature mismatch never breaks propagation. The last non-None output is captured.
5. The `_disable(key, reason)` path is reserved for catastrophic failures (the call site itself raised). Routine "this engine doesn't have a method that fits this event" is silent — that is the expected case for ~30 engines.

Document 4 Section 5.3 gives the per-engine routing detail for the typed-adapter cohort. Document 6 §7.3 covers the post-expansion picture (typed adapters + generic absorption + tagging).

### 4.6 child seeding

When two residents reproduce, the world calls `/brains/child` with the two parent ids and the child's seed snapshot. The bundle's `child_seed_defaults(other, child_seed, parent_a_summary, parent_b_summary)` method:

1. Pulls a story-of-self bias from each parent's relevant engines.
2. Suggests inherited traits drawn from both parents' trait pools, with light random mixing.
3. Suggests defaults for the child's mood, role, and starting drives.
4. Returns `{ childBrainSummary, inheritedTraitSuggestions, defaults }`.

The service stores these on the child's bundle as `inherited_defaults` and `inheritedTraitSuggestions`. The child then ticks normally from this seeded state.

Document 8 covers lineage in detail.

---

## 5. The HTTP endpoints

All endpoints live on the FastAPI app `Resident Brain Service`. Detailed contracts are defined in `schemas.py` (Pydantic) and mirrored in `src/systems/citySim/brains/residentBrainClient.ts` (TypeScript).

### 5.1 GET `/health`

Returns service health and aggregate counts. Used by the bridge's `refreshHealth()` to decide whether the brain is reachable.

```json
{
  "ok": true,
  "bundles": 7,
  "enginesPaths": ["C:/.../Engines"],
  "activeEngineCount": 721,
  "disabledEngineCount": 0
}
```

`activeEngineCount` is the sum across all bundles in memory (so 7 residents × ~103 engines each = roughly 721 when a full town is loaded). `disabledEngineCount` should be zero in healthy operation.

### 5.2 POST `/brains/init`

Body:

```json
{
  "entityId": "npc_bob",
  "snapshot": { "displayName": "Bob", "role": "Cashier", "traits": ["practical"], "mood": "calm", ... }
}
```

Behavior: `get_or_create(entityId, snapshot)`. Persists. Returns `{ ok, emotionSummary, brainKind }`.

The world's bridge calls this for every AI resident (and every network player) at spawn time and any time it detects the brain is online but the resident is still `brainKind === "local"`.

### 5.3 POST `/brains/update`

Body:

```json
{
  "entityId": "npc_bob",
  "tickContext": { "mood": "calm", "energy": 0.62, "hunger": 0.38, ... }
}
```

Behavior: `bundle.tick(tickContext)`. Persists. Returns the tick output dict (includes `ok`, `emotionSummary`, `summary`).

The bridge throttles this per-entity at `UPDATE_INTERVAL_MS` (2.5 seconds at time of writing).

### 5.4 POST `/brains/decision`

Body:

```json
{
  "entityId": "npc_bob",
  "decisionContext": { "mood": "calm", "energy": 0.62, "hunger": 0.38, "nearbyEntityIds": ["npc_mina"], "homeMarkerKey": "home_bob", "dailyPlanHeadline": "Run errands and check in" }
}
```

Behavior: `bundle.synthesizeDecision(decisionContext)`. Persists. Returns:

```json
{
  "intent": "seek_food",
  "confidence": 0.42,
  "targetEntityId": null,
  "rationale": "drive=hunger pressure (0.6); intent=Visit the bakery; rhythm=midday",
  "emotionSummary": "trust 0.5, anxiety 0.21",
  "source": "full_brain_synthesis",
  "contributors": [
    "behavior.drive_model_seed.drive_model_seed",
    "bias.world_state_pressure"
  ],
  "contributingEngines": [
    {
      "engineKey": "behavior.drive_model_seed.drive_model_seed",
      "role": "CONTROL",
      "method": "typed:get_active_drive",
      "intent": "seek_food",
      "weight": 9.80,
      "sourceBonus": 1.4
    },
    {
      "engineKey": "bias.world_state_pressure",
      "role": "CONTROL",
      "method": "snapshot",
      "intent": "seek_food",
      "weight": 1.47,
      "sourceBonus": 1.0
    }
  ]
}
```

`contributors` is the list of unique engine keys whose vote landed on the winning intent. `contributingEngines` is the full per-engine breakdown for HUD/debug (capped at 12 entries). `source` is `"full_brain_synthesis"` whenever any engine voted, otherwise `"fallback"`.

The bridge throttles this at `DECISION_INTERVAL_MS` (1.8 seconds) and caches one suggestion per entity for up to 4.5 seconds. The DecisionSystem on the world side consumes the cached suggestion when it next runs, applies the intent, and clears the cache.

### 5.5 POST `/brains/conversation-context`

Body:

```json
{
  "entityId": "npc_bob",
  "conversationContext": { "mood": "calm", "role": "Cashier", "currentGoal": "Stay alert at the counter", "otherEntityId": "npc_mina", "dailyHeadline": "Run errands and check in" }
}
```

Behavior: `bundle.synthesizeConversationContext(conversationContext)`. Persists. Returns the structured response described in Section 4.4. The response now includes:

- The 7 core `engineBrainContext` fields (unchanged shape — what the LLM prompt reads from).
- `engineBrainContext.extendedContext` — up to 8 ranked engine summaries from the wider engine state.
- A flat `extendedContext` array at the top level (same content as `engineBrainContext.extendedContext`, easier for the HUD to consume).
- A `contextSources` array attributing every prompt-shaping signal to a specific engine.

The bridge's `awaitConversationContext` calls this with a 1.5 second freshness cache and a 6 second timeout. The result is required by the conversation packet builder when the brain service is online; the conversation system will not skip this call. The TypeScript client (`residentBrainClient.ts`) types `extendedContext` and `contextSources` as optional, so older brain services degrade gracefully without breaking the world side.

### 5.6 POST `/brains/event`

Body:

```json
{
  "entityId": "npc_bob",
  "event": {
    "actorId": "npc_bob",
    "participants": ["npc_bob", "npc_mina"],
    "locationId": "park_central",
    "eventType": "conversation_outcome",
    "summary": "Bob and Mina shared a quick word at the bench",
    "emotionalImpact": -0.018,
    "timestamp": 1745883291432,
    "relationshipDelta": 0.06,
    "resolved": true,
    "spokenLine": "Hey - good to see you out here.",
    "topic": "greeting",
    "mood": "calm",
    "socialDelta": 0.03,
    "partnerId": "npc_mina",
    "partnerName": "Mina"
  }
}
```

Behavior: `bundle.recordEvent(event)`. Persists. Returns `{ ok: true }`. This call is fire-and-forget from the world's perspective; the bridge does not retry on failure.

### 5.7 POST `/brains/child`

Body:

```json
{
  "parentAId": "npc_bob",
  "parentBId": "npc_mina",
  "childSeed": { "id": "npc_child_a1b2c3", "displayName": "BobMin-42", "role": "Young resident", "traits": ["adaptable", "curious"], "mood": "calm" },
  "parentASummary": { "mood": "calm", "role": "Cashier", "traits": ["practical"], "lastBrainEmotion": "..." },
  "parentBSummary": { "mood": "calm", "role": "Neighbor", "traits": ["watchful"], "lastBrainEmotion": "..." }
}
```

Behavior: `get_or_create` for each parent and the child; call `parent_a.child_seed_defaults(...)`. Persist all three. Return:

```json
{
  "childBrainSummary": "...",
  "inheritedTraitSuggestions": ["adaptable", "curious", "watchful"],
  "defaults": { "drive_bias": "connection", "starting_self_narrative": "..." }
}
```

The world stores `defaults` on the child's bundle and uses `inheritedTraitSuggestions` to seed the child's TownEntity traits.

### 5.8 GET `/brains/{entityId}/debug`

The most expensive endpoint. Returns the full debug snapshot for the bundle, now including the Phase 7 visibility additions:

```json
{
  "entityId": "npc_bob",
  "displayName": "Bob",
  "totalClassesDiscovered": 119,
  "totalEnginesDiscovered": 103,
  "totalEnginesInstantiated": 103,
  "totalExcludedDataContainers": 16,
  "totalCompositesWired": 4,
  "activeEnginesByRole": {
    "CONTROL": ["..."],
    "EMOTION": ["..."]
  },
  "activeEngines": { "<key>": { "class": "...", "module": "...", "runtimeRole": "..." } },
  "disabledEngines": { "<key>": "<reason>" },
  "inventory": [ /* every engine row */ ],
  "excludedClasses": [ /* every excluded data container row */ ],
  "typedAdaptersAvailable": [ "EmotionKernelGramps", "ConnorStateBeast" ],
  "lastOutputByEngine": { "<key>": "<last captured output>" },
  "lastInputEvent": { },
  "lastDecisionOutput": { "intent": "seek_social", "confidence": 0.481 },
  "lastDecisionSource": "full_brain_synthesis",
  "lastEmotionSummary": "trust 0.50, anxiety 0.20",
  "lastPersonalitySummary": "...",
  "lastMemorySummary": "...",

  "capabilities": {
    "behavior.drive_model_seed.drive_model_seed": {
      "engineKey": "behavior.drive_model_seed.drive_model_seed",
      "class": "DriveModelSeed",
      "role": "CONTROL",
      "decisionMethods": ["get_active_drive"],
      "stateMethods": ["get_state"],
      "eventMethods": ["update_from_interaction"],
      "expressionMethods": []
    }
  },

  "contributingEngines": [
    "behavior.drive_model_seed.drive_model_seed",
    "emotion.emotion_kernel_gramps.emotion_kernel_gramps",
    "memory.memory_manager_lyra.memory_manager_lyra"
  ],

  "silentEngines": [
    "utility.web_crawler_gramps.web_crawler_gramps",
    "utility.audio_engine.audio_engine"
  ],

  "decisionBreakdown": [
    {
      "engineKey": "behavior.drive_model_seed.drive_model_seed",
      "role": "CONTROL",
      "method": "typed:get_active_drive",
      "intent": "seek_social",
      "weight": 9.80,
      "sourceBonus": 1.4
    },
    {
      "engineKey": "bias.world_state_pressure",
      "role": "CONTROL",
      "method": "snapshot",
      "intent": "seek_social",
      "weight": 0.99,
      "sourceBonus": 1.0
    }
  ],

  "contextSources": [
    { "engineKey": "memory.relational_memory_system.relational_memory_system",
      "field": "relationshipReasoning", "role": "CORE" },
    { "engineKey": "emotion.mental_health_beast.mental_health_engine_beast",
      "field": "extendedContext", "role": "EMOTION" }
  ],

  "lastEventTags": ["conversation_outcome", "social", "emotional", "memory-worthy"],

  "contributionCounters": {
    "behavior.drive_model_seed.drive_model_seed": 12,
    "bias.world_state_pressure": 8,
    "utility.intent_system.intent_system": 5
  }
}
```

The world's HUD (`ResidentBrainDebugSection.tsx`) polls this every five seconds for the currently focused resident. As of the Phase 7 visibility upgrade, the HUD now shows the inline `contributing/silent` count, `lastEventTags`, the top-4 of `decisionBreakdown` per resident, and (in the expanded view) the silent-engine list, the contribution counters, and the conversation context sources.

All Phase 7 fields are typed as optional in `residentBrainClient.ts`. An older brain service that does not return them will still satisfy the type contract; the HUD simply skips those panels.

---

## 6. The state on disk

Two layers of state persist:

- **Bundle envelope**: `state/<entityId>.json`. This is the bundle's own JSON: events, last summaries, counts, inventory, decision source. Used to rehydrate bundles when the service restarts.
- **Per-engine state**: `state/engines/<entityId>/<engine_key>.json`. This is each engine's internal state, written by the engine itself when it persists. Used to rehydrate the engine's specific state.

`state_store.save(entity_id, bundle.to_state())` writes the envelope after every endpoint call that mutates state. Engines that auto-save (most of the gramps and beast tier) write their own files when their internal save threshold is hit.

A practical note: on a clean reset (or when an engine's serialization format changes), it is sometimes useful to delete `state/engines/<entityId>/` for a resident to force every engine to come back fresh. The `start_dev.py` launcher exposes a `--reset-state` flag for this.

---

## 7. Concurrency and ordering

The service is single-process FastAPI. Calls do not block each other at the HTTP layer (uvicorn + asyncio), but each bundle's mutations are not formally serialized. In practice, the world's bridge throttles calls per-entity to one in flight at a time, which keeps the per-bundle ordering reasonable. There is no formal lock, and the bundle is not designed to be hammered concurrently for a single entity.

Multiple residents being ticked concurrently is fine. Each bundle is independent.

---

## 8. Extending the service

Adding a new typed adapter for an existing engine is the most common extension and produces the sharpest output. The pattern is:

1. Open `engine_adapters.py`.
2. Write a function `adapter_<engine_name>(eng, phase, ctx, event)` that returns the most representative output for each phase the engine cares about.
3. Add it to the `TYPED_ADAPTERS` dict with the class name as key.
4. (For decision-shaped engines) optionally add an entry to `_TYPED_INTENT_METHOD` in `brain_bundle.py` so the typed-adapter cached output is interpreted via the right intent mapper. Without this entry, the bundle still uses the typed adapter for state/event work, but the engine's intent contribution defaults to whatever `_normalize_intent` can extract from the cached output.
5. Restart the service. The bundle's phase tick will prefer the adapter automatically. The capability scan still inspects the engine for visibility, but the typed adapter wins at call time.

Adding a new engine class is similar:

1. Drop the file under `Engines/<package>/`.
2. Make sure the class is importable and exposes a stable constructor signature (ideally accepting an optional `state_path: str` for per-resident isolation).
3. Restart. The factory will discover and instantiate it. The capability scan will pick up its decision/state/event/expression methods from the known method-name vocabulary in `engine_capabilities.py` and the `GenericEngineAdapter` will start invoking them per phase, with no further code required. If you want sharp, type-correct output (especially for event handling or intent-shaped decision votes), write a typed adapter in the same step.

If your new engine has unconventional method names (not in `DECISION_METHOD_NAMES` / `STATE_METHOD_NAMES` / `EVENT_METHOD_NAMES` / `EXPRESSION_METHOD_NAMES`), add the names to those tuples in `engine_capabilities.py` so the capability scan picks them up.

Adding a new endpoint requires a Pydantic schema in `schemas.py`, a route handler in `main.py`, and a corresponding TypeScript client function in `residentBrainClient.ts`.

---

## 9. What the service is not

The service is not a model. It does not generate text. It does not call out to OpenAI, Anthropic, or a hosted Ollama. The only network call it makes is to its internal Ollama client (when configured), and that is used by certain Connor engines for their own internal reasoning, not as the primary speech path. The browser's conversation system is what calls Ollama for spoken lines.

The service does not own the world. It cannot tell the simulation to move a resident or end a conversation. Those decisions live in the world layer, which uses the service's outputs as suggestions.

The service does not enforce real-time guarantees. It is allowed to take a few hundred milliseconds to answer a decision request. The bridge's caching and throttling absorb that latency. If the service is slow or unreachable, the simulation falls back gracefully.

This boundary is what lets the cognition library evolve underneath the world without breaking it. Document 6 makes that boundary tangible by listing exactly which engines are currently load-bearing inside the service.
