"""Typed runtime adapters for engines whose method signatures cannot be safely
invoked through generic dispatch.

Each adapter takes (engine, phase, context, event) and returns the most
representative output for that phase, or None if the adapter has nothing to do.

Phases:
- "physiology" : low-level body/state advance (e.g. clock tick).
- "emotion"
- "memory"
- "personality"
- "cognition"
- "behavior"
- "expression"
- "utility"
- "event"      : invoked from recordEvent(...)
"""
from __future__ import annotations

from typing import Any, Callable, Dict


TypedAdapter = Callable[[Any, str, Dict[str, Any], Dict[str, Any]], Any]


def _safe(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    try:
        return fn(*args, **kwargs)
    except Exception:
        return None


def _emotion_event_word(event_type: str) -> tuple[str, float]:
    mapping = {
        "conversation": ("user_message", 0.6),
        "conversation_outcome": ("reflection", 0.5),
        "conflict": ("contradiction", 0.7),
        "quiet": ("silence_2h", 0.4),
        "memory": ("reflection", 0.4),
        "praise": ("user_message", 0.65),
    }
    return mapping.get(event_type, ("user_message", 0.4))


def _action_to_emotion(action: str) -> tuple[str, float]:
    a = (action or "idle").lower()
    if a == "talking":
        return ("user_message", 0.45)
    if a == "walking":
        return ("ambient", 0.2)
    if a == "sitting":
        return ("silence_2h", 0.25)
    return ("idle", 0.15)


def adapter_emotion_kernel_gramps(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "physiology":
        _safe(eng.tick, 1)
        return None
    if phase == "emotion":
        evt, intensity = _action_to_emotion(str(ctx.get("currentAction") or ""))
        return _safe(eng.update, evt, intensity)
    if phase == "event":
        et = str(event.get("eventType", "event"))
        evt, base = _emotion_event_word(et)
        intensity = float(event.get("emotionalImpact", base) or base)
        return _safe(eng.update, evt, max(0.05, min(1.0, intensity)))
    if phase == "utility":
        return _safe(eng.get_state)
    return None


def adapter_connor_state_beast(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "emotion":
        evt, intensity = _action_to_emotion(str(ctx.get("currentAction") or ""))
        return _safe(eng.update, evt, intensity)
    if phase == "event":
        text = str(event.get("summary") or event.get("eventType") or "event")
        tone = str(event.get("tone") or "neutral")
        _safe(eng.receive_input, text[:240], tone)
        return _safe(eng.get_state)
    if phase == "personality":
        _safe(eng.sync_to_personality)
        return _safe(eng.get_state)
    if phase == "utility":
        return _safe(eng.get_state)
    return None


def adapter_mental_health_beast(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "physiology":
        _safe(eng.decay_conditions)
        _safe(eng.update_current_state)
        return None
    if phase == "emotion":
        evt, intensity = _action_to_emotion(str(ctx.get("currentAction") or ""))
        return _safe(eng.update, evt, intensity)
    if phase == "event":
        text = str(event.get("summary") or "")
        _safe(eng.process_input, text[:240])
        et = str(event.get("eventType", "event"))
        evt, base = _emotion_event_word(et)
        intensity = float(event.get("emotionalImpact", base) or base)
        return _safe(eng.update, evt, max(0.05, min(1.0, intensity)))
    if phase == "utility":
        return _safe(eng.get_state)
    return None


def adapter_emotional_feedback_beast(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "event":
        text = str(event.get("summary") or "")
        tone = str(event.get("tone") or "neutral")
        prev = {"valence": 0.0, "arousal": 0.0, "tension": float(event.get("emotionalImpact", 0.0) or 0.0)}
        _safe(eng.score_interaction, text[:240], tone, prev)
        return _safe(eng.get_state)
    if phase == "utility":
        return _safe(eng.get_state)
    return None


def adapter_memory_manager_lyra(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    user_id = str(ctx.get("entityId") or ctx.get("displayName") or "resident")
    if phase == "memory":
        return _safe(eng.get_state)
    if phase == "event":
        summary = str(event.get("summary") or "").strip() or str(event.get("eventType") or "event")
        try:
            eng.store(summary, {"eventType": str(event.get("eventType") or "event")})
        except Exception:
            return None
        try:
            eng.add_short_term(user_id, "system", summary[:240])
        except Exception:
            pass
        return _safe(eng.get_state)
    return None


def adapter_self_model_gramps(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "personality":
        return _safe(eng.get_traits)
    if phase == "cognition":
        if _safe(eng.should_reflect):
            _safe(eng.mark_reflection)
        return _safe(eng.get_state)
    if phase == "event":
        summary = str(event.get("summary") or "").strip()
        if summary:
            _safe(eng.append_to_narrative, f"Event: {summary[:200]}")
        return _safe(eng.get_traits)
    if phase == "utility":
        return _safe(eng.get_state)
    return None


def adapter_word_store_seed(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "utility":
        return _safe(eng.get_state)
    if phase == "event":
        summary = str(event.get("summary") or "")
        for raw in summary.split()[:8]:
            cleaned = "".join(ch for ch in raw if ch.isalpha())
            if len(cleaned) >= 3:
                _safe(eng.add_word, cleaned.lower(), "world_event", summary[:140])
        return _safe(eng.get_state)
    return None


def adapter_reflection_engine_gramps(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "cognition":
        return _safe(eng.reflect, 8, None)
    if phase == "utility":
        return _safe(eng.get_state)
    return None


def adapter_advanced_pairing_recomposition(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "expression":
        return _safe(eng.recompose_sentence, "general", "natural")
    if phase == "utility":
        return _safe(eng.get_synthesis_stats)
    return None


def adapter_advanced_pairing_reasoning(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "cognition":
        return _safe(eng.get_reasoning_stats)
    if phase == "utility":
        return _safe(eng.get_adaptive_stats)
    if phase == "event":
        summary = str(event.get("summary") or "").strip()
        if summary:
            _safe(eng.reason_about_sentence, summary[:240])
        return _safe(eng.get_reasoning_stats)
    return None


def adapter_advanced_pairing_knowledge_fusion(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "cognition":
        return _safe(eng.get_fusion_stats)
    if phase == "expression":
        return _safe(eng.think_with_knowledge, "general", "natural")
    return None


def adapter_advanced_pairing_reflection(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "cognition":
        return _safe(eng.get_reflection_stats)
    if phase == "utility":
        return _safe(eng.get_reflection_stats)
    return None


def adapter_relational_memory_system(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    """Records conversation outcomes into the relational memory store with proper tags."""
    if phase == "memory":
        return _safe(eng.get_reasoning_summary, 3)
    if phase == "event":
        et = str(event.get("eventType") or "event")
        if et != "conversation_outcome":
            return None
        spoken = str(event.get("spokenLine") or "").strip()
        summary = str(event.get("summary") or "").strip()
        content = (spoken or summary)[:240]
        if not content:
            return None
        partner_name = str(event.get("partnerName") or "").strip()
        partner_id = str(event.get("partnerId") or "").strip()
        tone = str(event.get("tone") or "neutral").lower()
        rel_delta = float(event.get("relationshipDelta") or 0.0)
        topic = str(event.get("topic") or "").strip()

        symbolic_tags = [t for t in [topic or None, "conversation"] if t]
        if partner_name:
            symbolic_tags.append(f"with:{partner_name.lower()}")
        emotional_tags = [tone] if tone else []
        if rel_delta > 0.05:
            emotional_tags.append("warming")
        elif rel_delta < -0.05:
            emotional_tags.append("cooling")
        trigger_tags = [partner_id] if partner_id else []
        emotion_state = {
            "valence": rel_delta,
            "arousal": abs(rel_delta) + 0.1,
            "tension": -rel_delta,
        }
        try:
            eng.store_memory(
                content=content,
                role="conversation",
                symbolic_tags=symbolic_tags,
                emotional_tags=emotional_tags,
                trigger_tags=trigger_tags,
                tone=tone,
                emotion_state=emotion_state,
                context_summary=f"Spoke with {partner_name or 'someone'}",
            )
        except Exception:
            return None
        return _safe(eng.get_reasoning_summary, 3)
    return None


def adapter_intent_system(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "utility":
        return _safe(eng.get_top_intent)
    if phase == "event":
        et = str(event.get("eventType") or "event")
        if et != "conversation_outcome":
            return None
        partner_name = str(event.get("partnerName") or "").strip()
        topic = str(event.get("topic") or "").strip()
        rel_delta = float(event.get("relationshipDelta") or 0.0)
        resolved = bool(event.get("resolved", False))
        if not partner_name:
            return None
        if not resolved or topic == "tension" or rel_delta < -0.05:
            text = f"Follow up with {partner_name}"
            if topic and topic != "greeting":
                text += f" about {topic}"
            try:
                eng.add_intent(
                    text=text,
                    urgency=min(1.0, 0.4 + abs(rel_delta) * 1.5),
                    emotional_weight=min(1.0, 0.3 + abs(rel_delta) * 1.5),
                )
            except Exception:
                return None
        return _safe(eng.get_top_intent)
    return None


def adapter_drive_model_seed(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "behavior":
        return _safe(eng.get_active_drive)
    if phase == "utility":
        return _safe(eng.get_state)
    if phase == "event":
        et = str(event.get("eventType") or "event")
        if et != "conversation_outcome":
            return None
        rel_delta = float(event.get("relationshipDelta") or 0.0)
        social_delta = float(event.get("socialDelta") or 0.0)
        satisfaction = max(0.0, min(1.0, 0.5 + (rel_delta + social_delta) * 1.5))
        quality = max(0.0, min(1.0, 0.5 + rel_delta * 2.0))
        try:
            eng.update_from_interaction(
                words_learned=0,
                user_satisfaction=satisfaction,
                interaction_quality=quality,
            )
        except Exception:
            return None
        return _safe(eng.get_state)
    return None


def adapter_goal_engine_gramps(eng: Any, phase: str, ctx: Dict[str, Any], event: Dict[str, Any]) -> Any:
    if phase == "cognition":
        return _safe(eng.get_active_goals)
    if phase == "utility":
        return _safe(eng.get_state)
    if phase == "event":
        et = str(event.get("eventType") or "event")
        if et != "conversation_outcome":
            return None
        rel_delta = float(event.get("relationshipDelta") or 0.0)
        try:
            goals = eng.get_active_goals() or []
        except Exception:
            goals = []
        for g in goals[:5]:
            gid = None
            tags = []
            if isinstance(g, dict):
                gid = g.get("id") or g.get("goal_id")
                tags = list(g.get("tags") or [])
            else:
                gid = getattr(g, "id", None) or getattr(g, "goal_id", None)
                tags = list(getattr(g, "tags", []) or [])
            tag_blob = " ".join(str(t).lower() for t in tags)
            if "social" in tag_blob or "connect" in tag_blob or "relationship" in tag_blob:
                if gid is not None:
                    _safe(eng.update_goal_progress, gid, max(-0.1, min(0.1, rel_delta * 0.5)))
        return _safe(eng.get_active_goals)
    return None


TYPED_ADAPTERS: Dict[str, TypedAdapter] = {
    "EmotionKernelGramps": adapter_emotion_kernel_gramps,
    "ConnorStateBeast": adapter_connor_state_beast,
    "MentalHealthEngineBeast": adapter_mental_health_beast,
    "EmotionalFeedbackBeast": adapter_emotional_feedback_beast,
    "MemoryManagerLyra": adapter_memory_manager_lyra,
    "SelfModelGramps": adapter_self_model_gramps,
    "WordStoreSeed": adapter_word_store_seed,
    "ReflectionEngineGramps": adapter_reflection_engine_gramps,
    "RecompositionEngine": adapter_advanced_pairing_recomposition,
    "ReasoningEngine": adapter_advanced_pairing_reasoning,
    "KnowledgeFusionEngine": adapter_advanced_pairing_knowledge_fusion,
    "ReflectionEngine": adapter_advanced_pairing_reflection,
    "RelationalMemorySystem": adapter_relational_memory_system,
    "IntentSystem": adapter_intent_system,
    "DriveModelSeed": adapter_drive_model_seed,
    "GoalEngineGramps": adapter_goal_engine_gramps,
}


def get_typed_adapter(class_name: str) -> TypedAdapter | None:
    return TYPED_ADAPTERS.get(class_name)
