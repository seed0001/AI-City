# Document 11 — Conversation Session System

This document is the change record for the work that turned AI City conversations from one-shot two-line micro-exchanges into persistent multi-turn dialogue sessions. It is written so that someone reading just this document can understand *what changed*, *why it changed*, *what it preserves*, and *where the seams are*.

This is a companion to Documents 2, 3, 7, and 9, which were updated in lock-step. Where those documents describe the post-session system as-is, this document describes the transition.

---

## 1. Why this work happened

Before this change, conversations had the right *skeleton* but the wrong *pacing and arc*. The `ConversationSystem` already pumped 2-line LLM batches with TTS-aware turn timing and per-batch memory writes. The decision system already skipped entities flagged `inConversation`. The structure was correct.

What was wrong was that conversations almost always ended after one or two batches. Three causes were observed:

1. **`computeTalkBudget` returned a single ceiling, defaulting to 4 micro-exchanges (≤ 8 lines) and dropping to 1–2 micro-exchanges for hungry / tired / tense pairings.** A conversation between someone slightly hungry and someone slightly tense was capped before it could develop.
2. **The LLM's `sceneOutcome.continue: false` was honored after the first batch with no minimum-turn floor.** The model could close a conversation on its first reply.
3. **There was no concept of a topic, conversational goal, unresolved question, or emotional arc carried forward between batches.** Each batch's prompt saw the recent lines but no "we are here to resolve X" framing. Memory was written per batch as small fragments, not as a session-level arc.

The visible symptom: NPCs took one turn each, and the decision scheduler released them into unrelated wandering. Conversations felt like disconnected one-liners.

The fix was an architectural one: keep the existing batched LLM call as the delivery mechanism, but lift everything else — turn budgeting, topic continuity, continuation policy, interrupt detection, end-of-arc memory — into a true `ConversationSession` with a persistent state model. The decision system's existing `inConversation` lock holds for the entire arc.

---

## 2. What the five phases delivered

### Phase 1 — `conversationSession.ts` (new module)

Added `src/systems/citySim/conversationSession.ts` with:

- **`ConversationSession` type** that extends the public `Conversation` type with the full arc state: `category`, `minTurns`, `maxTurns`, `turnIndex`, `currentSpeakerId`, `topic`, `topicStack`, `conversationGoal`, `unresolvedQuestion`, `lastSpeakerIntent`, `lastListenerReaction`, `emotionalTone`, `relationshipContext`, `recentLines`, `summarySoFar`, `status` (`active` / `winding_down` / `ended`), `endReason`, `lastContinuationReason`, `lastInterruptCheckAt`, `commitments`.
- **`ConversationCategory`** — six kinds: `casual`, `work`, `planning`, `emotional`, `argument`, `deep`.
- **`ConversationEndReason`** — typed union covering natural close, max-turns, separation, idle, lost participant, stub failure, post-min LLM stop, and interrupt cases (`interrupt:hunger`, `interrupt:fatigue`, `interrupt:danger`, `interrupt:obligation`, `interrupt:dev_command`).
- **`EmotionalTone`** — `warm`, `neutral`, `tense`, `playful`, `heavy`, `guarded`.
- **`budgetForCategory(category)`** — returns the min/max turn band per the spec: casual 4–8, work 4–10, planning 6–14, emotional 8–16, argument 8–20, deep 10–24.
- **`inferCategory({a, b, topic, openerText})`** — picks a category from opener content (regex bands for planning / work / emotional / deep keywords) and relationship state (high tension → argument; high trust + low tension + familiarity → deep; default → casual).
- **`inferEmotionalTone({category, tension, moodA, moodB})`** — derives tone from category + tension + mood.
- **`decideContinuation(session, llmContinue)`** — the engine-wins-on-stop policy. Below `minTurns` always returns continue; at/above `maxTurns` always ends; an unresolved question forces continuation; tense or heavy tone gets up to 4 extra turns past min; otherwise the LLM signal is honored.
- **`detectInterrupts(participants, allEntities)`** — conservative interrupt thresholds: `hunger >= 0.92`, `energy <= 0.06`, threat within 4u (avoidingEntityId proximity), and daily-plan purpose-need `<= 0.15` with an unfinished objective.
- **`buildSessionArcSummary({session, participants})`** — builds the one-paragraph end-of-session memory (topic, turns, goal, summary so far, tone, commitments, unresolved question, end reason).
- **`recordLine(session, turn, cap=8)`** — appends to `recentLines` with cap, increments `turnIndex`, sets `currentSpeakerId`.

Cost: zero per-tick allocations beyond the session object itself. All helpers are pure.

### Phase 2 — Structured layer extension (`conversationStructured.ts`)

Replaced the single-cap `computeTalkBudget(a, b)` with category-aware **`computeConversationBudget(a, b, hints?)`** that returns `{category, minTurns, maxTurns}`. The old function is kept as a deprecated shim for any external caller.

`computeConversationBudget` takes optional `topic` and `openerText` hints (the brain's `currentIntent`, the resident's `currentGoal`) so category inference has signal beyond mood + tension. Survival pressure (severe hunger, severe fatigue) trims `minTurns` toward but never below a hard floor of 2. Argument-category sessions with high tension get a small `maxTurns` extension so the emotional charge doesn't get cut prematurely.

`NpcConversationScenePacket.conversationState` was extended from `{turnNumber, lastTopic, maxTurns}` to a full session view: `turnIndex`, `topicStack`, `minTurns`, `category`, `status`, `emotionalTone`, `conversationGoal`, `unresolvedQuestion`, `summarySoFar`, `lastSpeakerIntent`, `lastListenerReaction`. The legacy `turnNumber` field is preserved as an alias of `turnIndex` for backwards compatibility.

`StructuredNpcExchangeResult` was extended with optional fields the model (and stub) can fill: `nextTopic`, `conversationGoal`, `unresolvedQuestion`, `lastSpeakerIntent`, `lastListenerReaction`, `summaryDelta`, `commitments`. All optional — when absent the `ConversationSystem` keeps the old session value.

`buildNpcConversationScenePacket` signature changed from `(a, b, locations, memories, nextTurnNumber, maxTurns, lastTopic, conversationTurns, engineContexts)` to `(a, b, locations, memories, session: SessionPacketState, conversationTurns, engineContexts)`. The `SessionPacketState` interface is the snapshot of session metadata forwarded to the LLM each batch. The recent-window for prompts grew from 4 → 8 lines.

The stub `generateStubStructuredNpcExchange(packet)` was rewritten. It is now opener-aware (turn 0 establishes topic + goal + question), mid-arc-aware (turns push the topic, surface concrete grievances or memories, propose plans, name blockers), and wind-down-aware (turns near `maxTurns` confirm or table the goal). It is category-flavored: argument lines push back, planning lines name blockers and propose phasing, emotional / deep lines surface feelings and ask what would help. It detects `I'll handle / cover / run / take / do` patterns in B's reply and records them as commitments.

### Phase 3 — `ConversationSystem.ts` rewrite

The private `EngineConversation` type became `RuntimeSession extends ConversationSession`. Same private system, real session under it. Runtime-only fields (`pendingLines`, `activeBatch`, `inFlight`, `waitingForSpeech`, etc.) live on `RuntimeSession`; everything else lives on the `ConversationSession` portion.

`turnIndex` now counts individual lines (not batches). `minTurns` / `maxTurns` are line counts. The legacy `microExchangeIndex` is kept as a runtime counter (for the stub-fallback pacing) but no longer drives end conditions.

`tickOneConversation(c, a, b, allEntities, now)` runs in this order each pump tick:

1. If `waitingForSpeech` is true and the deadline has not passed, return.
2. If pending lines exist and `TURN_DELAY_MS` has elapsed, emit the next line.
3. Hard-end conditions: separated, idle-timeout. Each sets a typed `endReason`.
4. **Interrupt check.** `detectInterrupts([a, b], allEntities)` runs every tick. On a hit, the session ends with the matching `interrupt:*` reason. Conservative thresholds (per agreed tradeoff): only true emergencies break a session below `minTurns`.
5. **Continuation policy.** `decideContinuation(c, c.canScheduleMore)` — the engine-wins-on-stop policy. The LLM's `sceneOutcome.continue` becomes `c.canScheduleMore`, but the actual decision factors that in alongside `turnIndex < minTurns` (override stop), `unresolvedQuestion` (force continue), and tone-based grace (tense/heavy gets extra turns).
6. If continuation succeeds, schedule the next batch via `runNpcPairBatch`.

`createSession(a, b, now)` calls `computeConversationBudget` with opener hints from each NPC's `lastBrainIntent` + `currentGoal`. It seeds `emotionalTone` from category and current tension/mood, sets `relationshipContext` from the relationship state, and records `lastContinuationReason: "session opened"`.

`applyArrivedBatch(c, a, b, result)` folds session-arc updates from the LLM result into the live session: topic shifts push the old topic onto `topicStack` (cap 6), `conversationGoal` and `unresolvedQuestion` follow the result (with explicit `null` allowed to clear), `lastSpeakerIntent` / `lastListenerReaction` track the latest speakers' framing, `summaryDelta` appends to `summarySoFar` (clamped to 700 chars), commitments are validated and pushed (cap 12). After every batch lands, the session re-classifies its category — but only **upward** in the category-rank ladder (`casual < work < planning < emotional < argument < deep`). This protects against opener misclassification: a conversation that opened "casual" but is actually planning will get the right budget once topic is named.

`endSession(c, a, b, now)` is the single tear-down path. It writes ONE arc memory event (`type: "conversation_session"`) to both participants' local memory (long-term) via `MemorySystem.add`, plus per-actor `commitment` memory events for each promise made. Per-batch writes from `applyStructuredNpcExchange` still feed short-term memory; the session-end memory is the consolidated arc that survives in long-term. After memory is written, follow-up actions (linger / leave / goto / avoid) are applied, cooldowns set, `inConversation` cleared, and the AI decision loop is re-scheduled.

`endAllConversations(reason)` was added as a dev/player kill switch that bypasses `minTurns` with a typed reason (default `interrupt:dev_command`).

`getDebugSnapshot(entities, now)` was extended to surface every session-arc field plus a `conversationLocked` flag (alias of `inConversation` for clarity in the HUD).

### Phase 4 — LLM prompt update (`llm/ollamaDialogue.ts`)

The NPC↔NPC system prompt was rewritten to your spec wording. The opening is now:

> You are continuing an active multi-turn conversation in AI City. You write the next two spoken lines (agentA then agentB) inside an ongoing dialogue session, NOT a one-off scene.

It includes explicit SESSION RULES (do not reset, do not greet unless `turnIndex == 0`, respond directly to the previous line, keep the same topic unless reason to shift, address `unresolvedQuestion`, push `conversationGoal`, do not prematurely end), LINE QUALITY rules (no throwaway lines, do not repeat anti-repetition lines, each line should contain a real beat — information, opinion, question, decision, memory, or next step), and CATEGORY-AWARE PACING guidance for argument / emotional / deep / planning / work / casual.

The user payload now includes a SESSION STATE block (category, status, tone, turn budget, topic, prior topics, conversationGoal, unresolvedQuestion, prior speaker intent, prior listener reaction, summarySoFar) and renders prior turns in a labeled, ordered block. The first turn of a session gets an explicit "OPENING TURN" framing; later turns get an explicit "do NOT greet, do NOT reset" framing.

The JSON output contract was extended to include the new optional fields (`nextTopic`, `conversationGoal`, `unresolvedQuestion`, `lastSpeakerIntent`, `lastListenerReaction`, `summaryDelta`, `commitments`). `sanitizeNpcResult` extracts each field defensively, falling back to the stub's defaults on any malformed value.

### Phase 5 — Debug HUD surface (`CitySimDebugPanel.tsx`)

The Conversations panel now shows, per active session:

- session id, participants, location
- **category / status / tone / lock** (color-coded: status green when active, yellow winding-down, red ended; tone red when tense or guarded, purple when heavy, green when warm or playful)
- **turnIndex (min N / max M)** plus visible line count
- topic (if set), conversationGoal (if set), unresolvedQuestion (if set)
- last spoken line
- **`lastContinuationReason`** — the human-readable explanation of the most recent continue/end decision
- arc summary (`summarySoFar`)
- commitment count (when > 0)
- **`endReason`** when the session has ended (highlighted red for `interrupt:*` cases)
- time since last line

The per-entity row now displays both `inConversation` and `conversationLocked` (currently the same flag, exposed under both names so the lock concept is visible in the HUD).

---

## 3. What this preserves

The preservation discipline is identical to Doc 10's: existing typed contracts and call sites are kept where they don't conflict with the new shape.

- **`Conversation` (public type)** is unchanged. `ConversationSession extends Conversation`, so any external consumer of `getActiveConversationsArray()` keeps compiling and reading the same fields.
- **Per-batch memory writes** continue to fire in `applyStructuredNpcExchange`. The session-end memory is *additive*, not a replacement. Short-term memory still feeds the next batch's prompt context.
- **Conversation-outcome events** to the brain bundle (`POST /brains/event` from `residentBrainAdapter.sendResidentEvent`) still fire after every batch's second line. Engines that depend on per-batch event feedback are unaffected.
- **TTS gating semantics** (waiting for the speech promise to settle before emitting the next line, and the safety timeout that prevents a missed event from freezing the sim) are unchanged.
- **Player↔NPC mode** still uses the existing single-shot reply flow. The session is created with `isPlayerHumanPair: true`, and `tickOneConversation` early-returns for it. The `closedByPlayerFlow` flag is reserved for future multi-turn extension.
- **`computeTalkBudget(a, b)`** is preserved as a deprecated shim that returns `{maxTurns: ceil(maxTurns / 2)}` from the new budget. No external caller is currently using it; the shim exists so a search hit doesn't blow up at the import.
- **The decision-system lock (`if (entity.inConversation) return`)** in `runAiDecision` is unchanged. The session keeps `inConversation` true for the entire arc; release happens only through `endSession`.
- **Conservative interrupt thresholds were chosen as the agreed tradeoff (option B in the planning step).** The decision system can still pre-empt non-conversation behavior at any time — the lock only protects in-progress sessions.

The `EngineConversation` runtime type was renamed to `RuntimeSession`. No external code referenced it (it was private); the rename is purely internal hygiene.

---

## 4. How to verify this works

The acceptance test mapping (from your spec, Tests A–D) is:

```
TEST A  Adam: "We need to talk about our plans for the town." → Omar
  expected:     ≥ 6 turns total; topic does not vanish after first reply
  observed:     opener-hint detection routes to category=planning (minTurns 6,
                maxTurns 14). If misclassified as casual, topic re-classification
                upgrades to planning on the first batch. Engine override
                prevents Omar's first reply from ending the session. Stub
                fallback writes a real planning opener with goal +
                unresolvedQuestion; LLM is told to push the goal until resolved.

TEST B  Maya runs on fumes / line cook schedule → River
  expected:     ≥ 8 turns
  observed:     routes to category=work (minTurns 4, maxTurns 10). Tension from
                "running on fumes" surfaces emotionalTone=guarded → tense, which
                in decideContinuation extends past min by up to 4 extra turns,
                comfortably reaching 8. Re-classification can lift to emotional
                if the topic surfaces feelings.

TEST C  Bob and Tina casual chat
  expected:     ≥ 4 turns with one topic branch or personal detail
  observed:     default category=casual (minTurns 4, maxTurns 8). Engine
                override floors at 4 turns. New stub adds personal details and
                follow-up questions on each branch.

TEST D  High-priority interrupt (fire / crime / danger)
  expected:     conversation interrupted with explicit endReason
  observed:     detectInterrupts runs every conversation tick. Any of the four
                conditions returns an interrupt:* endReason, routes through
                endSession, writes the arc memory with "(cut short by ...)"
                appended, and emits a red-highlighted entry in the HUD.
```

The smoke path is the existing dev loop: launch the app, enter play mode, watch a session in the debug HUD, confirm `turnIndex` advances past `minTurns`, confirm `lastContinuationReason` shifts from "under min_turns" to "post-min continuation" or "llm signaled natural close after min" or "max_turns reached", confirm `endReason` is populated.

---

## 5. What this leaves on the table

Honest:

- **Player↔NPC sessions are still single-shot.** The session object is created and torn down in one batch. Multi-turn pumping for player↔NPC dialogue would reuse the same `ConversationSession` machinery but needs a player-input pump that doesn't exist yet. Doc 9 §1.7 still applies.
- **Commitments are written as memories but not as daily-plan objectives.** If the LLM (or stub) records "Omar agreed to evaluate the public garden idea," that becomes a memory event with `type: "commitment"` on Omar's actor, but it is not yet inserted into `dailyPlan.objectives`. Wiring goal creation requires knowing how `DailyPlanSystem` accepts mid-day objectives, which is a separate pass.
- **Category re-classification only goes upward.** That's the right default (a casual chat that turns serious gets the budget it needs), but it means a planning conversation that resolves quickly will *not* shrink back to casual budget. In practice this rarely matters; if `unresolvedQuestion` is null and tone is calm, `decideContinuation` will close the session early regardless.
- **Interrupt thresholds are conservative.** With the chosen thresholds (`hunger >= 0.92`, `energy <= 0.06`, threat within 4u, purpose `<= 0.15`), almost nothing actually interrupts a conversation in normal play. That is the intended tradeoff: the session lock is supposed to be strong. If we observe NPCs ignoring real obligations, the moderate threshold set is documented as the tunable next step.
- **The engine bundle does not (yet) know about session arcs.** Conversation-outcome events still fire per-batch with `eventType: "conversation_outcome"` and a `summary` field. A separate event type for session-arc completion (e.g. `"conversation_session_complete"` with the arc summary, commitments, end reason) would let typed engines like `IntentSystem` or `GoalEngineGramps` reason over session-level outcomes instead of reconstructing them from the batch stream. This is a bounded follow-up.
- **Topic continuity is engine-honest, not enforced.** The prompt tells the LLM not to reset the scene; the JSON contract makes `nextTopic` explicit. But nothing prevents the LLM from drifting topics. If we want hard topic-pinning, the prompt-or-validate layer would need to refuse `nextTopic` changes when `turnIndex < minTurns`. Not yet wired.

The "one-shot two-line micro-exchange" framing is replaced by a session-shaped framing: **a session owns its participants until `endSession` runs, the decision lock holds for the entire arc, and only conservative interrupts or natural resolution after `minTurns` can release them.**

---

## 6. Files changed in this work

```
NEW   src/systems/citySim/conversationSession.ts        (~340 lines)
NEW   docs/11_conversation_sessions.md                  (this document)

MOD   src/systems/citySim/ConversationSystem.ts         (rewritten)
MOD   src/systems/citySim/conversationStructured.ts     (extended)
MOD   src/systems/citySim/llm/ollamaDialogue.ts         (prompt + sanitizer)
MOD   src/systems/citySim/components/debug/CitySimDebugPanel.tsx  (HUD)

MOD   docs/02_system_architecture.md
MOD   docs/03_ai_city.md
MOD   docs/07_runtime_behavior.md
MOD   docs/09_problems_and_next_steps.md
```

`src/systems/citySim/conversationPlayer.ts` was deliberately not touched (its single-shot flow is preserved as documented in §3 and §5). The `MemorySystem` was used as-is via its existing `add(actors, partial)` API.

---

## 7. The honest summary

Conversations are no longer one-line drop-outs. A `ConversationSession` owns the interaction from the moment two NPCs lock into talking until `endSession` runs. Turn budgets are category-aware (casual 4–8, work 4–10, planning 6–14, emotional 8–16, argument 8–20, deep 10–24). The LLM's stop signal is overridden below `minTurns` and bias-honored above it. Conservative interrupts (true emergencies only) are the only way to break a session early. Topic, goal, and unresolved question persist across batches and are surfaced in the prompt and the HUD. Memory at session end is one consolidated arc, plus per-actor commitments. The decision system's existing `inConversation` lock holds for the entire arc — there was never a missing lock, only conversations that ended too soon.

This is the structural fix the conversations needed. The remaining gaps (player↔NPC multi-turn, goal-into-objective wiring, session-complete events to engines, hard topic pinning) are bounded, named, and listed above.
