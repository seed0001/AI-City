"""Run a full bundle lifecycle and emit a clean per-class inventory + summary.

Run from project root:  python server/residentBrain/_inventory_dump.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    here = Path(__file__).resolve()
    sys.path.insert(0, str(here.parent))

    from brain_bundle import EngineBundle  # noqa: E402

    bundle = EngineBundle.create("npc_inventory_dump", {"displayName": "Inventory Dump"})
    bundle.tick(
        {
            "mood": "calm",
            "energy": 0.55,
            "hunger": 0.25,
            "socialTolerance": 0.5,
            "currentGoal": "wander",
            "currentAction": "idle",
            "entityId": "npc_inventory_dump",
            "displayName": "Inventory Dump",
        }
    )
    bundle.synthesizeDecision(
        {
            "mood": "calm",
            "energy": 0.55,
            "hunger": 0.25,
            "socialTolerance": 0.5,
            "currentGoal": "wander",
            "currentAction": "idle",
            "nearbyEntityIds": ["npc_other"],
            "entityId": "npc_inventory_dump",
            "displayName": "Inventory Dump",
        }
    )
    bundle.synthesizeConversationContext(
        {"mood": "calm", "currentGoal": "wander", "entityId": "npc_inventory_dump"}
    )
    bundle.recordEvent(
        {
            "eventType": "conversation",
            "summary": "Talked with neighbor near the park",
            "tone": "warm",
            "emotionalImpact": 0.4,
        }
    )

    snap = bundle.debug_snapshot()
    print("SUMMARY", json.dumps({
        "totalClassesDiscovered": snap["totalClassesDiscovered"],
        "totalEnginesDiscovered": snap["totalEnginesDiscovered"],
        "totalEnginesInstantiated": snap["totalEnginesInstantiated"],
        "totalExcludedDataContainers": snap["totalExcludedDataContainers"],
        "totalCompositesWired": snap["totalCompositesWired"],
        "rolesCount": {k: len(v) for k, v in snap["activeEnginesByRole"].items()},
        "disabledCount": len(snap["disabledEngines"]),
    }))
    print("---INVENTORY---")
    for row in snap["inventory"]:
        reason = (row.get("reason") or "").replace("\t", " ").replace("\n", " ")[:240]
        composite = "*" if row.get("composite") else " "
        print(
            "\t".join(
                [
                    composite,
                    row["package"],
                    row["module"],
                    row["class"],
                    row["runtimeRole"],
                    row["status"],
                    reason,
                ]
            )
        )
    print("---EXCLUDED---")
    for row in snap["excludedClasses"]:
        print("\t".join([row["package"], row["module"], row["class"], row["runtimeRole"], row["reason"]]))


if __name__ == "__main__":
    main()
