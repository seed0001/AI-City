# Document 1 — Project Vision and Core Idea

This document explains what AI City is, what it is trying to be, and why it is structured the way it is. It assumes no prior knowledge of the codebase.

---

## 1. What this system is

AI City is a 3D simulated town that runs in a web browser, populated by characters whose decisions, emotions, memories, and conversations are driven by a separate Python service that hosts roughly 100 cognition modules ("engines"). The browser handles the world and the bodies of the characters; the Python service handles their minds.

Concretely there are three layers running at the same time:

1. A **browser application** (React + Three.js) that draws the town, moves the residents, animates avatars, plays speech audio, and renders the user interface.
2. A **simulation layer** (TypeScript, inside the same browser app) that maintains the state of the town: which residents exist, where they are, what they are doing, who is talking to whom, what each one remembers, what their daily plan looks like.
3. A **Resident Brain Service** (Python, FastAPI) that runs alongside the browser on the same machine (or LAN). For every resident in the town it constructs a private bundle of cognition engines and exposes that bundle over HTTP to the simulation layer.

When the user opens the page they see a small town. Characters walk around, sometimes pause, sometimes talk to each other or to the user's character. The user can move freely as a resident, can speak (the system uses text-to-speech for NPC voices), and can observe the world running on its own.

The interesting part is not the visuals. The interesting part is that the characters are not driven by hand-written behavior trees, by scripted quests, or by a single chat model that "plays" them. They are driven by a long-running, stateful, modular cognition layer that is trying to imitate the structure of a mind: needs, drives, emotions, personality, memory, goals, intent, reflection, social ties, episodic recall.

## 2. The problem this is solving

The two normal answers for "intelligent characters in a digital world" are bad in opposite directions.

- **Game NPCs** are usually scripted. They have a few states, a few canned lines, and they react to triggers. They do not change. They do not remember you, except in the narrow ways the designer hand-wired. They never surprise you.
- **Chatbots** are stateless or near-stateless. They produce convincing-sounding text on demand, but they have no body, no place, no ongoing life, and no real memory across sessions. They do not have intentions of their own. They wait for you to message them.

AI City is trying to occupy the space between these two. The goal is characters that:

- Live in a place. They have a position, a home, a role, neighbors, a daily rhythm, a way they tend to spend their time.
- Have a continuous inner state. Their mood, their hunger, their tiredness, their relationship with you, their unresolved intents, their recent episodes — all of this persists between ticks, between sessions, and ideally between days.
- Make their own decisions. They choose where to go, who to talk to, what to do, based on their internal state, not because the player told them to.
- Speak in their own voice. When they talk, the line is shaped by what they currently feel, what they want, who they are talking to, and what they remember.
- Change over time. As they live in the town, their relationships shift, their memory builds, their personality traits get reinforced or contradicted.

This is "a living world" in the simplest sense of the phrase: a world that keeps existing, and keeps changing, even when no one is watching.

## 3. The "living world" concept

A living world means the town keeps running. Residents move while you are not in the room. Their needs decay. Their daily plan ticks forward. They form opinions about the people around them. When you come back, things have happened.

Concretely, the simulation layer:

- Decays each AI resident's energy and hunger continuously while the sim is enabled.
- Keeps a daily plan per resident, with concrete objectives that day, needs (rest, food, connection, purpose), and desires.
- Tracks `townDaysLived` per resident: how many in-sim local-calendar days they have spent in the town.
- Tracks `lifeAdaptation` per resident: how rooted they are becoming in this town, derived from days lived, needs satisfaction, and memory accumulation.
- Tracks every encounter, every conversation, every meaningful event into a layered memory store: short term, episodic, long term, with reinforcement-driven salience.

This is not a simulation of the universe. It is a simulation of a small town's social and emotional pulse, at a level abstract enough to actually run in real time.

## 4. The persistent simulation idea

Persistence has two senses here, and both matter.

- **Layout persistence**: the town's physical layout (where homes, parks, stores, paths, and the player are placed) is stored in browser local storage. When you reload the page, the same town comes back. NPCs are spawned at their preset markers from this saved layout.
- **Mind persistence**: every resident's brain state lives on disk under `server/residentBrain/state/engines/<entityId>/`. Each engine for that resident has its own JSON file. When the sim restarts, the brain bundle for that resident reloads its engines and resumes from where it left off — emotional state, recent events, personality drift, intent backlog, etc.

The implication is that two playthroughs of the same town are not interchangeable. The residents are accumulating real history. They will eventually have memories of you, opinions about you, ongoing concerns about each other.

This is what separates "persistent" from "save/load." The state is not snapshotted at convenient checkpoints. It is the natural byproduct of the engines running — they are designed to maintain state continuously, regardless of whether the world is rendered.

## 5. The engine-driven consciousness concept

The cognition layer is not a single neural network. It is a curated library of about 100 small engines, each focused on one slice of mental life. Examples (described in detail in Document 4):

- **Emotion engines**: a kernel that holds the current emotional vector (love, anger, anxiety, trust, etc.), a feedback engine that scores recent interactions, a mental health engine that tracks longer-arc conditions.
- **Personality engines**: a self-model that maintains traits and a narrative of who this resident is, an identity engine, a story-of-self engine.
- **Memory engines**: an episode store, a knowledge base, a vector memory, a relational memory system that tags memories by who they involve and how they felt, a temporal continuity engine.
- **Cognitive engines**: a goal engine, a deliberation engine, a reflection engine, a thought engine, an inner monologue engine, a deep review engine, a quantum reasoning engine, an emergent thought engine, and so on.
- **Behavior engines**: drive model, behavioral pulse, daily rhythm, life scheduler, initiative scheduler, cycle engine.
- **Utility engines**: intent system, contact manager, web learner, observer client, vocabulary enforcer, fallback phrases, and others.

For every resident the brain service builds a private bundle of every compatible engine and gives that resident its own state directory. When the simulation asks "what should this resident decide right now?" or "build me the conversation context for this resident," the brain service runs the bundle through phased calls (physiology → emotion → memory → personality → cognition → behavior → expression → utility), collects votes and outputs from the active engines, and synthesizes a single answer.

This is what "engine-driven consciousness" means in this codebase: a resident's mind is the running orchestration of dozens of small specialists, each with its own state, contributing to a synthesized decision and a synthesized prompt context. The engines themselves are not stateless functions; they evolve over time. The synthesis is opinionated and explicit. There is no "main thinking model" — there are many, layered.

This is also a deliberate bet. The hypothesis is that something closer to plausible mind-like behavior comes from many narrow modules cooperating with persistent state, rather than from one big chat model improvising. AI City is an experiment in whether that bet pays off.

## 6. The lineage / reproduction goal

A long-running town needs to grow. Residents should be able to produce new residents, and those new residents should plausibly inherit something from their parents. AI City has the beginning of this:

- A function `createChildResident(parentA, parentB)` constructs a new entity in the town. The child blends parent traits (pool of distinct traits drawn from both parents, with a chance of adding "adaptable"), takes a name derived from both parents' display names, picks a gender from the parents' pool (or nonbinary), copies a home marker from one parent, blends starting hunger and energy, and so on.
- The brain service exposes a `/brains/child` endpoint. When a child is created, the engine bundle of one parent runs `child_seed_defaults`, which uses summaries of both parents to seed defaults for the child's bundle: inherited trait suggestions, default values, a story-of-self bias.
- The child gets its own brain bundle the moment it is initialized. From that point forward, its mind evolves on its own.

The current implementation is a structured starting point, not a full inheritance system. There is no model training. There are no inherited episodic memories. The child does not start out remembering its parents' specific events. The vocabulary store, the emotional state, the relational memory, the goals — all of that is fresh for the child.

The vision is bigger than the current implementation. The goal is that, over many simulated days, traits actually drift, personalities actually inherit, and child residents grow up with discernible echoes of their parents. Document 8 covers the current code in detail and explains what would have to change to get from here to there.

## 7. How this is different from a normal game

A normal game has scripted NPCs. The script is written by humans, encoded in code or in a behavior graph, and replays the same way every time unless the script branches. AI City does not have that script. There is no quest tree, no dialogue tree, no triggered cutscene. The world has only:

- A physical layout (placed markers and paths).
- A roster of residents with seed personas and starting locations.
- A simulation loop that ticks every frame.
- A cognition service that residents consult to decide what to do and what to say.

Anything that looks like a behavior in the game is the emergent output of those four things running together. If a resident decides to go home, it is because the engine layer (or the fallback heuristic, when the engine layer is offline) said `go_home`. If they say "Make it quick," it is because their emotional state, their drive state, and their relationship with the speaker all combined to produce that line through a structured prompt anchored on engine context.

This means AI City is also more brittle than a scripted game. There is no guaranteed plot. There is no "win condition." There is no fail-safe behavior except the fallback decision tree. The price of "alive" is "unpredictable."

## 8. How this is different from a chatbot

A chatbot is a single agent with a single persona prompt and no body. It exists as text. AI City residents are different in three concrete ways.

- **They have a body in a world.** Every resident has a position, an action ("idle", "walking", "talking", "sitting", "leaving"), a current location, a destination, a daily plan. When they say something, the line is grounded in the place and the moment, not in a free-floating chat session.
- **They have continuous internal state outside conversation.** Their mood, hunger, energy, social tolerance, drive state, intent backlog, recent episodes, relationships — all of this evolves while they are not talking. The conversation is one expression of the underlying state, not the source of it.
- **They are run by an orchestration of many engines, not a single chat model.** When a resident speaks, the line is shaped by an "engine brain context" — a structured pull from the emotion kernel, the relational memory system, the intent system, the goal engine, the drive model, the self model, and the episode memory. The chat model (when present, via local Ollama) is the speech surface; it formats the spoken words. It does not decide the resident's emotional state.

This separation matters. A chatbot is a voice without a person. An AI City resident is a person, with a voice on top.

## 9. What this all amounts to

AI City is not trying to be a finished product. It is trying to be a working substrate for the question: *can a town be alive enough that its residents' moods, memories, and relationships actually feel like theirs?*

The honest answer right now is: partially, and noticeably more than before. The infrastructure for it exists. Every resident has a real mind in the brain service. Every conversation pulls from real engine state. Every event feeds back into real memory and intent. After the engine influence expansion (Doc 10): roughly 73 of 103 engines per resident now contribute captured output per tick, the decision pipeline aggregates weighted votes from typed adapters, capability-driven contributors, and explicit emotional / personality / world-state bias channels, and the conversation context exposes a parallel `extendedContext` block that surfaces the wider engine state to the HUD. Sixteen of the engines still have hand-written, type-aware adapters that produce the sharpest output; the rest are now reached through a one-time capability scan and a signature-aware generic adapter. The system is further along the path than it was — it is still not at the destination.

The remaining documents describe what currently exists, what it does at runtime, what is wired, and what is not — in plain language, without claiming more than the code actually delivers. Document 10 is the change record for the engine influence expansion specifically.
