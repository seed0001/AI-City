"""Leak regression smoke for the state-store eviction / archive / size paths.

Run:
    cd server/residentBrain
    python _leak_regression_smoke.py

Produces a temp directory under state/leak_smoke_tmp/ to avoid touching real
resident state. Cleans up at the end.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

# Allow running directly from server/residentBrain/ without sys.path tricks.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from state_store import StateStore  # noqa: E402  (sys.path tweak above)


def _section(label: str) -> None:
    print()
    print(f"=== {label} ===")


def _expect(condition: bool, label: str) -> None:
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}")
    if not condition:
        raise SystemExit(f"leak regression failed at: {label}")


def main() -> None:
    tmp_root = Path(tempfile.mkdtemp(prefix="leak_smoke_"))
    print(f"Using tmp root: {tmp_root}")

    try:
        store = StateStore(tmp_root)

        # --- Setup: write envelopes + per-engine state for two residents ---
        _section("Setup two residents (Ada, Bex)")
        ada_state = {"entity_id": "ada", "events": [{"summary": "first day"}]}
        bex_state = {"entity_id": "bex", "events": [{"summary": "arrived"}]}
        store.save("ada", ada_state)
        store.save("bex", bex_state)

        ada_engines = tmp_root / "engines" / "ada"
        ada_engines.mkdir(parents=True, exist_ok=True)
        (ada_engines / "emotion_kernel.json").write_text(
            json.dumps({"joy": 0.5, "anxiety": 0.2}), encoding="utf-8"
        )
        (ada_engines / "relational_memory.json").write_text(
            json.dumps([{"id": i, "summary": f"event {i}"} for i in range(50)]),
            encoding="utf-8",
        )
        bex_engines = tmp_root / "engines" / "bex"
        bex_engines.mkdir(parents=True, exist_ok=True)
        (bex_engines / "emotion_kernel.json").write_text(
            json.dumps({"joy": 0.1, "anxiety": 0.4}), encoding="utf-8"
        )

        _expect((tmp_root / "ada.json").exists(), "ada envelope written")
        _expect((tmp_root / "bex.json").exists(), "bex envelope written")
        _expect(ada_engines.exists(), "ada engines directory written")

        # --- state_size ---
        _section("state_size diagnostics")
        ada_size = store.state_size("ada")
        print(f"  ada size = {ada_size}")
        _expect(ada_size["envelopeBytes"] > 0, "ada envelopeBytes > 0")
        _expect(ada_size["enginesBytes"] > 0, "ada enginesBytes > 0")
        _expect(ada_size["totalBytes"] == ada_size["envelopeBytes"] + ada_size["enginesBytes"], "ada totalBytes math")
        _expect(ada_size["engineFileCount"] == 2, "ada engineFileCount = 2")
        _expect(ada_size["largestEngineFile"] is not None, "ada largestEngineFile present")
        # The relational_memory.json should be the largest, since it has 50 entries
        largest = ada_size["largestEngineFile"]
        assert largest is not None
        _expect(
            largest["file"] == "relational_memory.json",
            "ada largest is relational_memory.json",
        )

        # --- total_state_size ---
        _section("total_state_size aggregation")
        total = store.total_state_size()
        print(f"  total residents = {total['residents']}, totalBytes = {total['totalBytes']}")
        _expect(total["residents"] == 2, "total reports 2 residents")
        _expect(total["totalBytes"] == ada_size["totalBytes"] + store.state_size("bex")["totalBytes"], "total bytes math")
        _expect(total["biggestResident"] is not None, "biggestResident populated")
        big = total["biggestResident"]
        assert big is not None
        _expect(big["entityId"] == "ada", "biggestResident is Ada (relational memory bloat)")

        # --- archive ---
        _section("archive(ada)")
        result = store.archive("ada")
        print(f"  archive result = {result}")
        _expect(result is not None, "archive returns summary")
        assert result is not None
        archive_dir = Path(result["archiveDir"])
        _expect(archive_dir.exists(), "archive directory exists")
        _expect((archive_dir / "ada.json").exists(), "envelope moved into archive dir")
        _expect((archive_dir / "engines").exists(), "engines dir moved into archive dir")
        _expect(not (tmp_root / "ada.json").exists(), "live envelope removed")
        _expect(not (tmp_root / "engines" / "ada").exists(), "live engines dir removed")

        # archived size doesn't count toward live total
        total_after_archive = store.total_state_size()
        _expect(total_after_archive["residents"] == 1, "live count = 1 after archive")
        _expect(
            total_after_archive["totalBytes"] < total["totalBytes"],
            "totalBytes shrank after archive",
        )

        # archiving something that doesn't exist returns None
        gone = store.archive("ghost")
        _expect(gone is None, "archive of non-existent resident returns None")

        # --- delete ---
        _section("delete(bex)")
        removed = store.delete("bex")
        _expect(removed is True, "delete returns True for bex")
        _expect(not (tmp_root / "bex.json").exists(), "bex envelope removed")
        _expect(not (tmp_root / "engines" / "bex").exists(), "bex engines dir removed")
        # delete on non-existent returns False
        _expect(store.delete("ghost") is False, "delete of non-existent returns False")

        total_empty = store.total_state_size()
        _expect(total_empty["residents"] == 0, "live count = 0 after delete")
        _expect(total_empty["totalBytes"] == 0, "totalBytes = 0 after delete")
        _expect(total_empty["biggestResident"] is None, "biggestResident is None after delete")

        # --- archive root still has ada's history ---
        _section("archive directory survives")
        archive_residents = list(store.archive_root.iterdir())
        _expect(len(archive_residents) >= 1, "archive root retains at least one entry")

        _section("ALL GREEN")
        print("Leak regression smoke passed for: state_size, total_state_size, archive, delete.")

    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)
        print(f"Cleaned up tmp root: {tmp_root}")


if __name__ == "__main__":
    main()
