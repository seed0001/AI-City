"""Phase 1-7 upgrade smoke: verify the bundle now aggregates many engines.

Validates the success criteria from the upgrade spec:
- Capability registry built per engine.
- synthesizeDecision lists contributingEngines (>1) and breakdown.
- synthesizeConversationContext returns extendedContext + contextSources.
- recordEvent classifies the event into tags and propagates to many engines.
- Two residents with different snapshots produce visibly different decisions.
- No exception terminates the run.

Run from project root:  python server/residentBrain/_phase_engine_upgrade_smoke.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def _print_section(title: str) -> None:
    print()
    print("=" * 72)
    print(title)
    print("=" * 72)


def main() -> int:
    here = Path(__file__).resolve()
    sys.path.insert(0, str(here.parent))
    from brain_bundle import EngineBundle  # noqa: E402

    # Resident A: extraverted, hungry, mid-energy
    a = EngineBundle.create("npc_smoke_a", {
        "displayName": "Ada",
        "role": "Cashier",
        "traits": ["practical", "watchful", "friendly"],
        "mood": "calm",
    })
    # Resident B: introverted, tired, low social tolerance
    b = EngineBundle.create("npc_smoke_b", {
        "displayName": "Bex",
        "role": "Neighbor",
        "traits": ["reserved", "thoughtful"],
        "mood": "calm",
    })

    _print_section("CAPABILITIES SUMMARY")
    snap_a = a.debug_snapshot()
    snap_b = b.debug_snapshot()
    cap_a = snap_a["capabilities"]
    cap_b = snap_b["capabilities"]
    print(f"Resident A ({a.display_name}): {len(cap_a)} engines scanned")
    print(f"Resident B ({b.display_name}): {len(cap_b)} engines scanned")
    decision_capable_a = sum(1 for c in cap_a.values() if c["decisionMethods"])
    state_capable_a = sum(1 for c in cap_a.values() if c["stateMethods"])
    event_capable_a = sum(1 for c in cap_a.values() if c["eventMethods"])
    print(f"  decision-method capable engines: {decision_capable_a}")
    print(f"  state-method   capable engines: {state_capable_a}")
    print(f"  event-method   capable engines: {event_capable_a}")

    # ---- Tick + decide for resident A (hungry, social) -------------------
    a_ctx = {
        "mood": "calm",
        "energy": 0.6,
        "hunger": 0.7,
        "socialTolerance": 0.4,
        "currentGoal": "wander",
        "currentAction": "idle",
        "homeMarkerKey": "home_ada",
        "nearbyEntityIds": ["npc_smoke_b"],
        "entityId": "npc_smoke_a",
        "displayName": "Ada",
        "dailyPlanHeadline": "Run errands",
    }
    a.tick(a_ctx)
    a_decision = a.synthesizeDecision(a_ctx)

    _print_section("DECISION — Resident A (hungry, social)")
    print(f"  intent      = {a_decision['intent']}")
    print(f"  confidence  = {a_decision['confidence']:.3f}")
    print(f"  source      = {a_decision['source']}")
    print(f"  contributors ({len(a_decision['contributors'])}): {a_decision['contributors'][:6]}")
    print("  contributingEngines (top 6):")
    for c in (a_decision.get("contributingEngines") or [])[:6]:
        print(f"    {c['role']:<14} {c['method']:<28} weight={c['weight']:<6.2f} engine={c['engineKey']}")
    breakdown_a = a.last_decision_breakdown
    print(f"  breakdown len = {len(breakdown_a)}")

    # ---- Tick + decide for resident B (tired, low energy) ----------------
    b_ctx = {
        "mood": "nervous",
        "energy": 0.18,
        "hunger": 0.3,
        "socialTolerance": 0.7,
        "currentGoal": "wander",
        "currentAction": "idle",
        "homeMarkerKey": "home_bex",
        "nearbyEntityIds": ["npc_smoke_a"],
        "entityId": "npc_smoke_b",
        "displayName": "Bex",
    }
    b.tick(b_ctx)
    b_decision = b.synthesizeDecision(b_ctx)

    _print_section("DECISION — Resident B (tired, withdrawn)")
    print(f"  intent      = {b_decision['intent']}")
    print(f"  confidence  = {b_decision['confidence']:.3f}")
    print(f"  source      = {b_decision['source']}")
    print(f"  contributors ({len(b_decision['contributors'])}): {b_decision['contributors'][:6]}")
    print("  contributingEngines (top 6):")
    for c in (b_decision.get("contributingEngines") or [])[:6]:
        print(f"    {c['role']:<14} {c['method']:<28} weight={c['weight']:<6.2f} engine={c['engineKey']}")

    # ---- Conversation context ---------------------------------------------
    a_conv = a.synthesizeConversationContext({
        "mood": "calm", "role": "Cashier", "currentGoal": "Stay alert",
        "otherEntityId": "npc_smoke_b", "entityId": "npc_smoke_a",
    })
    _print_section("CONVERSATION CONTEXT — Resident A")
    ebc = a_conv["engineBrainContext"]
    print(f"  emotionalState        : {ebc['emotionalState']}")
    print(f"  relationshipReasoning : {ebc['relationshipReasoning']}")
    print(f"  currentIntent         : {ebc['currentIntent']}")
    print(f"  activeGoals           : {ebc['activeGoals']}")
    print(f"  driveState            : {ebc['driveState']}")
    print(f"  selfNarrative         : {ebc['selfNarrative']}")
    print(f"  recentEpisodes        : {ebc['recentEpisodes']}")
    ext = ebc.get("extendedContext") or []
    print(f"  extendedContext ({len(ext)}):")
    for s in ext:
        print(f"    [{s['role']:<11}] {s['summary'][:80]}  (rel={s['relevance']}, key={s['engineKey']})")
    sources = a_conv["contextSources"]
    print(f"  contextSources len = {len(sources)} (CORE + extended)")

    # ---- Event recording with tagging -------------------------------------
    a.recordEvent({
        "eventType": "conversation_outcome",
        "summary": "Ada and Bex shared a quick word at the bench",
        "tone": "warm",
        "emotionalImpact": 0.18,
        "relationshipDelta": 0.08,
        "socialDelta": 0.04,
        "partnerId": "npc_smoke_b",
        "partnerName": "Bex",
        "topic": "greeting",
        "mood": "calm",
        "resolved": True,
        "spokenLine": "Hey - good to see you out here.",
    })
    _print_section("EVENT — Resident A receives a warm conversation_outcome")
    print(f"  lastEventTags = {a.last_event_tags}")
    print(f"  events len    = {len(a.events)}")

    # Tense outcome should produce a follow-up intent in IntentSystem
    a.recordEvent({
        "eventType": "conversation_outcome",
        "summary": "A clipped exchange with Bex left tension",
        "tone": "tense",
        "emotionalImpact": -0.4,
        "relationshipDelta": -0.18,
        "socialDelta": -0.05,
        "partnerId": "npc_smoke_b",
        "partnerName": "Bex",
        "topic": "tension",
        "mood": "annoyed",
        "resolved": False,
        "spokenLine": "Make it quick.",
    })
    _print_section("EVENT — Resident A receives a tense conversation_outcome")
    print(f"  lastEventTags = {a.last_event_tags}")
    # Re-pull engine_brain_context to see if intent shifted
    a_conv2 = a.synthesizeConversationContext({
        "mood": "annoyed", "role": "Cashier", "currentGoal": "Cool off",
        "otherEntityId": "npc_smoke_b", "entityId": "npc_smoke_a",
    })
    print(f"  currentIntent (after tense) = {a_conv2['engineBrainContext']['currentIntent']}")

    # ---- Counters and silence ---------------------------------------------
    snap_after = a.debug_snapshot()
    contrib = snap_after["contributingEngines"]
    silent = snap_after["silentEngines"]
    counters = snap_after["contributionCounters"]
    _print_section("SUMMARY — Resident A after full lifecycle")
    print(f"  totalEnginesInstantiated = {snap_after['totalEnginesInstantiated']}")
    print(f"  contributingEngines      = {len(contrib)}")
    print(f"  silentEngines            = {len(silent)}")
    print(f"  contribution_counters top 8: ")
    for k, v in list(counters.items())[:8]:
        print(f"    {v:>4}  {k}")

    # Acceptance check: success criterion is >= 50 engines influencing some
    # part of the loop. Print a clear pass/fail.
    influence_count = len({*contrib, *(c['engineKey'] for c in (a_decision.get('contributingEngines') or []))})
    _print_section("ACCEPTANCE")
    print(f"  unique influencing engines (decision contrib + state contrib) = {influence_count}")
    target = 50
    print(f"  target >= {target}: {'PASS' if influence_count >= target else 'NEEDS WORK'}")
    print(f"  decisions diverged: A={a_decision['intent']!r} vs B={b_decision['intent']!r} -> {'PASS' if a_decision['intent'] != b_decision['intent'] else 'SAME'}")
    print(f"  contributingEngines >= 1 on decision: A={len(a_decision['contributingEngines'])>=1} B={len(b_decision['contributingEngines'])>=1}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
