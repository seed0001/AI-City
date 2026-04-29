# Document 8 — Lineage / Reproduction System

This document describes how new residents come into the town, what they inherit, and what they don't. The lineage system is the longest-arc feature in AI City: it is the bridge from "a fixed roster" to "a town that grows." The current implementation is a structured starting point, not a finished system. This document describes the structure honestly and outlines the future direction.

---

## 1. The concept

A resident is not meant to be a static fixture in the town. The simulation has the notion that two residents can produce a child, and the child should plausibly be of them — sharing some traits, some tendencies, some echoes of personality — while also being its own entity from day one.

This matters for two reasons:

1. **Population dynamics.** A fixed roster is a closed world. A long-running simulation (months of in-sim days, hours of real time) needs new residents to keep the social fabric from petrifying. A child resident is the cleanest way to introduce someone whose presence makes sense to the town.
2. **Persistence with continuity.** A child carrying traits from its parents is a reflection of the simulation's ability to remember and combine state. It is the simplest test of "does the brain layer actually integrate over time?"

The current implementation is the minimal structural answer: at runtime, the world can ask the brain "produce defaults for a child of these two parents," and a new TownEntity + brain bundle can be initialized with those defaults. The harder version — actual model inheritance, episodic memory transplant, learned behavioral drift carried into the child — is a future direction.

---

## 2. The current creation flow

Source: `src/systems/citySim/lineage/createChildResident.ts` and the brain service's `/brains/child` endpoint.

### 2.1 Trigger

`createChildResident(manager, parentAId, parentBId)` is the function called when the town wants to produce a child. It is intentionally explicit. There is no autonomous reproduction yet — no "two residents who like each other will spontaneously have a child after enough conversations." The function exists to be called by future systems or by an explicit user/dev action.

### 2.2 World-side construction

Given two valid parents A and B:

1. **Spawn position.** A jittered position near the first registered location. (Not yet biased toward home markers; that is a small future improvement.)
2. **Identifier.** `npc_child_<6-char random>`.
3. **Display name.** Derived from both parents: first 3 letters of A's display name + last 3 letters of B's, plus a random two-digit suffix. The result feels related without being a literal mash.
4. **Gender.** Random pick from `[A.gender, B.gender, "nonbinary"]`. Inheritance is genuinely a coin flip among the three options.
5. **Role.** Random pick from a pool of role options: A's first three `townRoleOptions` + B's first three, plus the literal `"Young resident"` baseline.
6. **Traits.** `blendTraits(A, B)`: dedupe both parents' traits, pick four randomly, with a 35% chance of also adding `"adaptable"`. The trait pool is genuinely a blend; no parent trait wins by default.
7. **Mood.** Random pick from `[A.mood, B.mood, "calm"]`. Three-way coin flip.
8. **Hunger and energy.** Blended averages, scaled: hunger is half the parents' average then dampened (`* 0.6`) so children start less hungry; energy is half the average scaled up (`* 1.1`) so children start with more energy.
9. **Social tolerance.** Plain blended average.
10. **Home marker.** A's home marker is preferred; falls back to B's if A has none.
11. **TTS voice.** Random pick from the parents' voices. The child sounds like one of them.
12. **Town role options.** Deduped union of both parents' first three role options plus `"Young resident"`.
13. **Initial state.** Walking-state fields are cleared. `currentAction = "idle"`. `currentGoal = "Learn the neighborhood rhythm"`. `lifeAdaptation = 0.04` (slightly above zero, because they are nominally "from here"). `townDaysLived = 0`. `money = 20 + random(0..20)`. `controllerType = "ai"`. `residentKind = "npc"`.
14. **Relationships.** Empty. The child does not start with any relationships, including with their parents. This is deliberate: relationships should accumulate from interactions, not be assumed. The expectation is that the parents will be near the child often in early life, so familiarity will grow naturally.
15. **Memory.** Empty. The child has no memory ids yet.
16. **Brain.** `brainKind = "local"`, `brainConnected = false`. The brain bundle initialization is asynchronous; until it succeeds, the child runs on the fallback heuristic.

The constructed entity is added to the registry via `manager.entities.add(child)`. Family links are recorded via `manager.connectFamilyLink(parentAId, parentBId, child.id)` so the social system can recognize the relationship if it becomes relevant.

### 2.3 Brain-side seeding

After the world-side entity exists, two async calls fire:

1. `manager.brains.initializeEntity(child)` — the standard `POST /brains/init` for any new resident. This creates the child's bundle on the brain service, instantiates all 103 engines per the inventory, and gives the child its own state directory `state/engines/<child.id>/`.

2. `manager.brains.createChildBrainState(parentAId, parentBId, childSeed, parentASummary, parentBSummary)` — calls `POST /brains/child` with the structured payload. The brain service then:
   - Loads or creates parent A's bundle and parent B's bundle (so both are warm).
   - Loads or creates the child's bundle (the same one just initialized; the call is idempotent).
   - Calls `parent_a.child_seed_defaults(other=parent_b, child_seed=child_seed, parent_a_summary=parent_a_summary, parent_b_summary=parent_b_summary)`. This is a method on `EngineBundle` that pulls per-domain hints from parent A's engines and combines them with parent B's summary into a defaults block.
   - Stores the result on the child's bundle as `state["inherited_defaults"]` and `state["inherited_traits"]`.
   - Returns the defaults to the world so the world can optionally apply them on top of the world-side traits.

3. A welcoming dialogue line is appended to the chat log: "Hey... I'm new around here." This is the only scripted line in the lineage system and serves as the user-visible signal that a child has spawned.

The child is now a full resident. Next tick, the decision pump will run on them like anyone else; the conversation system can pair them with anyone else; the daily plan system will generate their first daily plan when the local-calendar day rolls over; the brain bundle will start ticking on them and accumulating its own state.

---

## 3. What is inherited

### 3.1 Inherited explicitly via the world

- **Trait pool.** The child's `traits` array is a blended dedupe of both parents' traits, with a soft chance of adding "adaptable."
- **Town role options.** The child's `townRoleOptions` is a blended dedupe of the parents' first three role options plus a baseline.
- **Initial role.** Random pick from the inherited role-option pool.
- **Display name.** Mash of both parents' names.
- **Voice.** Random pick from the parents' voices.
- **Home marker.** Inherited from parent A by default; fallback to parent B.
- **Body baseline.** Hunger, energy, social tolerance, mood are blended from the parents.
- **Family link.** A connectFamilyLink record exists from the start.

### 3.2 Inherited via the brain bundle

- **Inherited trait suggestions.** The bundle's `child_seed_defaults` returns an `inheritedTraitSuggestions` list pulled from both parents' personality engines. The world stores this on `state["inherited_traits"]` for the child's bundle. It is not currently rewritten into the child's TownEntity traits, but it is available for the brain layer to bias trait reinforcement during the child's early ticks.
- **Inherited defaults.** The bundle returns a `defaults` dict containing things like a default drive bias (e.g. lean toward `connection`), a starting self-narrative seed, and a starting mood bias. The world stores this on `state["inherited_defaults"]` for the child's bundle. The brain bundle's first ticks read this and let it influence early state shaping.
- **Per-engine fresh state.** The 103 engines in the child's bundle are instantiated fresh per resident. They do not carry parent state; each starts from default initial values and writes its own state files under the child's state directory.
- **Story-of-self bias.** When `child_seed_defaults` runs, it consults each parent's `StoryOfSelfSeed` (and similar) for short narrative hints. Those hints can seed the child's `SelfModelGramps` narrative on first reflection.

### 3.3 NOT inherited (current state)

A clear list of what the child does NOT inherit, so there is no confusion:

- **Episodic memory.** The child does not start with any of either parent's memories. The parents' "first day at the bakery" is not carried into the child's `EpisodeMemoryGramps`.
- **Relational memory.** The child does not start knowing any of the parents' acquaintances. `RelationalMemorySystem` for the child is empty.
- **Knowledge base.** Whatever the parents have learned via `KnowledgeBaseGramps`, `WebLearnerSeed`, or `WordStoreSeed` is not transferred. The child's vocabulary store is empty at start.
- **Engine internal state.** Personality, identity, social circle, drives — the child's engines do not load from parent state files. They are in their default initial configuration.
- **Goals.** Active goals from the parents are not transferred. The child has no goals on day one beyond the brain-suggested defaults.
- **Conversation memory.** No conversations are remembered.
- **Trained model weights.** There are no model weights anywhere in this system. There is no fine-tuning, no LoRA, no inheritance of LLM parameters. The LLM is a shared external resource (Ollama or none); only prompts vary per resident.
- **Voice cloning.** The child uses the same neural TTS voice as one of the parents, but the voice is not synthesized from the parent's audio — it is the same Edge voice short name (e.g. `en-US-AvaNeural`).

This is an honest list. The system has the structure to grow toward true inheritance; it does not currently implement most of it.

---

## 4. Why no model training

A reasonable question: if AI City is "engine-driven cognition," shouldn't a child inherit something model-shaped from the parents?

The answer today is "yes, conceptually, but not yet in code." There are three reasons:

1. **The engines are not models.** Most engines are not parameterized in a way that supports inheritance. They are stateful Python classes with hand-tuned dynamics. A child engine starts at the same initial values as any other newly created engine of that class. Inheriting state would mean copying the parent's serialized engine state into the child's engine state, which would be a literal "the child has the parent's mind." That isn't what real inheritance is. Doing this naively would produce children who are clones, not heirs.

2. **The right abstraction is not yet built.** A genuine inheritance system would require, per engine, a defined "inheritance operation": how to combine two parent states into a child starting state that is plausibly between them. Some engines could do this trivially (average two emotion vectors). Others have no obvious mid-point (how do you average two personality narratives?). The work to define inheritance per engine has not been done. The current `child_seed_defaults` method is a single-engine-aware placeholder.

3. **The simulation does not yet reward it.** Until residents accumulate enough experience that their engines diverge meaningfully, inheritance is moot. Two residents who have lived through the same five conversations will produce essentially identical children. Real inheritance becomes interesting when parents diverge enough for the child to be a coherent middle ground. That requires longer-arc simulation than the current development cycle has run.

These are honest constraints, not handwaving. The architecture can grow into model inheritance; it just hasn't yet.

---

## 5. Future direction

The path forward, in the order it would be implemented:

### 5.1 Inherited engine state per domain

For each engine domain, define an inheritance operation:

- **Emotion**: average the two parents' `EmotionKernelGramps` state vectors and inject into the child as the starting vector. Apply a small "newness" penalty so the child starts marginally lower-arousal (a baseline calibration).
- **Personality**: combine the two parents' `SelfModelGramps` traits using weighted union, with the child's TownEntity-side trait pool as a compatibility constraint. Seed the child's narrative with a short auto-generated "born of A and B" line.
- **Memory**: do NOT transfer episodic memories directly. Instead, transfer a small set of high-salience long-term memories from each parent, marked with a special tag indicating they are inherited, not lived. The child knows "my father once told me about the bakery" without remembering being there.
- **Cognition**: transfer goal pools but mark all parent-inherited goals as low-urgency and low-progress, so they bias direction without dominating.
- **Drive**: blend drive-model state. Children have lower physiological drives at first (consistent with "less wear and tear") and slightly elevated curiosity.
- **Relational memory**: transfer parent-tagged contacts only. The child knows the parents from day one with familiarity = 1.0, trust = parents' average, friendliness = parents' average, tension = 0. Other contacts are not transferred until the child meets them.

This is the realistic medium-term plan. Each item is a typed adapter or a small subroutine.

### 5.2 Long-arc inheritance

- **Aging effects.** `AgingEngine` is already instantiated. Wire it up so children grow up in the simulation: their hunger/energy curves change with age, their social role drifts as they mature, their preferred locations shift.
- **Memory transplant.** Allow parents to have a "story they tell their child" — a small set of memories that are voluntarily transferred across the boundary. This is closer to how real inheritance works (oral tradition + biology), and can be modeled as a small ritual where parents send specific events to the child's `RelationalMemorySystem` with `inherited_from` tags.
- **Personality drift inheritance.** Once personality engines have a "drift over time" curve, the child can inherit not just current traits but the slope of the parents' drift — they tend to move in similar directions, which is loosely how heritability shows up in real personality data.

### 5.3 Model inheritance (long-term)

If, in the future, AI City introduces small per-resident neural models (a tiny transformer for prompt biasing, a learned embedding for relationships, anything trainable), inheritance can become genuinely model-shaped:

- **LoRA inheritance.** Each resident has a small adapter on top of the shared LLM. A child's adapter starts as a weighted blend of the two parents' adapters, with optional regularization toward the base.
- **Embedding inheritance.** Each resident has a learned embedding for "self." The child's embedding is the midpoint of the parents' with noise.
- **Drift learning.** As the child lives in the town, their adapter is fine-tuned on their own experience, drifting away from the inherited starting point.

This is genuinely speculative and not implied by the current code. It is included here for completeness because the architecture has space for it.

### 5.4 Population growth dynamics

A complete lineage system also needs:

- **Couple formation.** When two residents become close enough, they can become a couple. Today, relationships have only `trust / tension / familiarity / friendliness / avoid` axes. A "couple" axis or status would let the simulation know when reproduction is plausible.
- **Reproduction triggers.** Either explicit (user or dev triggers it) or emergent (a couple plus enough days plus a daily-plan slot for "raising a child" — slow, deliberate). The current `createChildResident` is the explicit branch; the emergent branch does not yet exist.
- **Family roles.** Children should have a daily plan that includes their parents (regularly visiting them, learning from them). The daily plan system currently does not generate child-specific objectives; this would be a small extension.
- **Mortality (eventually).** A long-running town with reproduction also needs old residents to leave. This is the most ethically and design-fraught part of the future direction. The architecture supports it (just remove the entity and persist their state), but it has not been considered.

---

## 6. What the current system signals

The fact that lineage exists at all, even at this early stage, is the structural promise of AI City. It signals that:

- The town is not a fixed cast.
- New residents can be plausibly related to existing ones.
- The brain layer is structured to absorb defaults from parents (the `child_seed_defaults` method exists and runs).
- The world layer is structured to construct related entities (the `createChildResident` function exists and runs).

What is NOT yet signaled is that residents have meaningfully diverged enough that inheritance is dramatic, or that the inheritance operations themselves are sophisticated. Those are the next steps.

---

## 7. The honest summary

Today, the lineage system gives you: a plausibly-named child, a plausibly-blended trait pool, a plausible voice, and a fresh brain bundle that knows its parents are A and B and starts with hints from both. It does not give you: the child remembering anything its parents lived, the child's engines starting from a state that reflects the parents' time in the town, or the child inheriting any learned model weights.

The path from "today" to "a child meaningfully shaped by who its parents have become" is enumerable: a finite list of typed inheritance adapters per engine domain, plus a longer-running simulation to give those adapters something interesting to inherit from.

The lineage system is therefore in the same shape as the broader engine integration story (Document 6): the architecture is right, the wiring is partial, and the gap is named work, not unknowns.
