# Document 2 — System Architecture Overview

This document explains the full stack of AI City and how data flows through it. It is written so that a reader unfamiliar with the codebase can build an accurate mental model from this document alone.

---

## 1. The five layers, named

AI City is a single project that runs five cooperating layers at the same time:

1. **AI City UI (the React + Three.js client)** — the browser app the user actually sees and interacts with.
2. **CitySimManager (the simulation core)** — pure TypeScript, in-process with the UI, owns the world's state and the per-tick loop.
3. **EngineBridge (the cognition client)** — also in the browser, also TypeScript. It is the network adapter that lets CitySimManager talk to the Python brain service over HTTP.
4. **Resident Brain Service (Python, FastAPI)** — runs as a separate process, on the same machine or on a LAN host. Holds the per-resident engine bundles in memory.
5. **Engines library (Python class registry)** — a directory of about 120 Python modules (six packages: `emotion`, `personality`, `memory`, `cognitive`, `behavior`, `utility`) defining the engine classes that the brain service instantiates per resident.

These five layers map cleanly onto three concerns: the **world**, the **body**, and the **mind**. The world is the layout, the place, the rendered scene. The body is the resident's spatial and physical state inside that world. The mind is everything that thinks about being there.

## 2. Layer by layer

### 2.1 AI City UI (React + Three.js)

Source: `src/`, primarily `src/scene/`, `src/systems/citySim/components/`, and `src/App.tsx`.

The browser side is a Vite-built React app. The 3D scene is built with `@react-three/fiber` and `three`. Avatars are loaded with `@pixiv/three-vrm`. The visible surfaces include:

- A 3D map (a GLB file shipped under `public/models/`) that defines the physical town.
- A first-person walk control for the user's resident.
- VRM characters for every NPC and for the player avatar.
- A left-side dialogue chat panel showing recent lines and a TTS stop button.
- A debug HUD on the right showing per-resident state, brain inventory, and decision/conversation source.
- A landing page (`ModeLanding.tsx`) that lets the user pick host mode, client mode, or single-player.
- A mobile thin client (`src/mobile/ThinClientApp.tsx`) that connects to a host over LAN and only renders a slim avatar/chat surface.

The UI does no decision-making and no cognition. It only renders the state CitySimManager exposes and forwards user inputs (movement, chat, voice override selection, etc.) into CitySimManager.

### 2.2 CitySimManager (the simulation core)

Source: `src/systems/citySim/CitySimManager.ts` plus the systems it composes.

CitySimManager is the heart of the world. It owns:

- The **EntityRegistry** (every TownEntity that exists right now).
- The **LocationRegistry** (every navigable location placed by the layout editor: homes, parks, stores, paths, sockets for businesses).
- The **MemorySystem** (short-term, episodic, and long-term memory buckets per actor, persisted in browser local storage).
- The **ConversationSystem** (encounter detection, persistent multi-turn `ConversationSession` objects with category-aware turn budgets, continuation policy, conservative interrupt detection, session-arc memory, and TTS-aware turn timing — see Doc 11 for the change record).
- The **BurgerServiceController** (a service-layer slice that handles a placed restaurant — workers, line, orders).
- The **DailyPlanSystem** (regenerates a daily plan per AI resident per local day; ticks needs and desires).
- The **DecisionSystem** (the function `runAiDecision` that picks the next action for an AI resident, engine-first with a heuristic fallback).
- The **MovementSystem** (start a walk, advance toward destination, detect arrival).
- The **SocialSystem** (relationships, mutual trust/tension/familiarity/friendliness, conversation outcomes).
- The **LifeArcSystem** (per-resident life-in-town narrative, days lived, lifeAdaptation curve).
- A reference to `residentBrainAdapter` (the EngineBridge instance used by everything that wants to talk to the brain service).

Every animation frame, the React renderer calls `CitySimManager.tick(deltaSec, humanWorldPosition, humanRotationY)`, which advances the world's state by that delta. Tick details are in Document 7.

### 2.3 EngineBridge (the cognition client)

Source: `src/systems/citySim/brains/`. Two files matter most:

- `residentBrainClient.ts` — pure transport. Defines TypeScript types for the brain service's HTTP contracts and provides `fetch`-based functions: `checkResidentBrainHealth`, `initializeResidentBrain`, `updateResidentBrain`, `getResidentDecision`, `getConversationContext`, `recordResidentEvent`, `createChildBrain`, `getResidentBrainDebug`.
- `ResidentBrainAdapter.ts` — the stateful client. It is a singleton (`residentBrainAdapter`) that:
  - Tracks whether the brain service is reachable (`refreshHealth` every few seconds).
  - Throttles per-entity calls (`UPDATE_INTERVAL_MS`, `DECISION_INTERVAL_MS`, `CONVERSATION_INTERVAL_MS`).
  - Caches conversation contexts and pending decisions.
  - Exposes `getDecision(entity, nearbyIds)` (engine-first decision, returns null when offline or invalid).
  - Exposes `awaitConversationContext(entity, otherId)` (Promise that resolves with the structured engine brain context required by the conversation prompt).
  - Exposes `sendResidentEvent(entity, payload)` (fire-and-forget feedback into the brain).
  - Sets `entity.brainKind` to `"engine"` when the service answered the init call, otherwise leaves it as `"local"` and the simulation falls back to its heuristic logic.

The bridge is intentionally thin. It does not synthesize anything. It does not own state beyond throttle timers and tiny caches. It is the wire and nothing more.

### 2.4 Resident Brain Service (Python, FastAPI)

Source: `server/residentBrain/`.

This is a single FastAPI process. The default URL is `http://127.0.0.1:8787`. The browser app's bridge points there unless `VITE_RESIDENT_BRAIN_BASE` overrides it.

Internally:

- `engine_factory.py` discovers every class in the Engines packages, separates true engines from data containers (dataclasses, enums, value objects), and provides a typed instantiation primitive `build_engine(...)` that returns a wrapper telling the bundle whether the engine instantiated cleanly and what its constructor signature was.
- `engine_adapters.py` holds 16 hand-written typed adapters for engines whose method signatures cannot be safely invoked through generic dispatch (e.g. `EmotionKernelGramps.tick(seconds: int)`). Each adapter takes `(engine, phase, context, event)` and returns whatever output is most representative for that phase.
- `engine_capabilities.py` holds the capability registry and `GenericEngineAdapter`. At bundle creation, it scans every engine for ~70 known method names and buckets each into decision / state / event / expression. The `GenericEngineAdapter` then uses cached signature metadata to safely invoke methods on every engine that lacks a typed adapter, building the right argument shape per signature and swallowing per-call exceptions. It also publishes two priority tables — `DECISION_PRIORITY` and `CONTEXT_PRIORITY` — used by the bundle's aggregation layers. Document 10 covers the full design.
- `brain_bundle.py` defines `EngineBundle`. Every resident has exactly one. It owns:
  - The engine instances themselves (one per discovered engine class).
  - The per-resident state directory under `state/engines/<entityId>/`.
  - The capability map and the per-engine `GenericEngineAdapter` cache.
  - A phase-driven `tick(context)` method.
  - A `synthesizeDecision(context)` method that aggregates weighted votes from typed adapters, capability-driven contributors, and three explicit bias channels (emotional pressure / personality consistency / world-state pressure). Returns the winning intent plus a `contributingEngines` breakdown.
  - A `synthesizeConversationContext(context)` method that pulls a 7-field engine brain context (emotional state, relationship reasoning, current intent, active goals, drive state, self narrative, recent episodes) plus a parallel `extendedContext` block with up to 8 ranked engine summaries plus prose context lines plus `contextSources` attribution.
  - A `recordEvent(event)` method that classifies the event via `classify_event_tags`, then routes through typed adapters and the `GenericEngineAdapter.absorb_event` so memory, emotion, personality, intent, drive, goal, and any other engine with an event-shaped method sees it.
  - A `child_seed_defaults(other, child_seed, parent_a_summary, parent_b_summary)` method used by `/brains/child`.
  - A `debug_snapshot()` method that exposes the entire instantiation inventory, current outputs, last decision source, the contributing/silent engine lists, the decision breakdown, the context sources, the last event tags, and the cumulative contribution counters.
- `state_store.py` persists each bundle's externalized state JSON under `state/<entityId>.json`. Engines themselves persist their own internals under `state/engines/<entityId>/<engine_key>.json`.
- `main.py` is the FastAPI surface: routes for `/health`, `/brains/init`, `/brains/update`, `/brains/decision`, `/brains/conversation-context`, `/brains/event`, `/brains/child`, `/brains/{entityId}/debug`. Detailed in Document 5.

### 2.5 Engines library

Source: `Engines/` at the project root. Six packages, about 120 files, about 103 true engine classes after dataclasses and enums are filtered out.

The library is not authored as part of AI City. It is a curated cognition library that AI City consumes. The brain service's engine factory walks `Engines.{emotion,personality,memory,cognitive,behavior,utility}` and reflects every class in those modules. The integration discipline is documented in Documents 4 and 6.

## 3. Data flow

This section describes how data moves through the system on a single typical operation: an AI resident has a conversation with another AI resident.

```
USER opens browser
    │
    ▼
React app boots → CitySimProvider mounts → CitySimManager exists
    │
    ▼
Layout loads from localStorage → LocationRegistry populated
    │
    ▼
CitySimManager spawns AI residents from CHARACTER_SEEDS
    │   for each: residentBrainAdapter.initializeEntity(e)
    │       └─► HTTP POST /brains/init { entityId, snapshot }
    │              └─► EngineBundle.create(entity_id, snapshot)
    │                     ├─► discover all 119 engine classes
    │                     ├─► instantiate ~103 active engines
    │                     ├─► wire 4 composite advanced_pairing engines
    │                     └─► persist initial state under state/engines/<id>/
    │              ◄── { ok: true, brainKind: "engine", emotionSummary }
    │       e.brainKind = "engine"
    │
    ▼
Frame loop (every animation frame):
    CitySimManager.tick(deltaSec, humanWorldPos, humanRotY)
        │
        ├─ for each AI resident:
        │     decay energy / hunger
        │     moveTowardDestination
        │     ensureDailyPlanForDay / tickDailyNeeds
        │     residentBrainAdapter.updateEntity(e)
        │         └─► HTTP POST /brains/update { entityId, tickContext }
        │                └─► EngineBundle.tick(context)
        │                       ├─ phase: physiology → emotion → memory →
        │                       │          personality → cognition → behavior →
        │                       │          expression → utility
        │                       └─ collect last_engine_outputs per engine
        │                ◄── { ok, emotionSummary, summary }
        │
        ├─ ConversationSystem.tickActiveConversations(list, now)
        │     pumps existing conversations one line at a time, gated by
        │     TTS speech-wait flags
        │
        ├─ encounter check (every ENCOUNTER_CHECK_INTERVAL_MS):
        │     ConversationSystem.tryRandomEncounters
        │         scans all pairs in TALK_RADIUS, picks highest-scored pair,
        │         calls tryBeginPair(a, b, now)
        │             ├─ createSession(a, b, now):
        │             │      computeConversationBudget(a, b, opener_hint)
        │             │          → { category, minTurns, maxTurns }
        │             │      ConversationSession seeded with:
        │             │          turnIndex=0, status="active", topic=null,
        │             │          conversationGoal=null, unresolvedQuestion=null,
        │             │          emotionalTone (from category + tension + mood),
        │             │          relationshipContext, recentLines=[], commitments=[]
        │             ├─ attachEntity sets inConversation=true on both
        │             │   (this is the lock the decision system honors)
        │             ├─ residentBrainAdapter.awaitConversationContext(a, b.id)
        │             │      └─► HTTP POST /brains/conversation-context
        │             │             └─► EngineBundle.synthesizeConversationContext
        │             │                    pulls engineBrainContext: 7 fields
        │             │      ◄── { contextLines, engineBrainContext, ... }
        │             ├─ same for b
        │             ├─ buildNpcConversationScenePacket(
        │             │      a, b, locations, memories,
        │             │      session: SessionPacketState  // turnIndex, min/maxTurns,
        │             │                                   // category, status, tone,
        │             │                                   // topic, topicStack, goal,
        │             │                                   // unresolvedQuestion,
        │             │                                   // summarySoFar, intents,
        │             │      conversationTurns,           // last 8 lines
        │             │      { engineBrainContext_a, engineBrainContext_b,
        │             │        engineDriven=true,
        │             │        agentARecentSpoken, agentBRecentSpoken })
        │             ├─ if Ollama enabled:
        │             │     fetchNpcNpcExchange(packet, fallback)
        │             │         └─► POST /ollama/api/chat (Vite proxy)
        │             │     ◄── parsed StructuredNpcExchangeResult
        │             └─ applyArrivedBatch:
        │                   fold session updates from result (topic, goal,
        │                       unresolvedQuestion, commitments, summaryDelta);
        │                       category may upgrade (never downgrade)
        │                   c.pendingLines = result.exchange (two lines)
        │                   c.activeBatch  = result
        │                   c.canScheduleMore = result.sceneOutcome.continue
        │
        └─ for each AI resident (decision pump):
              runAiDecision(e, locations, list, now)
                  ├─ residentBrainAdapter.getDecision(e, others.id)
                  │      └─► HTTP POST /brains/decision (throttled, async cache)
                  │      ◄── { intent, confidence, targetEntityId, rationale }
                  ├─ if confidence ≥ 0.25 and intent recognized:
                  │      map intent → in-world action (start walk, set goal, etc.)
                  │      e.decisionSource = "engine"
                  └─ else:
                        run heuristic tree (threat avoid, hunger, energy, social)
                        e.decisionSource = "fallback"

Conversation pump (per active session, per tick):
    if c.waitingForSpeech: return (TTS gate)
    if pendingLines.length and now - lastEmittedAt ≥ TURN_DELAY_MS:
        emitNextPendingLine
            push turn into c.turns AND recordLine(session, turn)  // increments turnIndex
            update conversationLastLine
            beginSpeechWait(c, line.text)
            onDialogueLine(line)
                CitySimManager.appendDialogueLine
                    push to chat log + uiBump immediately
                    return speakAiLine(speakerId, text, voiceId)
                        Promise resolves on audio.onended OR utterance.onend
                        OR safety timeout
            on speech promise settle: endSpeechWait(c)
        if isSecondLine:
            applyStructuredNpcExchange (per-batch memory + relationships;
                                        feeds short-term memory only)
            residentBrainAdapter.sendResidentEvent for each speaker
                └─► HTTP POST /brains/event
                       └─► EngineBundle.recordEvent(event)
                              ├─ classify_event_tags (social/emotional/...)
                              ├─ typed adapters fire
                              └─ GenericEngineAdapter.absorb_event for the rest
            decideContinuation(session, c.canScheduleMore):
                if turnIndex >= maxTurns        → end (max_turns_reached)
                if turnIndex < minTurns         → continue (engine override)
                if unresolvedQuestion           → continue
                if tone tense/heavy and turn<min+4 → continue (extra grace)
                if !canScheduleMore             → end (llm_stop_after_min)
                else                            → continue
            if end: schedule endSession after speech finishes

    after pendingLines drained:
        hard-end: separated / idle_timeout
        detectInterrupts([a, b], allEntities):                 (every tick)
            hunger>=0.92, energy<=0.06, threat≤4u, purpose<=0.15
            on hit → end with interrupt:<reason>
        decideContinuation(session, canScheduleMore)            (engine-wins)
            on end  → endSession(c, a, b, now)
            on cont → runNpcPairBatch(c, a, b)  (next batch)

endSession(c, a, b, now):
    write ONE arc memory (type="conversation_session") to long-term
        for both participants, salience tuned by emotionalTone
    write per-actor commitment memories (type="commitment") for each promise
    apply follow-up actions (linger / leave / goto / avoid)
    detachEntity (clears inConversation lock; releases for runAiDecision)
    scheduleNextDecision for each AI participant
```

That diagram is a real trace. Every arrow above is an actual call site that exists in the code today.

## 4. Separation of concerns: world, body, mind

The architecture's organizing principle is that **world**, **body**, and **mind** never bleed into each other.

### 4.1 World (rendering + layout + scene)

- Lives entirely in the browser.
- Source: `src/scene/`, `src/systems/citySim/townLayout/`, `public/models/`.
- Responsibilities: GLB map, lighting, sky, walk control, VRM avatar instantiation, dialogue panel, TTS audio playback, debug overlays, layout editor, layout persistence.
- Knows nothing about engines. Knows nothing about decisions. Reads `TownEntity` state and renders it.

### 4.2 Body (in-world spatial + physical state)

- Lives in the browser as TypeScript.
- Source: `src/systems/citySim/` (managers, systems, types).
- Responsibilities: position, rotation, currentAction, hunger, energy, socialTolerance, currentLocationId, conversationId, daily plan, life adaptation, money, service movement lock, relationships, layered memory.
- Knows about the world (it has positions and locations) and the mind (it knows whether `brainKind === "engine"` and consults the bridge), but it is not either.

### 4.3 Mind (cognition + persistent inner state)

- Lives in the Python brain service.
- Source: `server/residentBrain/`, plus the `Engines/` library.
- Responsibilities: emotion vectors, personality traits, episodic memory, relational memory, goals, drives, intent backlog, reflection, daily rhythm, self narrative, social circle.
- Knows nothing about positions or rendering. Receives sanitized snapshots and contexts. Returns sanitized decisions and contexts.

The discipline is enforced by the wire format. The HTTP contracts (defined in `schemas.py` and mirrored in `residentBrainClient.ts`) only carry in-world plain text and primitives. The mind never sees `controllerType`. The world never sees engine class names or method signatures. Each side can be replaced independently without breaking the other.

## 5. High-level diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              USER                                       │
│                       (browser, keyboard, voice)                        │
└─────────────────────────────────────────────────────────────────────────┘
                  │ rendered frames, audio out, key/mouse input
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AI City UI  (React 18 + Three.js)                                      │
│  ─────────────────────────────────────────────────────────────────────  │
│  Scene.tsx, LeftHud.tsx, ModeLanding.tsx, CitySimDebugPanel.tsx,        │
│  ResidentBrainDebugSection.tsx, ThinClientApp.tsx, LanHostBridge.tsx    │
│  Speech: characterSpeech.ts (Edge TTS dev API + Web Speech fallback,    │
│  Promise-returning, global queue)                                       │
└─────────────────────────────────────────────────────────────────────────┘
                  │ React props / context
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CitySimManager  (TypeScript, in-process)                               │
│  ─────────────────────────────────────────────────────────────────────  │
│  EntityRegistry  LocationRegistry  MemorySystem  ConversationSystem     │
│  DecisionSystem  MovementSystem    SocialSystem  DailyPlanSystem        │
│  LifeArcSystem   BurgerServiceController                                │
└─────────────────────────────────────────────────────────────────────────┘
                  │ residentBrainAdapter (HTTP)
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Resident Brain Service  (Python, FastAPI, port 8787)                   │
│  ─────────────────────────────────────────────────────────────────────  │
│  main.py           — endpoints                                          │
│  brain_bundle.py   — EngineBundle (per-resident orchestration)          │
│  engine_factory.py — discover + classify + instantiate engines          │
│  engine_adapters.py— typed wrappers per engine                          │
│  state_store.py    — bundle state persistence under state/<id>.json     │
│  state/engines/<id>/ — per-engine JSON files (per resident)             │
└─────────────────────────────────────────────────────────────────────────┘
                  │ Python imports
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Engines library  (~120 modules across 6 packages)                      │
│  ─────────────────────────────────────────────────────────────────────  │
│  emotion/      personality/   memory/                                   │
│  cognitive/    behavior/      utility/                                  │
└─────────────────────────────────────────────────────────────────────────┘

          External companion: Ollama (optional)
          ─────────────────────────────────────
          The browser also calls the local Ollama server via the Vite proxy
          for dialogue completion when enabled. This is the speech surface,
          not the mind.

          External companion: Edge TTS (dev) / Web Speech (anywhere)
          ─────────────────────────────────────────────────────────
          The browser dev server exposes /api/edge-tts to serve neural
          voices via a Vite plugin. Web Speech is the always-available
          fallback. The speech layer guarantees no overlap and serializes
          all spoken lines through a global Promise queue.

          External companion: LAN websocket hub (host mode)
          ─────────────────────────────────────────────────
          When AI City is launched in host mode, LanHostBridge opens a
          websocket hub. Clients (mobile thin client) join over LAN and
          stream pose + chat to the host, which renders authoritative
          state and broadcasts world snapshots back.
```

## 6. Process and deployment shape

The shipping shape is intentionally minimal:

- One Python process (uvicorn → `main:app`) on port 8787.
- One Vite dev server on port 5173 (also serves the dev-only Edge TTS plugin and the Ollama proxy).
- Optionally one Ollama server on port 11434, providing local LLM completions.
- For LAN play: the host machine runs the above; client devices open `http://<host-ip>:5173?mode=client` and stream input/output.

The `start_dev.py` launcher at the project root starts the brain service and the Vite dev server in parallel, prefixes their log output, and shuts both cleanly on Ctrl+C. There is no orchestration framework; this is plain subprocess + threading.

## 7. Why this shape

A few of the choices are non-obvious and worth justifying.

- **Why a separate Python service?** Because the cognition library is Python, with non-trivial dependencies (sqlite, optional torch, optional sentence-transformers). It cannot run in a browser. Bundling it into Electron or PyScript would compromise both performance and compatibility. A localhost FastAPI process is the simplest contract that lets the browser talk to real Python.
- **Why HTTP and not websockets for the brain?** Because the calls are short, request/response, idempotent at the per-entity level, and trivially throttled. Websockets would not buy anything for this layer.
- **Why per-resident isolated state?** Because residents must not contaminate each other. Two residents talking should each remember their own version of the conversation, with their own emotional response, their own intent backlog, their own relational memory. Shared state across residents has been observed to produce identical emotional reads — an obvious failure mode the architecture refuses on principle.
- **Why a fallback heuristic in the simulation?** Because the brain service is allowed to be off. The user might launch with `--no-brain`. The service might crash. The cognition layer is the *primary* path; the heuristic is the *guarantee* that the world keeps moving when the cognition layer is unavailable. This is enforced at the adapter boundary, not buried inside the brain.

The next document (Document 3) drills into the AI City layer specifically — entities, systems, rendering, LAN — without discussing cognition. Document 4 does the inverse: it describes the engines library without discussing the world.
