from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from brain_bundle import EngineBundle
from engine_factory import ensure_engines_on_path
from ollama_config import describe_resolution as describe_ollama_resolution
from ollama_config import resolve_ollama_model
from schemas import (
    ChildBrainRequest,
    ConversationContextRequest,
    ConversationContextResponse,
    DecisionRequest,
    DecisionResponse,
    EventRecordRequest,
    InitBrainRequest,
    UpdateBrainRequest,
)
from state_store import StateStore


app = FastAPI(title="Resident Brain Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ENGINES_PATHS = ensure_engines_on_path()
STORE = StateStore(Path(__file__).resolve().parent / "state")
BUNDLES: dict[str, EngineBundle] = {}


def get_or_create(entity_id: str, snapshot: dict[str, Any] | None = None) -> EngineBundle:
    if entity_id in BUNDLES:
        return BUNDLES[entity_id]
    saved = STORE.load(entity_id)
    if saved:
        bundle = EngineBundle.from_state(entity_id, saved)
    else:
        bundle = EngineBundle.create(entity_id, snapshot or {})
    BUNDLES[entity_id] = bundle
    return bundle


def persist(bundle: EngineBundle) -> None:
    STORE.save(bundle.entity_id, bundle.to_state())


@app.get("/health")
def health() -> dict[str, Any]:
    active = 0
    disabled = 0
    for b in BUNDLES.values():
        active += len(b.active_engines)
        disabled += len(b.disabled_engines)
    state_total = STORE.total_state_size()
    # Resolve once at health-check time so the HUD sees what was actually
    # picked for engines that hard-code 'mistral'. The function is cached
    # internally; subsequent calls are free.
    resolve_ollama_model()
    return {
        "ok": True,
        "bundles": len(BUNDLES),
        "enginesPaths": ENGINES_PATHS,
        "activeEngineCount": active,
        "disabledEngineCount": disabled,
        "stateBytes": state_total["totalBytes"],
        "stateResidents": state_total["residents"],
        "stateBiggestResident": state_total["biggestResident"],
        "ollama": describe_ollama_resolution(),
    }


@app.post("/brains/init")
def init_brain(req: InitBrainRequest) -> dict[str, Any]:
    bundle = get_or_create(req.entityId, req.snapshot)
    bundle.state["snapshot"] = req.snapshot
    persist(bundle)
    return {
        "ok": True,
        "emotionSummary": bundle.last_emotion_summary or f"{bundle.display_name} initialized",
        "brainKind": "engine",
    }


@app.post("/brains/update")
def update_brain(req: UpdateBrainRequest) -> dict[str, Any]:
    bundle = get_or_create(req.entityId)
    out = bundle.tick(req.tickContext)
    persist(bundle)
    return out


@app.post("/brains/decision", response_model=DecisionResponse)
def decision(req: DecisionRequest) -> DecisionResponse:
    bundle = get_or_create(req.entityId)
    out = bundle.synthesizeDecision(req.decisionContext)
    persist(bundle)
    return DecisionResponse(**out)


@app.post("/brains/conversation-context", response_model=ConversationContextResponse)
def conversation_context(req: ConversationContextRequest) -> ConversationContextResponse:
    bundle = get_or_create(req.entityId)
    out = bundle.synthesizeConversationContext(req.conversationContext)
    persist(bundle)
    return ConversationContextResponse(**out)


@app.post("/brains/event")
def event(req: EventRecordRequest) -> dict[str, Any]:
    bundle = get_or_create(req.entityId)
    bundle.recordEvent(req.event)
    persist(bundle)
    return {"ok": True}


@app.post("/brains/child")
def child(req: ChildBrainRequest) -> dict[str, Any]:
    parent_a = get_or_create(req.parentAId)
    parent_b = get_or_create(req.parentBId)
    child_id = str(req.childSeed.get("id") or req.childSeed.get("entityId") or "").strip()
    if not child_id:
        raise HTTPException(status_code=400, detail="childSeed.id is required")
    child = get_or_create(child_id, req.childSeed)
    out = parent_a.child_seed_defaults(
        other=parent_b,
        child_seed=req.childSeed,
        parent_a_summary=req.parentASummary,
        parent_b_summary=req.parentBSummary,
    )
    child.state["inherited_defaults"] = out.get("defaults", {})
    child.state["inherited_traits"] = out.get("inheritedTraitSuggestions", [])
    persist(child)
    return out


@app.get("/brains/{entity_id}/debug")
def brain_debug(entity_id: str) -> dict[str, Any]:
    if entity_id not in BUNDLES:
        saved = STORE.load(entity_id)
        if not saved:
            raise HTTPException(status_code=404, detail="brain not found")
        BUNDLES[entity_id] = EngineBundle.from_state(entity_id, saved)
    bundle = BUNDLES[entity_id]
    return bundle.debug_snapshot()


@app.get("/brains/{entity_id}/state-size")
def brain_state_size(entity_id: str) -> dict[str, Any]:
    """Per-resident disk footprint. Cheap to call; safe to poll from the HUD."""
    return STORE.state_size(entity_id)


@app.get("/brains/state-size")
def all_state_size() -> dict[str, Any]:
    """Aggregate disk footprint across every resident known to the store."""
    return STORE.total_state_size()


@app.post("/brains/{entity_id}/archive")
def archive_brain(entity_id: str) -> dict[str, Any]:
    """Move this resident's state to state/archive/<id>_<ts>/ and drop the
    in-memory bundle. The resident effectively leaves the simulation; their
    history is preserved on disk under archive/ for inspection.

    Returns the archive summary, or 404 if there was nothing to archive.
    """
    BUNDLES.pop(entity_id, None)
    summary = STORE.archive(entity_id)
    if summary is None:
        raise HTTPException(status_code=404, detail="brain not found")
    return summary


@app.delete("/brains/{entity_id}")
def delete_brain(entity_id: str) -> dict[str, Any]:
    """Permanently remove this resident's state. UNRECOVERABLE.

    Prefer /brains/{id}/archive in almost all cases. Use this only when a
    resident was created accidentally or when state corruption requires a
    full reset for that one bundle. Drops from BUNDLES and removes
    state/<id>.json plus state/engines/<id>/.
    """
    BUNDLES.pop(entity_id, None)
    removed = STORE.delete(entity_id)
    if not removed:
        raise HTTPException(status_code=404, detail="brain not found")
    return {"ok": True, "entityId": entity_id, "removed": True}

