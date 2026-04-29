# Entity system and agent brains

This document explains how AI residents are modeled and how their "brain" is wired at runtime.

It focuses on `src/systems/citySim/` and the runtime path that turns:

- persona + state
- perception + memory + relationships
- decision and conversation systems

into continuous behavior.

---

## 1) Mental model

An entity is a `TownEntity` (`src/systems/citySim/types.ts`) managed by a singleton `CitySimManager` (`src/systems/citySim/CitySimManager.ts`).

Think of each AI resident as four cooperating layers:

1. **Identity layer (persona):**
   - Canonical persona files in `src/systems/citySim/personas/*.json`
   - Loaded via `personaRegistry.ts`
   - Includes stable role/traits, voice defaults, and persona notes

2. **State layer (simulation body):**
   - Position, mood, hunger, energy, social tolerance, current action, goals
   - Relationships (`trust`, `tension`, `familiarity`, `friendliness`)
   - Daily plan and life-arc fields

3. **Memory layer (3 tiers):**
   - Short-term: immediate continuity
   - Episodic: recent timestamped events
   - Long-term: reinforced distilled summaries
   - Owned by `MemorySystem.ts` and persisted in local storage

4. **Control layer (systems):**
   - `DecisionSystem.ts` selects destinations/goals
   - `ConversationSystem.ts` starts/ticks dialogue
   - `SocialSystem.ts` updates relationship state
   - `PromptBuilder.ts` and conversation packet builders produce LLM-safe context

---

## 2) Entity bootstrap lifecycle

Boot path (layout -> world):

1. `CitySimManager.bootstrapFromSavedLayout(...)`
2. Marker layout converts to `CityLocation[]`
3. NPC entities spawn from persona-backed seeds in `data/townCharacters.ts`
4. Player resident spawns (`resident_player`)
5. `MemorySystem.hydrateEntityMemoryIds(...)` restores per-entity recent memory references
6. Daily plans initialized and first decisions scheduled
7. `simulationEnabled = true`

Notes:

- Persona files are now the source for NPC seed data (`getNpcPersonas()`).
- Runtime settings (`aiSimSettings.ts`) can still override display name/role/mood/traits/persona notes.

---

## 3) Brain loop per tick

`CitySimLoop` calls `CitySimManager.tick(...)` each frame.

Inside each tick:

1. **Human sync**
   - Updates human position/rotation from controls.

2. **NPC physiology and movement**
   - Energy decays, hunger rises.
   - Movement advances (`MovementSystem`).
   - Daily needs progress (`DailyPlanSystem`).

3. **Conversation progression**
   - Active conversations emit lines in timed turns.
   - Structured outcomes are applied to memory + relationships.

4. **Encounter discovery**
   - Candidate nearby pairs are scored and top pair can begin a conversation.

5. **Decision updates**
   - AI entities run `runAiDecision(...)` when scheduled and eligible.

This produces a closed feedback loop: movement -> encounters -> dialogue -> memory/relationship deltas -> future decisions/dialogue.

---

## 4) Decision system (goal selection)

`DecisionSystem.runAiDecision(...)` is the locomotion/planning gate.  
It exits early if the entity is:

- not AI-controlled
- service-locked
- in conversation
- already walking
- or not yet at `nextDecisionAt`

Decision priority (high -> low):

1. Threat avoidance (if `avoidingEntityId` is nearby)
2. Rest at home (low energy)
3. Seek store (high hunger)
4. Seek social spaces (low social satisfaction / high social urge)
5. Pursue current daily objective
6. Fallback random behavior (walk/idle/sit)

After any branch, it schedules a new decision time window (`DECISION_INTERVAL_MIN_MS..MAX_MS`).

---

## 5) Conversation system (dialogue engine glue)

`ConversationSystem` owns pairing, session lifecycle, turn timing, and completion. Each in-flight conversation is a persistent **`ConversationSession`** with category-aware turn budgets, topic / goal continuity, engine-wins-on-stop continuation policy, and conservative interrupt detection. See Doc 11 (`docs/11_conversation_sessions.md`) for the full change record and Doc 3 §5 / Doc 7 §3 for runtime walk-throughs.

Two modes:

- **NPC <-> NPC:** persistent multi-turn `ConversationSession` (delivered as 2-line LLM batches; budget bands: casual 4–8, work 4–10, planning 6–14, emotional 8–16, argument 8–20, deep 10–24)
- **Player <-> NPC:** single NPC reply path (single-shot session, see Doc 9 §1.7 / §3.6 for the multi-turn upgrade plan)

Flow for NPC pairs:

1. `createSession(a, b)` — `computeConversationBudget` picks category + min/max turns from opener hints and relationship state
2. Lock both speakers (`inConversation = true`); the decision system honors this lock for the entire arc
3. Per batch:
   1. Fetch each speaker's `engineBrainContext` from the brain service
   2. Build scene packet with full session state (`conversationStructured.ts`)
   3. Include merged agent slice + layered memory + daily/life lines + recent 8 turns
   4. Call Ollama (`ollamaDialogue.ts`) or session-aware stub
   5. Fold session-arc updates (topic, goal, unresolvedQuestion, summaryDelta, commitments) into the live session
   6. Emit two spoken lines (A then B), TTS-gated
   7. Apply per-batch outcome (relationship delta, social tolerance, short-term memory event)
   8. Run `decideContinuation` (engine wins on stop below `minTurns`; tone-based grace past `minTurns`; honor LLM at/above `minTurns`)
4. Per tick: `detectInterrupts` (conservative — only true emergencies before `minTurns`)
5. On end: `endSession` writes ONE consolidated arc memory (`type: "conversation_session"`) plus per-actor commitment memories (`type: "commitment"`), applies follow-up actions (linger/leave/goto/avoid/idle), sets cooldowns, clears the lock, re-schedules decisions.

---

## 6) Memory architecture (short-term, episodic, long-term)

Implemented in `MemorySystem.ts`.

### Short-term memory

- Rolling per-actor event IDs (`shortTermByActor`)
- Feeds immediate conversational continuity
- Also mirrored onto `entity.memoryIds` for compatibility/debugging

### Episodic memory

- Larger per-actor event index (`episodicIndexByActor`)
- Stores timestamped concrete events with participants/place/impact

### Long-term memory

- Reinforced distilled summaries (`longTermByActor`)
- Records include salience, type hint, reinforcement count, first/last seen timestamps
- Repeated similar events reinforce existing long-term items

### Persistence

- Local storage key: `ai-city-memory-v2`
- Serialized as versioned state (events + indexes + long-term records)
- Hydrated at `MemorySystem` construction
- Trim guards prevent unbounded growth

---

## 7) Persona system and overrides

Persona sources:

- Canonical files: `src/systems/citySim/personas/*.json`
- Accessors: `personaRegistry.ts`

Runtime overrides:

- `src/systems/citySim/settings/aiSimSettings.ts`
- Per-character optional overrides (name, role, mood, traits, persona notes, voice)
- Global system suffixes for NPC<->NPC and Player<->NPC prompt variants

Merge behavior:

- `getMergedAgentSlice(entity)` merges runtime override over live entity values
- If no override persona notes exist, it falls back to persona-file `personaNotes`

---

## 8) Prompt safety and "in-world only" rule

Prompt builders intentionally exclude operator/controller metadata.

Important guardrail:

- `controllerType` and other engine-only control fields are never meant to be exposed to LLM context.

Where context is built:

- Generic world context: `PromptBuilder.ts`
- NPC dialogue packet: `conversationStructured.ts`
- Player/NPC packet: `conversationPlayer.ts`

These packets now carry layered memory slices plus daily/life lines for richer continuity.

---

## 9) Entity data contract snapshot

`TownEntity` includes:

- identity: `id`, `displayName`, `gender`, `role`, `traits`, `mood`
- motion: `position`, `rotation`, destination fields, action
- drives: `hunger`, `energy`, `socialTolerance`
- social: `relationships`, conversation fields, avoidance flags
- planning/life: `dailyPlan`, `townRoleOptions`, `lifeAdaptation`, `townDaysLived`
- control internals: `controllerType`, `controlledBy`, `serviceMovementLock`
- voice: `ttsVoiceId`
- compatibility memory refs: `memoryIds`

The entity itself is the live mutable runtime state; systems read and mutate it directly in controlled phases.

---

## 10) Practical extension points

If you want to evolve "brain quality", best leverage points are:

1. `MemorySystem.ts`
   - Add memory decay policies, retrieval scoring, or stronger consolidation.

2. `conversationStructured.ts` / `conversationPlayer.ts`
   - Tune scene packet shape and outcome schema.

3. `DecisionSystem.ts`
   - Add profession-aware schedules, commitments, and utility-based movement.

4. `DailyPlanSystem.ts` + `LifeArcSystem.ts`
   - Strengthen long-horizon behavior and role drift.

5. `personas/*.json`
   - Improve narrative consistency without changing engine code.

---

## 11) Quick trace checklist (debugging one NPC)

To inspect one resident end-to-end:

1. Check persona file in `personas/<id>.json`
2. Inspect merged runtime override in AI settings panel (`AiSettingsPanel.tsx`)
3. Watch live entity state in debug panel (`CitySimDebugPanel.tsx`)
4. Inspect conversation packet construction (`conversationStructured.ts` / `conversationPlayer.ts`)
5. Verify memory writes in `MemorySystem.add(...)`
6. Confirm relationship deltas in `SocialSystem.applyConversationOutcome(...)`
7. Observe next movement/goal in `DecisionSystem.runAiDecision(...)`

This trace gives a complete picture of why an agent said or did something.

