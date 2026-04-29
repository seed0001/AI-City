# FULL ENGINE WIRING REPORT

Generated from a real `EngineBundle.create + tick + synthesizeDecision + synthesizeConversationContext + recordEvent` run in `server/residentBrain`.

## Summary

- Total classes discovered in `Engines.{emotion,personality,memory,cognitive,behavior,utility}`: **119**
- True engine classes (after dataclass/enum filter): **103**
- Excluded data containers (dataclasses, enums, value records): **16**
- Engines instantiated per resident: **103**
- Composite engines wired (advanced_pairing): **4**
- Disabled after full lifecycle: **0**

### Active engines by role

- `COGNITION`: 45
- `CONTROL`: 7
- `EMOTION`: 5
- `EXPRESSION`: 12
- `MEMORY`: 10
- `PASSIVE_MONITOR`: 4
- `PERSONALITY`: 8
- `UTILITY`: 12

### Typed adapters available

- `ConnorStateBeast`
- `EmotionKernelGramps`
- `EmotionalFeedbackBeast`
- `KnowledgeFusionEngine`
- `MemoryManagerLyra`
- `MentalHealthEngineBeast`
- `ReasoningEngine`
- `RecompositionEngine`
- `ReflectionEngine`
- `ReflectionEngineGramps`
- `SelfModelGramps`
- `WordStoreSeed`

## Runtime Role Legend

- `CONTROL`
- `MEMORY`
- `EMOTION`
- `PERSONALITY`
- `COGNITION`
- `EXPRESSION`
- `UTILITY`
- `PASSIVE_MONITOR`
- `DISABLED_WITH_REASON`
- `DATA_CONTAINER`

## Per-engine status

Format: `package | module | class | runtime_role | status | composite | reason_if_disabled`

```text
behavior | Engines.behavior.behavioral_pulse_engine | BehavioralPulseEngine | CONTROL | active | - | 
behavior | Engines.behavior.cycle_engine_gramps | CycleEngineGramps | CONTROL | active | - | 
behavior | Engines.behavior.daily_rhythm_lyra | DailyRhythmLyra | CONTROL | active | - | 
behavior | Engines.behavior.drive_model_seed | DriveModelSeed | CONTROL | active | - | 
behavior | Engines.behavior.initiative_scheduler_seed | InitiativeSchedulerSeed | CONTROL | active | - | 
behavior | Engines.behavior.life_scheduler_lyra | LifeSchedulerLyra | CONTROL | active | - | 
behavior | Engines.behavior.seed_dynamics | SeedDynamics | CONTROL | active | - | 
cognitive | Engines.cognitive.action_engine_gramps | ActionEngineGramps | COGNITION | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | AdvancedPairingEngine | COGNITION | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | ConceptDictionary | COGNITION | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | ConversationMemory | COGNITION | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | EmbeddingEngine | COGNITION | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | FactDatabase | COGNITION | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | PatternLibrary | COGNITION | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | RejectionDatabase | COGNITION | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | ResponseChunkBuilder | EXPRESSION | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | SentenceParser | COGNITION | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | WordLibrary | COGNITION | active | - | 
cognitive | Engines.cognitive.cognitive_engine | AssociativeNetwork | COGNITION | active | - | 
cognitive | Engines.cognitive.cognitive_engine | ContextualAwareness | COGNITION | active | - | 
cognitive | Engines.cognitive.cognitive_engine | DreamIntegration | COGNITION | active | - | 
cognitive | Engines.cognitive.cognitive_engine | EmotionalMomentum | COGNITION | active | - | 
cognitive | Engines.cognitive.cognitive_engine | MemoryConsolidation | COGNITION | active | - | 
cognitive | Engines.cognitive.cognitive_engine | PredictiveProcessor | COGNITION | active | - | 
cognitive | Engines.cognitive.creative_engines | CreativeEngines | COGNITION | active | - | 
cognitive | Engines.cognitive.creative_writing_gramps | CreativeWritingEngineGramps | EXPRESSION | active | - | 
cognitive | Engines.cognitive.deep_review_engine_gramps | DeepReviewEngineGramps | COGNITION | active | - | 
cognitive | Engines.cognitive.deliberation_engine_gramps | DeliberationEngineGramps | COGNITION | active | - | 
cognitive | Engines.cognitive.goal_engine_gramps | GoalEngineGramps | COGNITION | active | - | 
cognitive | Engines.cognitive.hallucination_monitor_gramps | HallucinationMonitorGramps | PASSIVE_MONITOR | active | - | 
cognitive | Engines.cognitive.inner_monologue_gramps | InnerMonologueGramps | COGNITION | active | - | 
cognitive | Engines.cognitive.journaling_beast | JournalingEngineBeast | COGNITION | active | - | 
cognitive | Engines.cognitive.lambda_psi_connor | LambdaPsiEngineConnor | COGNITION | active | - | 
cognitive | Engines.cognitive.llm_drift_analysis_engine | LLMDriftAnalysisEngine | COGNITION | active | - | 
cognitive | Engines.cognitive.neural_emergence_connor | ActivationNetwork | COGNITION | active | - | 
cognitive | Engines.cognitive.neural_emergence_connor | EmergentThoughtEngine | COGNITION | active | - | 
cognitive | Engines.cognitive.neural_emergence_connor | NeuralEmergenceSystemConnor | COGNITION | active | - | 
cognitive | Engines.cognitive.neural_emergence_connor | SelfOrganizingClusterMap | COGNITION | active | - | 
cognitive | Engines.cognitive.prethink_connor | PreThinkEngineConnor | COGNITION | active | - | 
cognitive | Engines.cognitive.quantum_reasoning_connor | QuantumReasoningEngineConnor | COGNITION | active | - | 
cognitive | Engines.cognitive.real_intelligence_connor | AssociativeNetwork | COGNITION | active | - | 
cognitive | Engines.cognitive.real_intelligence_connor | ContextualAwareness | COGNITION | active | - | 
cognitive | Engines.cognitive.real_intelligence_connor | DreamIntegration | COGNITION | active | - | 
cognitive | Engines.cognitive.real_intelligence_connor | EmotionalMomentum | COGNITION | active | - | 
cognitive | Engines.cognitive.real_intelligence_connor | MemoryConsolidation | COGNITION | active | - | 
cognitive | Engines.cognitive.real_intelligence_connor | PredictiveProcessor | COGNITION | active | - | 
cognitive | Engines.cognitive.real_intelligence_connor | RealIntelligenceEngineConnor | COGNITION | active | - | 
cognitive | Engines.cognitive.reflection_engine_gramps | ReflectionEngineGramps | COGNITION | active | - | 
cognitive | Engines.cognitive.regulator_connor | RegulatorConnor | COGNITION | active | - | 
cognitive | Engines.cognitive.response_engine_beast | ResponseEngineBeast | EXPRESSION | active | - | 
cognitive | Engines.cognitive.self_regulation_beast | SelfRegulationEngineBeast | COGNITION | active | - | 
cognitive | Engines.cognitive.skill_acquisition_gramps | SkillAcquisitionEngineGramps | COGNITION | active | - | 
cognitive | Engines.cognitive.songwriting_lyra | SongwritingEngineLyra | EXPRESSION | active | - | 
cognitive | Engines.cognitive.thought_engine_gramps | ThoughtEngineGramps | COGNITION | active | - | 
emotion | Engines.emotion.connor_state_beast | ConnorStateBeast | EMOTION | active | - | 
emotion | Engines.emotion.emotion_kernel_gramps | EmotionKernelGramps | EMOTION | active | - | 
emotion | Engines.emotion.emotion_model_seed | EmotionModelSeed | EMOTION | active | - | 
emotion | Engines.emotion.emotional_feedback_beast | EmotionalFeedbackBeast | EMOTION | active | - | 
emotion | Engines.emotion.mental_health_beast | MentalHealthEngineBeast | EMOTION | active | - | 
memory | Engines.memory.episode_memory_gramps | EpisodeMemoryGramps | MEMORY | active | - | 
memory | Engines.memory.knowledge_base_gramps | KnowledgeBaseGramps | MEMORY | active | - | 
memory | Engines.memory.memory_core_gramps | MemoryCoreGramps | MEMORY | active | - | 
memory | Engines.memory.memory_manager_lyra | MemoryManagerLyra | MEMORY | active | - | 
memory | Engines.memory.memory_reconciliation_gramps | MemoryReconciliationEngineGramps | MEMORY | active | - | 
memory | Engines.memory.relational_memory_system | RelationalMemorySystem | MEMORY | active | - | 
memory | Engines.memory.seed_memory | SeedMemory | MEMORY | active | - | 
memory | Engines.memory.temporal_continuity_seed | TemporalContinuitySeed | MEMORY | active | - | 
memory | Engines.memory.unified_memory_seed | UnifiedMemorySeed | MEMORY | active | - | 
memory | Engines.memory.vector_memory_gramps | VectorMemoryGramps | MEMORY | active | - | 
personality | Engines.personality.identity_engine | IdentityEngine | PERSONALITY | active | - | 
personality | Engines.personality.personality_beast | PersonalityEngineBeast | PERSONALITY | active | - | 
personality | Engines.personality.personality_lyra | PersonalityEngineLyra | PERSONALITY | active | - | 
personality | Engines.personality.personality_seed | PersonalitySeed | PERSONALITY | active | - | 
personality | Engines.personality.self_model_gramps | SelfModelGramps | PERSONALITY | active | - | 
personality | Engines.personality.self_model_seed | SelfModelSeed | PERSONALITY | active | - | 
personality | Engines.personality.social_circle_lyra | SocialCircleLyra | PERSONALITY | active | - | 
personality | Engines.personality.story_of_self_seed | StoryOfSelfSeed | PERSONALITY | active | - | 
utility | Engines.utility.aging_engine | AgingEngine | UTILITY | active | - | 
utility | Engines.utility.audio_engine | AudioEngine | UTILITY | active | - | 
utility | Engines.utility.avatar_generator_lyra | AvatarGeneratorLyra | EXPRESSION | active | - | 
utility | Engines.utility.character_voice_seed | CharacterVoiceSeed | EXPRESSION | active | - | 
utility | Engines.utility.contact_manager_gramps | ContactManagerGramps | UTILITY | active | - | 
utility | Engines.utility.curiosity_engine_seed | CuriosityEngineSeed | UTILITY | active | - | 
utility | Engines.utility.dashboard_engine_beast | DashboardEngineBeast | PASSIVE_MONITOR | active | - | 
utility | Engines.utility.dj_music_beast | DJMusicEngineBeast | EXPRESSION | active | - | 
utility | Engines.utility.fallback_phrases_seed | FallbackPhrasesSeed | UTILITY | active | - | 
utility | Engines.utility.image_generation_engine | ImageGenerationEngine | EXPRESSION | active | - | 
utility | Engines.utility.instrumentation_connor | LambdaPsiInstrumentationConnor | PASSIVE_MONITOR | active | - | 
utility | Engines.utility.intent_system | IntentSystem | UTILITY | active | - | 
utility | Engines.utility.observer_client_seed | ObserverClientSeed | PASSIVE_MONITOR | active | - | 
utility | Engines.utility.ollama_client_connor | OllamaClientConnor | UTILITY | active | - | 
utility | Engines.utility.system_load_balancer | SystemLoadBalancer | UTILITY | active | - | 
utility | Engines.utility.vision_engine | VisionEngine | EXPRESSION | active | - | 
utility | Engines.utility.vision_module_gramps | VisionModuleGramps | EXPRESSION | active | - | 
utility | Engines.utility.vocabulary_enforcer_seed | VocabularyEnforcerSeed | UTILITY | active | - | 
utility | Engines.utility.voice_modulation_beast | VoiceModulationEngineBeast | EXPRESSION | active | - | 
utility | Engines.utility.web_crawler_gramps | WebCrawlerGramps | UTILITY | active | - | 
utility | Engines.utility.web_learner_seed | WebLearnerSeed | UTILITY | active | - | 
utility | Engines.utility.word_store_seed | WordStoreSeed | UTILITY | active | - | 
cognitive | Engines.cognitive.advanced_pairing_engine | RecompositionEngine | EXPRESSION | active | composite | 
cognitive | Engines.cognitive.advanced_pairing_engine | ReasoningEngine | COGNITION | active | composite | 
cognitive | Engines.cognitive.advanced_pairing_engine | KnowledgeFusionEngine | COGNITION | active | composite | 
cognitive | Engines.cognitive.advanced_pairing_engine | ReflectionEngine | COGNITION | active | composite | 
```

## Excluded data containers

These live in engine packages but are dataclasses, enums, or pure value records. They are not engines and are deliberately filtered out of the active inventory.

```text
cognitive | Engines.cognitive.cognitive_engine | Memory | DATA_CONTAINER | value object / dataclass / enum, not an engine
cognitive | Engines.cognitive.goal_engine_gramps | Goal | DATA_CONTAINER | value object / dataclass / enum, not an engine
cognitive | Engines.cognitive.lambda_psi_connor | ConnorSnapshot | DATA_CONTAINER | value object / dataclass / enum, not an engine
cognitive | Engines.cognitive.neural_emergence_connor | NeuralCluster | DATA_CONTAINER | value object / dataclass / enum, not an engine
cognitive | Engines.cognitive.neural_emergence_connor | NeuralNode | DATA_CONTAINER | value object / dataclass / enum, not an engine
cognitive | Engines.cognitive.neural_emergence_connor | ThoughtPattern | DATA_CONTAINER | value object / dataclass / enum, not an engine
cognitive | Engines.cognitive.quantum_reasoning_connor | QuantumState | DATA_CONTAINER | value object / dataclass / enum, not an engine
cognitive | Engines.cognitive.quantum_reasoning_connor | QuantumThought | DATA_CONTAINER | value object / dataclass / enum, not an engine
cognitive | Engines.cognitive.real_intelligence_connor | Memory | DATA_CONTAINER | value object / dataclass / enum, not an engine
cognitive | Engines.cognitive.regulator_connor | RegulatorSettings | DATA_CONTAINER | value object / dataclass / enum, not an engine
memory | Engines.memory.episode_memory_gramps | Episode | DATA_CONTAINER | value object / dataclass / enum, not an engine
memory | Engines.memory.knowledge_base_gramps | KnowledgeEntry | DATA_CONTAINER | value object / dataclass / enum, not an engine
memory | Engines.memory.seed_memory | Episode | DATA_CONTAINER | value object / dataclass / enum, not an engine
memory | Engines.memory.unified_memory_seed | UnifiedEpisode | DATA_CONTAINER | value object / dataclass / enum, not an engine
personality | Engines.personality.personality_lyra | EmotionalState | DATA_CONTAINER | value object / dataclass / enum, not an engine
utility | Engines.utility.contact_manager_gramps | Contact | DATA_CONTAINER | value object / dataclass / enum, not an engine
```

## Acceptance audit

- Every resident gets its own FullEngineBundle: yes (per-resident `state/engines/<id>/...`).
- All compatible engines instantiated: yes (103/103).
- All compatible engines called in the brain loop: yes (typed adapters or generic phase methods).
- Final decision synthesized from full brain state: yes (`source = full_brain_synthesis` when at least one engine produced a usable intent).
- Old local AI City decision tree is fallback only: yes (`DecisionSystem.runAiDecision` calls `residentBrainAdapter.getDecision` first).
- Debug exposes active / passive / disabled per resident: yes (`/brains/{entityId}/debug` plus HUD `ResidentBrainDebugSection`).
- No vague language: every disabled or excluded class has a literal reason above.
