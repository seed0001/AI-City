# Simulation and systems

The **city simulation** is a TypeScript **engine** centered on `CitySimManager` and a set of subsystems. This document explains entities, the **per-day plan**, **life arc**, how **locations** are created from a saved **layout**, and how other systems (movement, conversation, memory, social, decisions) connect.

## Core class: `CitySimManager`

Location: `src/systems/citySim/CitySimManager.ts`

Responsibilities (non-exhaustive):

- **Registry of entities** (`EntityRegistry`) — all `TownEntity` instances, lookup by id.
- **Location graph** (`LocationRegistry`) from marker-driven `CityLocation[]` after bootstrap.
- **Memories** (`MemorySystem`) — event log lines used in prompts and feedback loops.
- **Conversations** (`ConversationSystem`) — when NPCs talk, tick exchanges, call LLM or stubs, emit **dialogue lines** and apply outcomes.
- **Dialogue log** for the left HUD; **TTS** triggered for non-player speakers (`speakAiLine` + optional per-entity `ttsVoiceId`).
- **Simulation on/off** (`simulationEnabled`) — layout mode clears the world; simulation tick runs in `CitySimLoop` when enabled.

`tick(deltaSec, humanPosition, humanRotationY)` is called from R3F each frame: it updates the human, NPCs (energy, hunger, movement, AI decisions, encounter checks, **daily** need ticks), and active conversations.

## The `TownEntity` model

Defined in `src/systems/citySim/types.ts`. Notable fields:

- **Identity & presence**: `id`, `displayName`, `gender`, `role`, `traits`, `mood`, `position`, `rotation`, `currentAction`.
- **Location & travel**: `currentLocationId`, `destinationLocationId`, `destinationPosition`.
- **Needs** (0–1 style): `hunger`, `energy`, `socialTolerance` — used for budgets and `DailyPlanSystem` / `LifeArcSystem` style lines in prompts.
- **Social graph**: `relationships` (trust, tension, etc.), `conversation` state, cooldowns, avoidance.
- **Engine control**: `controllerType`, `residentKind`, `controlledBy` — **never** exposed in LLM context as “operator” metadata; the model sees in-world phrasing.
- **Daily and life**:
  - `dailyPlan` — a **`DailyPlan`** (headline, **objectives**, **needs**, **desires**, progress, fulfillment) keyed by a **local calendar day** (`dayKey` via `localDayKey()` in `DailyPlanSystem.ts`).
  - `lifeAdaptation`, `townDaysLived`, `lastSimDayKey` — “roots” in town, advanced on calendar flips in **`LifeArcSystem.ts`**.
  - `townRoleOptions` — alternative roles the engine can drift between (subject to user locks in settings).
- **TTS**: `ttsVoiceId` (Edge / Azure **short name**, e.g. `en-US-AvaNeural`) with overrides persisted through **`ttsVoiceStorage`**.

`CHARACTER_SEEDS` in `data/townCharacters.ts` define the initial roster (ids, home markers, default traits, roles, etc.); `createEntityFromSeed` and `createHumanEntity` build entities at bootstrap.

## Preset town layout and bootstrap

- **Definitions**: `data/presetMarkers.ts` — each marker has a **stable `key`**, type (home, store, park, social), required/optional, default radius, etc.
- **Persistence**: `townLayout/storage.ts` — JSON under a fixed localStorage key (e.g. `ai-city-town-layout-v1`); see doc **04** for the exact key.
- **Relaunch** validates required markers, converts markers to **`CityLocation`**, then **`bootstrapFromSavedLayout`** on the manager: homes spawn NPCs, the human is placed at square/store (or first location), `simulationEnabled` becomes `true`, AI schedules **next decisions**.

## Daily plans (`DailyPlanSystem.ts`)

- A **per-day** structure: headline, **objectives** (concrete `targetLocationId` or `targetKinds`), **needs** (rest, food, connection, purpose with satisfaction), **desires** (biases for tone / steering).
- **Calendar** uses a simple **local date** string from `localDayKey()`; new days trigger `LifeArcSystem`’s `onSimCalendarNewDay` and `ensureDailyPlanForDay` for each NPC.
- Arrival at a location, finishing conversations, and progress on objectives are hooked from **`CitySimManager`** and **`ConversationSystem`** (e.g. `onConversationEndedForDaily`, `onNpcArrivedAtLocation`).

## Life arc (`LifeArcSystem.ts`)

- Produces **human-readable lines** for prompts (e.g. survival / hunger / rest phrasing, “roots in town” maturity, TTS **voice label** and persona) via helpers like `formatSurvivalUrgencyLine`, `formatLifeInTownLine`, `formatVoiceAndPersonaLine`.
- **Day rollover**: advances `lifeAdaptation`, can nudge `role` when the user has not hard-locked overrides (coordination with `getAiSettings()`).
- `nudgeLifeAfterSocialExchange` ties **social** outcomes into long-horizon feel.

## Other subsystems (brief)

| Module | Role |
| ------ | ---- |
| `DecisionSystem.ts` | Picks / schedules AI goals, walk targets, and next decision times. |
| `MovementSystem.ts` | Moves an entity toward its **destination** over time. |
| `PerceptionSystem.ts` | Who is **near** whom (`PERCEPTION_RADIUS`, `TALK_RADIUS` from `constants.ts`). |
| `SocialSystem.ts` | Relationship creation, updates, conversation-outcome application. |
| `MemorySystem.ts` | **Recent** event list for prompt context. |
| `PromptBuilder.ts` | Builds **LLM-safe** `WorldContextPacket` from entity + world (no engine-only ids). |
| `ConversationSystem.ts` | Pairs, ticks, Ollama vs stub, emits lines. |
| `constants.ts` | Tuning: radii, intervals, `ENTITY_Y`, etc. |

## The sim loop in React

- **`CitySimContext`** holds a **singleton** `CitySimManager` and a `simVersion` “bump” to refresh React consumers when the engine changes async state.
- **`CitySimLoop`**: `useFrame` → `manager.tick` — the single authoritative real-time step.

## Tuning the simulation

- Change **`constants.ts`** for global radii and cadence; avoid scattering magic numbers.
- Change **`CHARACTER_SEEDS` / `presetMarkers`** to extend the town; ensure **relaunch validation** and **home marker keys** stay in sync.
- For **narrative** and **planner** tone, read **headline** and **objective** construction in `DailyPlanSystem.ts` and **life** strings in `LifeArcSystem.ts`.

## Related documentation

- **04-dialogue-tts-storage-and-deploy.md** — Ollama, TTS, `aiSimSettings`, layout keys, production.
