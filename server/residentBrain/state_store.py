from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import Any


class StateStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.archive_root = self.root / "archive"
        self.archive_root.mkdir(parents=True, exist_ok=True)
        self.engines_root = self.root / "engines"
        self.engines_root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _safe(entity_id: str) -> str:
        cleaned = "".join(ch for ch in entity_id if ch.isalnum() or ch in ("_", "-")).strip()
        return cleaned or "resident"

    def _path(self, entity_id: str) -> Path:
        return self.root / f"{self._safe(entity_id)}.json"

    def _engines_dir(self, entity_id: str) -> Path:
        return self.engines_root / self._safe(entity_id)

    def load(self, entity_id: str) -> dict[str, Any] | None:
        p = self._path(entity_id)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def save(self, entity_id: str, state: dict[str, Any]) -> None:
        p = self._path(entity_id)
        p.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding="utf-8")

    # ---- Lifecycle -------------------------------------------------------
    def delete(self, entity_id: str) -> bool:
        """Remove bundle envelope and per-engine state directory. Returns True
        if anything was actually removed.

        Use with care — this is unrecoverable. Prefer archive() for any
        long-lived resident the user might still want to inspect later.
        """
        removed = False
        p = self._path(entity_id)
        if p.exists():
            p.unlink()
            removed = True
        engines_dir = self._engines_dir(entity_id)
        if engines_dir.exists():
            shutil.rmtree(engines_dir, ignore_errors=True)
            removed = True
        return removed

    def archive(self, entity_id: str) -> dict[str, Any] | None:
        """Move the bundle envelope and per-engine state directory to
        state/archive/<entity_id>_<timestamp>/.

        Returns the archive entry summary, or None if there was nothing to
        archive. Bundles still living in the in-memory BUNDLES map are NOT
        evicted by this call — the caller is responsible for that, since the
        store doesn't know about the in-memory dict. main.py wires the two
        together in the archive endpoint.
        """
        envelope = self._path(entity_id)
        engines_dir = self._engines_dir(entity_id)
        if not envelope.exists() and not engines_dir.exists():
            return None

        ts = int(time.time())
        target = self.archive_root / f"{self._safe(entity_id)}_{ts}"
        target.mkdir(parents=True, exist_ok=True)

        moved: dict[str, str] = {}
        if envelope.exists():
            dest = target / envelope.name
            shutil.move(str(envelope), str(dest))
            moved["envelope"] = str(dest)
        if engines_dir.exists():
            dest = target / "engines"
            shutil.move(str(engines_dir), str(dest))
            moved["engines"] = str(dest)
        return {
            "entityId": entity_id,
            "archivedAt": ts,
            "archiveDir": str(target),
            "moved": moved,
        }

    # ---- Observability ---------------------------------------------------
    def state_size(self, entity_id: str) -> dict[str, Any]:
        """Per-resident state footprint on disk.

        Returns total bytes, per-engine breakdown, and the path of the
        largest engine state file. Used by /brains/{id}/state-size and by
        the HUD to surface bloat early instead of waiting for it to hurt.
        """
        envelope = self._path(entity_id)
        envelope_bytes = envelope.stat().st_size if envelope.exists() else 0

        engines_dir = self._engines_dir(entity_id)
        engine_breakdown: list[dict[str, Any]] = []
        engines_total = 0
        if engines_dir.exists():
            for child in engines_dir.iterdir():
                if not child.is_file():
                    continue
                size = child.stat().st_size
                engines_total += size
                engine_breakdown.append({"file": child.name, "bytes": size})

        engine_breakdown.sort(key=lambda row: -int(row["bytes"]))
        largest = engine_breakdown[0] if engine_breakdown else None

        return {
            "entityId": entity_id,
            "envelopeBytes": envelope_bytes,
            "enginesBytes": engines_total,
            "totalBytes": envelope_bytes + engines_total,
            "engineFileCount": len(engine_breakdown),
            "largestEngineFile": largest,
            "engineBreakdownTop10": engine_breakdown[:10],
        }

    def total_state_size(self) -> dict[str, Any]:
        """Aggregate state footprint across every resident known to the store."""
        envelopes = 0
        engines = 0
        biggest_resident: dict[str, Any] | None = None
        per_resident: list[dict[str, Any]] = []
        for envelope in self.root.glob("*.json"):
            entity_id = envelope.stem
            row = self.state_size(entity_id)
            envelopes += int(row["envelopeBytes"])
            engines += int(row["enginesBytes"])
            per_resident.append(row)
            if biggest_resident is None or row["totalBytes"] > biggest_resident["totalBytes"]:
                biggest_resident = row
        per_resident.sort(key=lambda r: -int(r["totalBytes"]))
        return {
            "residents": len(per_resident),
            "envelopeBytes": envelopes,
            "enginesBytes": engines,
            "totalBytes": envelopes + engines,
            "biggestResident": biggest_resident,
            "topResidents": per_resident[:10],
        }

