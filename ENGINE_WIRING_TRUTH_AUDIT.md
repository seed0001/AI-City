# ENGINE wiring truth audit

This is a literal code-level audit of current wiring between AI City and Engines.

## 1) Engine inventory and wiring status

Scope for this inventory: engine-like classes in `Engines` runtime domains (`emotion`, `personality`, `memory`, `behavior`, `cognitive`, `utility`) plus key system-style classes used as engines.

Status legend:
- `NOT WIRED`
- `IMPORTED ONLY`
- `PASSIVE DEBUG ONLY`
- `EVENT MEMORY ONLY`
- `PROMPT CONTEXT ONLY`
- `DECISION INFLUENCE`
- `ACTIVE CONTROL LOOP`

| Engine class | Status |
| --- | --- |
| EmotionKernelGramps | PROMPT CONTEXT ONLY |
| EmotionModelSeed | NOT WIRED |
| ConnorStateBeast | NOT WIRED |
| EmotionalFeedbackBeast | NOT WIRED |
| MentalHealthEngineBeast | NOT WIRED |
| PersonalityEngineBeast | PASSIVE DEBUG ONLY |
| PersonalityEngineLyra | NOT WIRED |
| PersonalitySeed | NOT WIRED |
| SelfModelGramps | EVENT MEMORY ONLY |
| SelfModelSeed | NOT WIRED |
| StoryOfSelfSeed | NOT WIRED |
| SocialCircleLyra | NOT WIRED |
| IdentityEngine | NOT WIRED |
| MemoryCoreGramps | NOT WIRED |
| MemoryManagerLyra | NOT WIRED |
| EpisodeMemoryGramps | EVENT MEMORY ONLY |
| RelationalMemorySystem | PROMPT CONTEXT ONLY |
| UnifiedMemorySeed | NOT WIRED |
| VectorMemoryGramps | NOT WIRED |
| KnowledgeBaseGramps | NOT WIRED |
| MemoryReconciliationEngineGramps | NOT WIRED |
| TemporalContinuitySeed | NOT WIRED |
| SeedMemory | NOT WIRED |
| DriveModelSeed | DECISION INFLUENCE |
| DailyRhythmLyra | DECISION INFLUENCE |
| BehavioralPulseEngine | PASSIVE DEBUG ONLY |
| InitiativeSchedulerSeed | NOT WIRED |
| SeedDynamics | NOT WIRED |
| CycleEngineGramps | NOT WIRED |
| LifeSchedulerLyra | NOT WIRED |
| GoalEngineGramps | DECISION INFLUENCE |
| ReflectionEngineGramps | NOT WIRED |
| InnerMonologueGramps | NOT WIRED |
| AdvancedPairingEngine | NOT WIRED |
| ActionEngineGramps | NOT WIRED |
| ThoughtEngineGramps | NOT WIRED |
| SongwritingEngineLyra | NOT WIRED |
| LambdaPsiEngineConnor | NOT WIRED |
| DeliberationEngineGramps | NOT WIRED |
| LLMDriftAnalysisEngine | NOT WIRED |
| SelfRegulationEngineBeast | NOT WIRED |
| QuantumReasoningEngineConnor | NOT WIRED |
| RealIntelligenceEngineConnor | NOT WIRED |
| HallucinationMonitorGramps | NOT WIRED |
| SkillAcquisitionEngineGramps | NOT WIRED |
| NeuralEmergenceSystemConnor | NOT WIRED |
| CreativeWritingEngineGramps | NOT WIRED |
| ResponseEngineBeast | NOT WIRED |
| PreThinkEngineConnor | NOT WIRED |
| DeepReviewEngineGramps | NOT WIRED |
| JournalingEngineBeast | NOT WIRED |
| RegulatorConnor | NOT WIRED |
| CreativeEngines | NOT WIRED |
| ObserverClientSeed | PROMPT CONTEXT ONLY |
| IntentSystem | DECISION INFLUENCE |
| SystemLoadBalancer | IMPORTED ONLY |
| WebLearnerSeed | NOT WIRED |
| DashboardEngineBeast | NOT WIRED |
| FallbackPhrasesSeed | NOT WIRED |
| WebCrawlerGramps | NOT WIRED |
| ContactManagerGramps | NOT WIRED |
| DJMusicEngineBeast | NOT WIRED |
| WordStoreSeed | NOT WIRED |
| CharacterVoiceSeed | NOT WIRED |
| OllamaClientConnor | NOT WIRED |
| CuriosityEngineSeed | NOT WIRED |
| AvatarGeneratorLyra | NOT WIRED |
| LambdaPsiInstrumentationConnor | NOT WIRED |
| VocabularyEnforcerSeed | NOT WIRED |
| VisionModuleGramps | NOT WIRED |
| AgingEngine | NOT WIRED |
| AudioEngine | NOT WIRED |
| VisionEngine | NOT WIRED |
| XTTSEngine | NOT WIRED |
| ImageGenerationEngine | NOT WIRED |
| VoiceModulationEngineBeast | NOT WIRED |

## 2) Wired-engine details (instantiation, calls, behavior effect)

All baseline engines are instantiated in `server/residentBrain/brain_bundle.py` inside `EngineBundle.create(...)`.

### EmotionKernelGramps
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** `initialize()`, `update(event, intensity)`, `tick(seconds)`, `get_state()`
- **Output affects AI City in:** `server/residentBrain/brain_bundle.py` responses to `/brains/update`, `/brains/decision`, `/brains/conversation-context`, then consumed by `src/systems/citySim/brains/ResidentBrainAdapter.ts`
- **Current effect area:** mood summary text and prompt context line; not directly steering movement

### PersonalityEngineBeast
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** `initialize()`, `get_traits()`
- **Output affects AI City in:** debug/emotion/personality summary fields returned by service and surfaced via adapter
- **Current effect area:** debug/personality summary only (no direct movement/conversation control)

### SelfModelGramps
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** `initialize()`, `append_to_narrative(...)`
- **Output affects AI City in:** persisted resident brain state; indirectly available in `/brains/{id}/debug`
- **Current effect area:** event memory journaling only

### RelationalMemorySystem
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** `store_memory(...)`, `record_outcome(...)` (when resolution present), `get_reasoning_summary(...)`
- **Output affects AI City in:** conversation context payload from `/brains/conversation-context`
- **Current effect area:** memory + conversation prompt context

### EpisodeMemoryGramps
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** `initialize()`, `store(content, metadata)`
- **Output affects AI City in:** persisted brain state/debug only
- **Current effect area:** event memory tracking only

### GoalEngineGramps
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** `initialize()`, `get_active_goals()`, `create_goal(...)`, `select_behavior(context)`
- **Output affects AI City in:** `/brains/decision` response intent mapping, consumed in `src/systems/citySim/DecisionSystem.ts`
- **Current effect area:** decision influence (movement/goal selection pathway)

### DriveModelSeed
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** `initialize()`, `select_behavior(context)`, `get_active_drive()`
- **Output affects AI City in:** `/brains/decision` response intent mapping, consumed in `src/systems/citySim/DecisionSystem.ts`
- **Current effect area:** decision influence

### DailyRhythmLyra
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** `initialize()`, `get_current_phase()`, `select_behavior(context)`, `get_status()` (contract visible; status not required by core path)
- **Output affects AI City in:** `/brains/decision` intent mapping and `/brains/update` summaries
- **Current effect area:** decision influence

### BehavioralPulseEngine
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** `initialize()`, `select_behavior(context)` (record methods are available but not driving CitySim actions directly)
- **Output affects AI City in:** stored service state/debug summaries only
- **Current effect area:** passive telemetry/debug (not direct control)

### IntentSystem
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** `initialize()`, `add_intent_from_memory_tag(...)`, `get_top_intent()`, `get_intent_prompt_modifier()`
- **Output affects AI City in:** `/brains/decision` and `/brains/conversation-context` responses
- **Current effect area:** decision influence + prompt context

### ObserverClientSeed
- **Instantiated in:** `server/residentBrain/brain_bundle.py` with disabled LLM config
- **Methods called:** `initialize()`, `observe_state(...)`
- **Output affects AI City in:** optional extra conversation context line from `/brains/conversation-context`
- **Current effect area:** prompt context only

### SystemLoadBalancer
- **Instantiated in:** `server/residentBrain/brain_bundle.py`
- **Methods called:** none in active loop
- **Output affects AI City in:** no behavior path
- **Current effect area:** imported only

## 3) Resident state isolation (per resident vs shared)

- **Per resident:** each resident gets its own `EngineBundle` in memory (`BUNDLES[entityId]`) and own state files under `server/residentBrain/state/engines/<entityId>/...`.
- **Not shared globally:** engine instances are not reused across residents.
- **Service-level globals:** only registry maps (`BUNDLES`) and service metadata are global.

## 4) What still comes from old local AI City logic

Still local and primary:
- world tick ownership (`CitySimManager.tick(...)`)
- movement and pathing (`MovementSystem`, `DecisionSystem` fallback branches)
- encounter initiation and conversation lifecycle (`ConversationSystem`)
- social relationship mutations and memory writes in CitySim (`SocialSystem`, `MemorySystem`)
- daily plan/life arc systems
- TTS/rendering/UI/LAN sync logic

Engine bridge currently augments intent/context/event processing; it does not replace the local simulation core.

## 5) What happens if brain service is off

- Adapter health checks fail in `ResidentBrainAdapter`.
- Residents are marked `brainKind: "local"` / disconnected.
- Decision path falls back to existing local `DecisionSystem` behavior.
- Conversations and memory continue using existing CitySim logic.
- App does not hard-crash from service outage by design.

## 6) Direct answers

- **“Are all 70 engines wired into NPC cognition?”**  
  No.

- **“Are NPCs fully controlled by Engines?”**  
  No. Core simulation control is still local AI City logic with selective engine influence.

- **“Which engines actually change NPC behavior today?”**  
  Primarily `GoalEngineGramps`, `DriveModelSeed`, `DailyRhythmLyra`, and `IntentSystem` via decision intent mapping.  
  `EmotionKernelGramps`, `RelationalMemorySystem`, and `ObserverClientSeed` mainly affect context/summaries, not hard control of movement loop.

