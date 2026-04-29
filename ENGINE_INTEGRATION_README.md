# Engine Integration README

This pass wires the external `Engines` Python framework into AI City as a resident cognition layer via a local bridge service.

## What this integration does

- Keeps `CitySimManager` and existing sim/render systems intact.
- Adds a Python Resident Brain Service (`server/residentBrain`) that owns per-resident `EngineBundle` state.
- Adds TypeScript bridge client/adapter under `src/systems/citySim/brains`.
- Initializes one engine-backed brain per AI/network resident when possible.
- Falls back to local behavior automatically when the service is unavailable.
- Sends important memory/conversation events to the brain service.
- Lets brain suggestions influence decision routing before local fallback logic.
- Adds manual child resident creation for lineage testing.

## Folder layout

- AI City: `C:/Users/aztre/Desktop/AI-City`
- Engines: sibling project expected by service via `ENGINES_ROOT` (or auto-discovery candidates)

Bridge files:

- `server/residentBrain/main.py`
- `server/residentBrain/brain_bundle.py`
- `server/residentBrain/schemas.py`
- `server/residentBrain/state_store.py`
- `server/residentBrain/engine_factory.py`
- `src/systems/citySim/brains/residentBrainClient.ts`
- `src/systems/citySim/brains/ResidentBrainAdapter.ts`

## Engine contract audit (real Engines classes)

The brain service now uses real class methods from Engines when available.

### Fully wired (active)

- `EmotionKernelGramps` (`emotion.emotion_kernel_gramps`)
  - ctor: `__init__(config: Dict = None, state_path: str = "emotion_state.json")`
  - init/load/save: `initialize()` -> `load_state()`, `save_state(...)` via BaseEngine
  - runtime methods used: `update(event, intensity)`, `tick(seconds)`, `get_state()`
  - state shape: drive dict like `{"boredom": float, ...}`

- `PersonalityEngineBeast` (`personality.personality_beast`)
  - ctor: `__init__(config: Dict = None, state_path: str = "personality.json", seed=None)`
  - runtime methods used: `initialize()`, `get_traits()`, `update_trait(...)` (safe optional)
  - state shape: `{"traits": {...}, "mood": str}`

- `SelfModelGramps` (`personality.self_model_gramps`)
  - ctor: `__init__(config: Dict = None, state_path: str = "self_model.json", agent_name: str = "Agent")`
  - runtime methods used: `initialize()`, `append_to_narrative(...)`, `get_summary()`, `get_state_dict()`
  - state shape: beliefs/preferences/meta_beliefs/uncertainties/self_narrative

- `RelationalMemorySystem` (`memory.relational_memory_system`)
  - ctor: `__init__(db_path: str = "relational_memory.db")`
  - runtime methods used: `store_memory(...)`, `record_outcome(...)`, `get_reasoning_summary(...)`
  - state shape: sqlite tables (`relational_memories`, `memory_outcomes`, cluster tables)

- `EpisodeMemoryGramps` (`memory.episode_memory_gramps`)
  - ctor: `__init__(config: Dict = None, state_path: str = "episodes.json", vector_memory=None)`
  - runtime methods used: `initialize()`, `store(content, metadata)`, `get_state_dict()`
  - state shape: `{"episodes": {...}, "active_episodes": [...]}` with Episode dicts

- `GoalEngineGramps` (`cognitive.goal_engine_gramps`)
  - ctor: `__init__(config: Dict = None, state_path: str = "goals.json")`
  - runtime methods used: `initialize()`, `create_goal(...)`, `select_behavior(context)`, `get_active_goals()`
  - state shape: `{"goals": {goal_id: goal_dict}}`

- `DriveModelSeed` (`behavior.drive_model_seed`)
  - ctor: `__init__(config: Dict = None, state_path: str = "drives_seed.json")`
  - runtime methods used: `initialize()`, `select_behavior(context)`, `get_active_drive()`
  - state shape: nested `drives` dict (`desires`, `goals`, `anxieties`, `expectations`, ...)

- `DailyRhythmLyra` (`behavior.daily_rhythm_lyra`)
  - ctor: `__init__(config: Dict = None, state_path: str = "daily_rhythm_lyra.json")`
  - runtime methods used: `initialize()`, `get_current_phase()`, `select_behavior(context)`, `get_status()`
  - state shape: routine + phase history

- `BehavioralPulseEngine` (`behavior.behavioral_pulse_engine`)
  - ctor: accepts dependencies (`emotion_kernel`, `drive_model`, `goal_engine`, `daily_rhythm`, etc.)
  - runtime methods used: `initialize()`, `select_behavior(context)`, `record_outcome(...)` (safe optional)
  - state shape: behavior history, weights, outcome tracking, evolution/homeostasis fields

- `IntentSystem` (`utility.intent_system`)
  - ctor: `__init__(state_path: str = "next_interaction_intents.json")`
  - runtime methods used: `initialize()`, `add_intent_from_memory_tag(...)`, `get_top_intent()`, `get_intent_prompt_modifier()`
  - state shape: list of weighted intents

### Passive / observed

- `ObserverClientSeed` (`utility.observer_client_seed`)
  - wired in passive mode (LLM disabled) and used for optional descriptive context
  - if unavailable or failing, bundle keeps running with no crash

- `SystemLoadBalancer` (`utility.system_load_balancer`)
  - instantiated for compatibility/introspection only in this pass
  - not driving behavior decisions yet

### Dependencies and compatibility notes

- Engines relying on BaseEngine relative imports require package-style loading (`Engines.<module>`). The service now loads that way and falls back safely.
- `RelationalMemorySystem` uses sqlite and a file DB path.
- `ObserverClientSeed` may require reachable Ollama if enabled; default here is passive (`enabled=False`).
- Any single engine failure is isolated per resident and shown in debug as disabled.

## Engines active in baseline bundle

The service attempts to load these classes (fallback stubs if import/init fails):

- `EmotionKernelGramps`
- `PersonalityEngineBeast`
- `SelfModelGramps`
- `RelationalMemorySystem`
- `EpisodeMemoryGramps`
- `GoalEngineGramps`
- `DriveModelSeed`
- `DailyRhythmLyra`
- `BehavioralPulseEngine`
- `IntentSystem`
- `ObserverClientSeed`
- `SystemLoadBalancer` (passive/observed)

Each resident gets an isolated `EngineBundle`.

## Run commands

Terminal 1 (AI City):

```bash
cd "C:/Users/aztre/Desktop/AI-City"
npm install
npm run dev
```

Terminal 2 (Resident Brain Service):

```bash
cd "C:/Users/aztre/Desktop/AI-City/server/residentBrain"
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8787
```

Optional if Engines is not auto-detected:

```bash
set ENGINES_ROOT=C:\\Engines
uvicorn main:app --reload --port 8787
```

## Behavior and fallback

- If `/health` fails, adapter marks residents as `brainKind: "local"` fallback.
- Sim still moves/talks exactly as before using current local systems.
- No crash on service shutdown; behavior degrades gracefully.
- Per-engine faults are isolated: failed engines are disabled for that resident while other engines continue.

## Resident brain debug endpoint

- `GET /brains/{entityId}/debug`
- Returns:
  - `activeEngines`
  - `disabledEngines`
  - `engineContracts`
  - `lastInputEvent`
  - `lastDecisionOutput`
  - `lastEmotionSummary`
  - `lastPersonalitySummary`
  - `lastMemorySummary`

## End-to-end test (single NPC)

1. Start AI City and resident brain service.
2. Relaunch town so residents are re-bootstrapped.
3. Open debug panel and confirm:
   - brain service connected
   - residents show `brain: engine` where available
4. Watch movement and conversations continue normally.
5. Trigger interactions and verify:
   - `last event` updates from memory/conversation sends
   - `intent`/`emotion` fields update
6. Stop the brain service; verify residents continue with fallback behavior.
7. Use debug button `Dev: create child from first two AI residents`:
   - child entity appears
   - child gets initialized brain attempt

## Notes

- This pass does not import Python engines directly in browser code.
- This pass does not add model training.
- This pass does not implement full biological reproduction; only a manual child-seed pathway for lineage bootstrapping.

