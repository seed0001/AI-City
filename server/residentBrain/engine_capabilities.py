"""Engine capability discovery + generic adapter.

Goal: turn the brain bundle from "16 typed adapters + 87 passengers" into
"every engine that can plausibly contribute is being asked the right question."

The capability registry inspects each instantiated engine ONCE at bundle
creation time, classifies its public methods into four buckets (decision /
state / event / expression), and caches per-method signature metadata so the
runtime loop never has to re-inspect.

The GenericEngineAdapter is a thin wrapper around an engine that uses its
cached capability to safely call the right method for a given phase / event.
It is the fallback for any engine without a hand-written typed adapter in
`engine_adapters.TYPED_ADAPTERS`.

Hard rules respected:
- Never crash the loop: every call is wrapped in a try/except.
- Never dominate: the adapter only RETURNS signals; aggregation lives in
  EngineBundle.synthesizeDecision / synthesizeConversationContext.
- Never replace existing typed adapters: this is consulted ONLY when no typed
  adapter exists for the engine class.
"""
from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Iterable


# ---------------------------------------------------------------------------
# Method bucket vocabulary
# ---------------------------------------------------------------------------

# A method is a "decision" surface if it suggests/declares an action or intent.
DECISION_METHOD_NAMES: tuple[str, ...] = (
    "synthesize_decision",
    "suggest_decision",
    "select_behavior",
    "decide",
    "recommend_action",
    "next_action",
    "choose_action",
    "get_top_intent",
    "get_active_intent",
    "get_intent_prompt_modifier",
    "get_active_drive",
    "get_current_phase",
    "get_active_goal",
    "get_active_goals",
)

# A method is a "state" surface if it reads / summarizes the engine's internal
# state without changing the world. Order matters: the first non-None return
# wins, so cheaper / more focused getters come first.
STATE_METHOD_NAMES: tuple[str, ...] = (
    "get_summary",
    "summarize",
    "get_traits",
    "get_state",
    "get_state_dict",
    "get_status",
    "get_active_goals",
    "get_top_intent",
    "get_active_drive",
    "get_current_phase",
    "get_recent_episodes",
    "get_reasoning_summary",
    "get_synthesis_stats",
    "get_reasoning_stats",
    "get_fusion_stats",
    "get_reflection_stats",
    "get_active_clusters",
    "get_recent_thoughts",
    "get_last_thought",
    "get_inner_voice",
)

# A method is an "event" surface if it accepts a stimulus and updates internal
# state. We try these in order; multiple may fire for one event.
EVENT_METHOD_NAMES: tuple[str, ...] = (
    "record_event",
    "process_event",
    "ingest_event",
    "absorb_event",
    "store_memory",
    "store",
    "add_short_term",
    "score_interaction",
    "process_input",
    "receive_input",
    "update",
    "tick_event",
    "append_to_narrative",
    "add_intent",
    "add_word",
    "reinforce",
    "reflect_on",
)

# A method is an "expression" surface if it produces something speakable /
# visible / output-shaped. We rarely call these in the loop directly, but they
# are tracked for the extended conversation context.
EXPRESSION_METHOD_NAMES: tuple[str, ...] = (
    "compose",
    "recompose_sentence",
    "generate",
    "respond",
    "think_with_knowledge",
    "get_inner_voice",
    "get_recent_thoughts",
    "get_last_thought",
    "speak",
    "narrate",
)


# ---------------------------------------------------------------------------
# Priority tables
# ---------------------------------------------------------------------------

# Used by synthesizeDecision: which roles get the loudest decision vote.
# Higher number = more weight.
DECISION_PRIORITY: dict[str, int] = {
    "CONTROL": 7,
    "EMOTION": 6,
    "MEMORY": 5,
    "COGNITION": 4,
    "PERSONALITY": 3,
    "EXPRESSION": 2,
    "UTILITY": 1,
    "PASSIVE_MONITOR": 0,
    "DISABLED_WITH_REASON": 0,
}

# Used by synthesizeConversationContext: which roles shape "how to speak."
# Different intent than decision: feelings/memory/personality dominate voice,
# control engines (rhythm, schedulers) recede.
CONTEXT_PRIORITY: dict[str, int] = {
    "EMOTION": 7,
    "MEMORY": 6,
    "PERSONALITY": 5,
    "COGNITION": 4,
    "CONTROL": 3,
    "EXPRESSION": 2,
    "UTILITY": 1,
    "PASSIVE_MONITOR": 0,
    "DISABLED_WITH_REASON": 0,
}


# ---------------------------------------------------------------------------
# Per-method metadata
# ---------------------------------------------------------------------------


def _classify_param_kind(annotation: Any) -> str:
    """Best-effort classification of a parameter annotation into a small set
    of buckets the adapter knows how to satisfy."""

    if annotation is inspect._empty:
        return "any"
    if annotation is dict:
        return "dict"
    if annotation is str:
        return "str"
    if annotation is int:
        return "int"
    if annotation is float:
        return "float"
    if annotation is bool:
        return "bool"
    if annotation is list:
        return "list"
    try:
        ann_str = str(annotation)
    except Exception:
        return "unknown"
    low = ann_str.lower()
    if any(t in low for t in ("dict", "mapping")):
        return "dict"
    if "list" in low or "sequence" in low:
        return "list"
    if "any" in low:
        return "any"
    if "str" in low:
        return "str"
    if "int" in low:
        return "int"
    if "float" in low:
        return "float"
    if "bool" in low:
        return "bool"
    return "unknown"


@dataclass
class MethodInfo:
    name: str
    arity: int  # number of required params (excluding self)
    optional: int  # number of optional params (excluding self)
    param_names: list[str] = field(default_factory=list)
    param_kinds: list[str] = field(default_factory=list)
    accepts_kwargs: bool = False
    accepts_varargs: bool = False

    def first_required_kind(self) -> str | None:
        if self.arity == 0:
            return None
        return self.param_kinds[0] if self.param_kinds else None


def _inspect_method(eng: Any, name: str) -> MethodInfo | None:
    fn = getattr(eng, name, None)
    if fn is None or not callable(fn):
        return None
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        # Builtin or C method we cannot introspect. Treat as zero-arg.
        return MethodInfo(name=name, arity=0, optional=0)
    arity = 0
    optional = 0
    p_names: list[str] = []
    p_kinds: list[str] = []
    accepts_kwargs = False
    accepts_varargs = False
    for p in sig.parameters.values():
        if p.name == "self":
            continue
        if p.kind is inspect.Parameter.VAR_KEYWORD:
            accepts_kwargs = True
            continue
        if p.kind is inspect.Parameter.VAR_POSITIONAL:
            accepts_varargs = True
            continue
        kind = _classify_param_kind(p.annotation)
        p_names.append(p.name)
        p_kinds.append(kind)
        if p.default is inspect._empty:
            arity += 1
        else:
            optional += 1
    return MethodInfo(
        name=name,
        arity=arity,
        optional=optional,
        param_names=p_names,
        param_kinds=p_kinds,
        accepts_kwargs=accepts_kwargs,
        accepts_varargs=accepts_varargs,
    )


# ---------------------------------------------------------------------------
# EngineCapability
# ---------------------------------------------------------------------------


@dataclass
class EngineCapability:
    engine_key: str
    class_name: str
    role: str
    decision_methods: list[MethodInfo] = field(default_factory=list)
    state_methods: list[MethodInfo] = field(default_factory=list)
    event_methods: list[MethodInfo] = field(default_factory=list)
    expression_methods: list[MethodInfo] = field(default_factory=list)

    def has_any(self) -> bool:
        return bool(
            self.decision_methods
            or self.state_methods
            or self.event_methods
            or self.expression_methods
        )

    def to_dict(self) -> dict[str, Any]:
        def _names(items: Iterable[MethodInfo]) -> list[str]:
            return [m.name for m in items]

        return {
            "engineKey": self.engine_key,
            "class": self.class_name,
            "role": self.role,
            "decisionMethods": _names(self.decision_methods),
            "stateMethods": _names(self.state_methods),
            "eventMethods": _names(self.event_methods),
            "expressionMethods": _names(self.expression_methods),
        }


def discover_capability(engine: Any, engine_key: str, class_name: str, role: str) -> EngineCapability:
    cap = EngineCapability(engine_key=engine_key, class_name=class_name, role=role)
    seen: set[str] = set()

    def _scan(bucket: list[MethodInfo], names: tuple[str, ...]) -> None:
        for nm in names:
            if nm in seen:
                continue
            info = _inspect_method(engine, nm)
            if info is None:
                continue
            seen.add(nm)
            bucket.append(info)

    _scan(cap.decision_methods, DECISION_METHOD_NAMES)
    _scan(cap.state_methods, STATE_METHOD_NAMES)
    _scan(cap.event_methods, EVENT_METHOD_NAMES)
    _scan(cap.expression_methods, EXPRESSION_METHOD_NAMES)
    return cap


def build_capability_registry(
    engines: dict[str, Any],
    active_engines: dict[str, dict[str, Any]],
) -> dict[str, EngineCapability]:
    out: dict[str, EngineCapability] = {}
    for key, eng in engines.items():
        meta = active_engines.get(key) or {}
        class_name = str(meta.get("class") or eng.__class__.__name__)
        role = str(meta.get("runtimeRole") or "UTILITY")
        cap = discover_capability(eng, key, class_name, role)
        out[key] = cap
    return out


# ---------------------------------------------------------------------------
# GenericEngineAdapter
# ---------------------------------------------------------------------------


def _coerce_for(method: MethodInfo, *, ctx: dict[str, Any] | None, event: dict[str, Any] | None,
                primary_text: str | None) -> list[Any] | None:
    """Build positional args for a method based on its required params.

    Returns None if we cannot satisfy a required parameter.
    """

    if method.arity == 0:
        return []

    # Try to pick something for each required param.
    args: list[Any] = []
    ctx = ctx or {}
    event = event or {}
    text = primary_text
    if text is None:
        text = str(event.get("summary") or event.get("eventType") or ctx.get("currentGoal") or "")

    for nm, kind in zip(method.param_names[: method.arity], method.param_kinds[: method.arity]):
        # Name-based shortcuts beat type-based ones.
        if nm in ("ctx", "context", "tick_ctx", "decision_ctx", "conversation_ctx"):
            args.append(ctx)
            continue
        if nm in ("event", "event_data", "outcome"):
            args.append(event)
            continue
        if nm in ("text", "content", "message", "input", "summary"):
            args.append(text or "")
            continue
        if nm in ("tone", "mood"):
            args.append(str(event.get("tone") or ctx.get("mood") or "neutral"))
            continue
        if nm in ("user_id", "owner_id", "entity_id", "actor_id"):
            args.append(str(ctx.get("entityId") or ctx.get("displayName") or "resident"))
            continue
        if nm in ("limit", "count", "n"):
            args.append(3)
            continue
        if nm in ("seconds", "delta", "elapsed", "dt"):
            args.append(1)
            continue
        if nm in ("intensity", "weight", "value", "score"):
            args.append(0.5)
            continue
        if nm in ("role",):
            args.append("system")
            continue

        # Fall back to type-based.
        if kind == "dict" or kind == "any":
            args.append(ctx)
            continue
        if kind == "str":
            args.append(text or "")
            continue
        if kind == "int":
            args.append(3)
            continue
        if kind == "float":
            args.append(0.5)
            continue
        if kind == "bool":
            args.append(False)
            continue
        if kind == "list":
            args.append([])
            continue
        # We genuinely cannot satisfy this. Skip the call.
        return None
    return args


class GenericEngineAdapter:
    """Capability-driven, type-aware fallback caller for engines without a typed adapter.

    Stateless beyond the capability reference. Safe to instantiate per-engine
    and cache; expensive part (signature inspection) was done at build time.
    """

    __slots__ = ("engine", "cap")

    def __init__(self, engine: Any, cap: EngineCapability) -> None:
        self.engine = engine
        self.cap = cap

    # -- low-level call ------------------------------------------------------

    def _try(self, method: MethodInfo, *, ctx: dict[str, Any] | None, event: dict[str, Any] | None,
             primary_text: str | None) -> Any:
        args = _coerce_for(method, ctx=ctx, event=event, primary_text=primary_text)
        if args is None:
            return None
        fn = getattr(self.engine, method.name, None)
        if fn is None:
            return None
        try:
            return fn(*args)
        except Exception:
            return None

    # -- public surface ------------------------------------------------------

    def gather_state(self, ctx: dict[str, Any]) -> tuple[str, Any] | None:
        """Return (method_name, output) for the first state method that returns
        a non-None value, or None if nothing surfaced."""

        for m in self.cap.state_methods:
            out = self._try(m, ctx=ctx, event=None, primary_text=None)
            if out is not None:
                return (m.name, out)
        return None

    def gather_decision_signals(self, ctx: dict[str, Any]) -> list[tuple[str, Any]]:
        """Return all (method_name, output) tuples for decision-shaped methods."""

        out: list[tuple[str, Any]] = []
        for m in self.cap.decision_methods:
            r = self._try(m, ctx=ctx, event=None, primary_text=None)
            if r is not None:
                out.append((m.name, r))
        return out

    def absorb_event(self, event: dict[str, Any], ctx: dict[str, Any] | None = None) -> Any:
        """Fire every event-shaped method that we can satisfy. Returns the last
        non-None output (or None if nothing fired). All exceptions swallowed."""

        last: Any = None
        primary = str(event.get("summary") or event.get("eventType") or "")
        for m in self.cap.event_methods:
            r = self._try(m, ctx=ctx or {}, event=event, primary_text=primary)
            if r is not None:
                last = r
        return last

    def expression_signal(self, ctx: dict[str, Any]) -> tuple[str, Any] | None:
        """Pull a single expression-shaped output for the extended context."""

        for m in self.cap.expression_methods:
            out = self._try(m, ctx=ctx, event=None, primary_text=None)
            if out is not None:
                return (m.name, out)
        return None


# ---------------------------------------------------------------------------
# Event tagging
# ---------------------------------------------------------------------------


def classify_event_tags(event: dict[str, Any]) -> list[str]:
    """Return short tags describing what kind of event this is. Used by
    EngineBundle.recordEvent to track propagation breadth in debug, and to
    decide whether emotion / personality / goal engines should pay attention.
    """
    tags: list[str] = []
    et = str(event.get("eventType") or "").lower()
    summary = str(event.get("summary") or "").lower()
    rel_delta = float(event.get("relationshipDelta") or 0.0)
    soc_delta = float(event.get("socialDelta") or 0.0)
    impact = abs(float(event.get("emotionalImpact") or 0.0))
    has_partner = bool(event.get("partnerId") or event.get("partnerName"))

    if et:
        tags.append(et)
    if et == "conversation_outcome" or has_partner:
        tags.append("social")
    if abs(rel_delta) > 0.04 or abs(soc_delta) > 0.04 or impact > 0.04:
        tags.append("emotional")
    if "goal" in summary or "objective" in summary or et in {"goal_progress", "objective_completed"}:
        tags.append("goal-related")
    if et in {"memory", "memory_event", "conversation_outcome"} or len(summary) > 8:
        tags.append("memory-worthy")
    if et in {"avoidance", "conflict", "tension"} or float(event.get("relationshipDelta") or 0.0) < -0.1:
        tags.append("conflict")
    if et in {"praise", "warmth"} or rel_delta > 0.1:
        tags.append("positive")
    if not tags:
        tags.append("ambient")
    return tags


# ---------------------------------------------------------------------------
# Output relevance / summarization helpers
# ---------------------------------------------------------------------------


def summarize_engine_output(value: Any, max_chars: int = 140) -> str:
    """Produce a short string description of an engine output, prompt-safe."""

    if value is None:
        return "none"
    if isinstance(value, str):
        return value.strip()[:max_chars]
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, float)):
        return f"{value:.2f}" if isinstance(value, float) else str(value)
    if isinstance(value, dict):
        # Sort by absolute numeric value where possible to surface dominant components.
        numeric = [(k, v) for k, v in value.items() if isinstance(v, (int, float))]
        if numeric:
            numeric.sort(key=lambda kv: abs(float(kv[1])), reverse=True)
            top = numeric[:4]
            return ", ".join(f"{k}={float(v):.2f}" for k, v in top)[:max_chars]
        keys = list(value.keys())[:4]
        return ", ".join(f"{k}={summarize_engine_output(value.get(k), 28)}" for k in keys)[:max_chars]
    if isinstance(value, (list, tuple)):
        bits: list[str] = []
        for item in value[:4]:
            bits.append(summarize_engine_output(item, max_chars=40))
        return "; ".join(b for b in bits if b)[:max_chars]
    text = str(value)
    return text.strip()[:max_chars]


def relevance_score(role: str, base: int = 10) -> int:
    """Score for context ranking. Higher = more relevant for the conversation
    spine. Uses CONTEXT_PRIORITY and an additive base so we never return 0."""

    return base + CONTEXT_PRIORITY.get(role, 0)
