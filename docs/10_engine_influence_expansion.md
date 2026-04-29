# Document 10 — Engine Influence Expansion

This document is the change record for the seven-phase upgrade that converted the brain bundle from "16 active brains + 87 passengers" into "16 typed adapters + ~73 capability-driven contributors." It is written so that someone reading just this document can understand *what changed*, *why it changed*, *what it preserves*, and *where the seams are*.

This is a companion to Documents 4, 5, 6, 7, and 9, which were updated in lock-step. Where those documents describe the post-expansion system as-is, this document describes the transition.

---

## 1. Why this work happened

Before the expansion, Document 6's headline was honest: out of 103 engines per resident, 16 had typed adapters that meaningfully shaped decision / conversation context / event feedback, and the remaining 87 were "passengers" — instantiated, ticked, persisted, but contributing little to observable behavior.

The hypothesis behind AI City has always been that believable cognition emerges from many small specialized modules cooperating. The library was built that way. The integration layer wasn't keeping up. Two failure modes existed simultaneously:

1. **Naive generic dispatch was too greedy and too dumb.** Calling `update` or `get_state` on every engine each phase produced many no-ops, occasional crashes, and signature-mismatch exceptions that disabled engines for the rest of the session.
2. **The decision pipeline only listened to a handful of engines.** Most engines had no way to vote on `synthesizeDecision`, so even when they had relevant state, it didn't reach the world layer.

The user's seven-phase spec was the answer: discover what each engine can do, generate fallback adapters that call methods safely, lift the aggregation layers (decision and conversation context) so they can pull from many engines at once, propagate events to all engines instead of just typed ones, and surface the breadth of contribution in the debug HUD.

---

## 2. What the seven phases delivered

### Phase 1 — Engine discovery + classification

Added `engine_capabilities.py` with:

- `EngineCapability` dataclass: per-engine map of `decision_methods`, `state_methods`, `event_methods`, `expression_methods`. Each list holds `MethodInfo` records with cached signature metadata (arity, parameter names, parameter type kinds).
- `discover_capability(engine, key, class, role)` — probes an engine for ~70 known method names and buckets each into one of the four categories.
- `build_capability_registry(engines, active_engines)` — runs the discovery across a whole bundle. Called once at bundle creation.
- Four method-name vocabularies (`DECISION_METHOD_NAMES`, `STATE_METHOD_NAMES`, `EVENT_METHOD_NAMES`, `EXPRESSION_METHOD_NAMES`) — extensible at the top of the file.

Cost: ~3000 method probes at startup for a 103-engine bundle. Zero per-tick cost — runtime ticks read cached metadata.

### Phase 2 — Auto-adapter generation

Added the `GenericEngineAdapter` class in the same module. Per-engine, holds a reference to the engine and its capability. Public surface:

- `gather_state(ctx)` → returns `(method_name, output)` for the first state method that returns non-None.
- `gather_decision_signals(ctx)` → returns `[(method_name, output), ...]` for every decision-shaped method that produces output.
- `absorb_event(event, ctx)` → fires every event-shaped method that we can satisfy, swallows per-call exceptions, returns the last non-None output.
- `expression_signal(ctx)` → pulls a single expression-shaped output for `extendedContext`.

The `_coerce_for(method, ctx, event, primary_text)` helper builds the right argument shape from a method's required parameters, using:

- **Name shortcuts** that beat type-based matching: `ctx`/`context`/`tick_ctx` → ctx dict; `event`/`event_data` → event dict; `text`/`content`/`message` → primary text; `tone`/`mood` → event tone or mood; `user_id`/`owner_id`/`entity_id` → entity id; `limit`/`count`/`n` → 3; `seconds`/`delta`/`elapsed` → 1; `intensity`/`weight` → 0.5; `role` → "system".
- **Type fallbacks**: `dict`/`any` → ctx; `str` → primary text; `int` → 3; `float` → 0.5; `bool` → False; `list` → [].
- **Skip when unsatisfiable**: if a required parameter is `unknown` and has no name shortcut, the call is skipped rather than guessed.

Hard rule preserved: typed adapters in `engine_adapters.py` always take precedence at call time. The capability registry is consulted only for engines whose class is not in `TYPED_ADAPTERS`. The 16 hand-written adapters were not modified.

### Phase 3 — Decision integration

Rewrote `synthesizeDecision` in `brain_bundle.py`. The new flow collects votes from four sources:

1. **Typed-adapter intent extraction** with class-aware mapping (`_TYPED_INTENT_METHOD`):
   - `DriveModelSeed` → `_signal_to_intent_hint("get_active_drive", ...)`
   - `IntentSystem` → `get_top_intent` mapper
   - `GoalEngineGramps` → `get_active_goals` mapper
   - `DailyRhythmLyra` → `get_current_phase` mapper
2. **Capability-driven votes** for every other engine via `gather_decision_signals` + strict `_normalize_intent`.
3. **Three explicit bias channels** recorded as votes from synthetic engine keys (so they appear in the breakdown):
   - `bias.emotional_pressure` reads cached emotion-engine state.
   - `bias.personality_consistency` reads cached personality traits.
   - `bias.world_state_pressure` reads the snapshot the world handed in (hunger / energy / socialTolerance / mood).
4. **Vote weighting**: `weight = DECISION_PRIORITY[role] * source_bonus[method] * confidence`. Source bonuses (per spec): drive 1.4×, goal 1.3×, intent 1.2×, generic decision 1.0×, phase 0.7×.

Output now includes:

- `contributors` — engine keys whose vote landed on the winning intent.
- `contributingEngines` — full per-engine breakdown with role, method, weight, source bonus.
- `source` — `"full_brain_synthesis"` or `"fallback"`.
- `last_decision_breakdown` on the bundle — full vote ledger (capped at 60 entries).

`_normalize_intent` was tightened in the same phase: it now refuses to chase substrings inside `str(some_dict)`, so a state-shaped dict containing the substring `"idle"` no longer produces a false `idle` vote. This was the bug that initially had both residents converging on the same intent in early smoke runs.

### Phase 4 — Conversation context expansion

Added `_build_extended_context(ctx, limit=8)` to `brain_bundle.py`. Walks `last_engine_outputs`, skips the 7 core engines and passive monitors, summarizes each remaining engine's output via `summarize_engine_output(value, max_chars=120)`, scores by `relevance_score(role)` (which uses `CONTEXT_PRIORITY`), and caps at 8 with per-role caps to prevent flooding.

Output now includes:

- `engineBrainContext.extendedContext` — array of `{ engineKey, className, role, summary, relevance }`.
- A flat `extendedContext` at the top level of the response (same content, easier for the HUD).
- `contextSources` — per-field attribution for every CORE field plus one entry per extendedContext signal.

**The 7 core fields were not touched.** They remain the LLM prompt spine. Adding fields to `engineBrainContext` would have broken the calibration in `ollamaDialogue.ts` and bloated the prompt. The expansion is parallel, not nested.

This was the design call I flagged before implementation. Doc 6 §7.2 and Doc 4 §5.2 now describe both layers.

### Phase 5 — Event propagation upgrade

Rewrote `recordEvent` to:

1. Tag the event via `classify_event_tags(event)` before propagation. Tags: `<eventType>`, `"social"`, `"emotional"`, `"goal-related"`, `"memory-worthy"`, `"conflict"`, `"positive"`, `"ambient"`. Stored on `last_event_tags` and exposed in the debug HUD.
2. Fire typed adapters first (unchanged for the 6 conversation-outcome adapters).
3. For every other engine, call `generic_adapters[key].absorb_event(event, ctx)`. The adapter walks every event-shaped method on the engine, builds the right argument shape from the event payload, invokes each one, and swallows per-call exceptions.

The `_disable(key, reason)` path is reserved for catastrophic failures only. Routine "this engine doesn't have a method that fits this event" is silent — the expected case for the ~30 engines without event surfaces.

### Phase 6 — Priority system

Added two priority tables in `engine_capabilities.py`, deliberately ordered differently:

- `DECISION_PRIORITY`: `CONTROL > EMOTION > MEMORY > COGNITION > PERSONALITY > EXPRESSION > UTILITY > PASSIVE_MONITOR`. Used by `synthesizeDecision`. CONTROL engines (drives, schedulers, daily rhythm) get the loudest decision vote.
- `CONTEXT_PRIORITY`: `EMOTION > MEMORY > PERSONALITY > COGNITION > CONTROL > EXPRESSION > UTILITY > PASSIVE_MONITOR`. Used by `synthesizeConversationContext` for `extendedContext` ranking. Different from decision priority: when shaping voice, feelings and memory should dominate.

Two priority tables, not one. This was the second design call I flagged. The two orderings encode two different intents — one for "what to do next," one for "how to speak."

### Phase 7 — Debug + visibility

Expanded `debug_snapshot()` to include:

- `capabilities` — per-engine capability map (decision/state/event/expression methods).
- `contributingEngines` — list of engine keys with captured output.
- `silentEngines` — list of active engines with no captured output.
- `decisionBreakdown` — full vote ledger from the last decision.
- `contextSources` — engine-by-field attribution for the last conversation context.
- `lastEventTags` — tags from the last event.
- `contributionCounters` — top 30 engines by cumulative contribution count.

Exposed in the FastAPI `/brains/{entityId}/debug` endpoint, mirrored in the TypeScript client (`residentBrainClient.ts`), and surfaced in the HUD (`ResidentBrainDebugSection.tsx`):

- Inline per-resident: `contributing/silent` count, `lastEventTags`, top-4 `decisionBreakdown`.
- Expanded view: silent-engine list (top 30), contribution counters (top 8), conversation context sources (top 12).

All Phase 7 fields are typed as optional in TypeScript, so an older brain service that does not return them does not break the type contract or the HUD.

---

## 3. What this preserves (the hard rules)

The user's spec listed four hard rules. All preserved:

1. **Never remove existing typed adapters.** All 16 entries in `TYPED_ADAPTERS` are unchanged. Their adapter functions are unchanged. The bundle still calls them first, before any capability-driven fallback.
2. **Never break existing decision flow.** The decision endpoint contract is backward-compatible: the original fields (`intent`, `confidence`, `targetEntityId`, `rationale`, `emotionSummary`) still appear with the same semantics. The new fields (`contributors`, `contributingEngines`, `source`) are additive.
3. **Never allow one engine to dominate completely.** The vote-weighting is bounded: every engine's vote is `priority * source_bonus * confidence`, with priority capped at 7 (CONTROL) and source_bonus capped at 1.4 (drive). Bias channels are recorded as votes too, with their own labels. No single engine can produce a vote that swamps the entire ledger.
4. **Fail safe, not fail hard.** The `GenericEngineAdapter` swallows per-call exceptions. The bundle's `_disable(key, reason)` path is reserved for catastrophic failures (the call site itself raised) — routine method-mismatch is silent. The decision pipeline always returns *something*: `"fallback"` with intent `"idle"` and confidence 0.0 when no engine voted.

---

## 4. What was measured

A two-resident smoke test (`server/residentBrain/_phase_engine_upgrade_smoke.py`) ran with two contrasting snapshot inputs:

- **Resident A (Ada)**: extraverted, hungry (0.7), mid-energy, mood=calm, social.
- **Resident B (Bex)**: reserved, tired (energy=0.18), low social tolerance, mood=nervous.

Results after one full lifecycle (tick + decision + conversation context + event propagation):

```
CAPABILITIES SUMMARY
  103 engines scanned per resident
  decision-method capable engines: 10
  state-method   capable engines: 74
  event-method   capable engines: 19

DECISION — Resident A (hungry, social)
  intent      = seek_social
  confidence  = 0.481
  contributors = [drive_model_seed, bias.world_state_pressure]

DECISION — Resident B (tired, withdrawn)
  intent      = idle
  confidence  = 0.447
  contributors = [initiative_scheduler, life_scheduler, action_engine]

CONVERSATION CONTEXT — Resident A
  7 core fields populated
  extendedContext: 8 ranked summaries spanning EMOTION / MEMORY / PERSONALITY / COGNITION
  contextSources: 15 entries (CORE + extended)

EVENT — Resident A receives a warm conversation_outcome
  lastEventTags = ['conversation_outcome', 'social', 'emotional', 'memory-worthy']

EVENT — Resident A receives a tense conversation_outcome
  lastEventTags = ['conversation_outcome', 'social', 'emotional', 'memory-worthy', 'conflict']
  IntentSystem.add_intent fired → next currentIntent = 'Follow up with Bex about tension'

ACCEPTANCE
  unique influencing engines = 74          (target ≥ 50: PASS)
  decisions diverged: A=seek_social vs B=idle  (PASS)
  contributingEngines ≥ 1 on decision: A=True, B=True  (PASS)
  no exceptions during full lifecycle  (PASS)
```

All four success criteria from the spec passed.

---

## 5. What this leaves on the table

Honest:

- **`extendedContext` is not yet injected into the LLM prompt.** The prompt still anchors on the 7 core fields. Wiring `extendedContext` (top 3 by relevance) into the prompt is a token-budget decision and a quality experiment that has not been run.
- **The cognition tier still lacks typed adapters.** ThoughtEngineGramps, InnerMonologueGramps, DeliberationEngineGramps, ActionEngineGramps, and the rest now contribute *state* (via `extendedContext`) but their *intent* and *event* surfaces remain on generic dispatch. A typed adapter per cognition engine would produce sharper output. Doc 9 §3.1 lists them in priority order.
- **Personality engines beyond `SelfModelGramps` contribute to `extendedContext` but not to the 7 core `selfNarrative` field.** Promoting them requires a typed adapter that produces a structured trait+identity blob.
- **The schedulers (initiative/life) currently outvote the world-state bias for low-energy residents.** That's a legitimate priority tension, not a bug: schedulers are CONTROL-priority engines too, and their `select_behavior` returning "idle" reflects what they were designed to do. If we want the world-state bias to win in those cases, the bias multiplier (currently 3.0×) needs to go up, or scheduler outputs need a typed adapter that interprets them more carefully. This is a tuning decision, not an architectural one.
- **~30 engines are still silent.** Their state methods returned None on the smoke run, or their outputs were too cryptic for `summarize_engine_output` to render meaningfully. Most of these are utility engines that probably should remain quiet. A few are cognitive engines that would benefit from a typed adapter providing a structured `get_summary()` method.

The "16 active brains + 87 passengers" framing is replaced by a three-tier framing: **16 typed adapters + ~57 capability-driven contributors + ~30 silent engines.** That's the accurate picture.

---

## 6. Files changed in this expansion

```
NEW   server/residentBrain/engine_capabilities.py        (~370 lines)
NEW   server/residentBrain/_phase_engine_upgrade_smoke.py (regression harness)
NEW   docs/10_engine_influence_expansion.md              (this document)

MOD   server/residentBrain/brain_bundle.py
MOD   server/residentBrain/schemas.py
MOD   src/systems/citySim/brains/residentBrainClient.ts
MOD   src/systems/citySim/components/debug/ResidentBrainDebugSection.tsx

MOD   docs/04_engine_library.md
MOD   docs/05_resident_brain_service.md
MOD   docs/06_engine_integration_status.md
MOD   docs/07_runtime_behavior.md
MOD   docs/09_problems_and_next_steps.md
```

`server/residentBrain/engine_adapters.py` was deliberately NOT touched (hard rule: preserve typed adapters).

---

## 7. The honest summary

The bundle is no longer carrying ~87 dead-weight passengers. It is now an aggregation engine that listens to ~73 engines per tick, weighs their votes by role and source, captures their state for the conversation context, propagates events through ~25 engines (typed + generic), and exposes every signal it used in the debug HUD. The 7 core fields that drive the LLM prompt are unchanged; the system is cleaner, not different at the spine.

The remaining gap between "many engines contributing" and "many engines visibly shaping spoken dialogue" is a prompt-budget question (whether to inject `extendedContext`) and a typed-adapter question (whether to promote specific cognition engines into the 7 core fields). Both are bounded, named, and listed in Doc 9.

This is the right shape for a system that wants to grow into believable cognition without a redesign.
