from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import inspect
import re
from typing import Any, ClassVar

from engine_adapters import TYPED_ADAPTERS, get_typed_adapter
from engine_capabilities import (
    CONTEXT_PRIORITY,
    DECISION_PRIORITY,
    EngineCapability,
    GenericEngineAdapter,
    build_capability_registry,
    classify_event_tags,
    relevance_score,
    summarize_engine_output,
)
from engine_factory import (
    DiscoveredEngineClass,
    build_engine,
    discover_engine_inventory,
    method_signature,
)
from ollama_config import ENGINE_DEFAULT_MODEL, resolve_ollama_model


RUNTIME_ROLES = {
    "CONTROL",
    "MEMORY",
    "EMOTION",
    "PERSONALITY",
    "COGNITION",
    "EXPRESSION",
    "UTILITY",
    "PASSIVE_MONITOR",
    "DISABLED_WITH_REASON",
}

DECISION_INTENTS = {
    "go_home",
    "seek_food",
    "seek_social",
    "avoid_entity",
    "pursue_daily_objective",
    "wander",
    "idle",
    "start_conversation",
    "reflect",
}


@dataclass
class EngineBundle:
    entity_id: str
    display_name: str
    state: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)

    engines: dict[str, Any] = field(default_factory=dict)
    inventory: list[dict[str, Any]] = field(default_factory=list)
    excluded_classes: list[dict[str, Any]] = field(default_factory=list)
    engine_contracts: dict[str, dict[str, Any]] = field(default_factory=dict)
    active_engines: dict[str, dict[str, Any]] = field(default_factory=dict)
    disabled_engines: dict[str, str] = field(default_factory=dict)
    last_engine_outputs: dict[str, Any] = field(default_factory=dict)

    total_classes_discovered: int = 0
    total_engines_discovered: int = 0
    total_engines_instantiated: int = 0
    total_excluded_data_containers: int = 0
    total_composites_wired: int = 0
    last_input_event: dict[str, Any] | None = None
    last_decision_output: dict[str, Any] | None = None
    last_decision_source: str = "fallback"
    last_emotion_summary: str | None = None
    last_personality_summary: str | None = None
    last_memory_summary: str | None = None

    # Capability registry: built once after engines are wired. Keyed by engine_key.
    capabilities: dict[str, EngineCapability] = field(default_factory=dict)
    # Cached generic adapters for engines without a typed adapter. Per-engine.
    generic_adapters: dict[str, GenericEngineAdapter] = field(default_factory=dict)
    # Per-decision: which engines contributed which intent and weight. Reset on each call.
    last_decision_breakdown: list[dict[str, Any]] = field(default_factory=list)
    # Per-conversation-context: which engines contributed signals and their relevance.
    last_context_sources: list[dict[str, Any]] = field(default_factory=list)
    # Per-event: classification tags assigned to the most recent event.
    last_event_tags: list[str] = field(default_factory=list)
    # Cumulative count of conversation outcomes that fired through the bundle.
    contribution_counters: dict[str, int] = field(default_factory=dict)

    @staticmethod
    def _engine_state_dir(entity_id: str) -> Path:
        root = Path(__file__).resolve().parent / "state" / "engines" / entity_id
        root.mkdir(parents=True, exist_ok=True)
        return root

    @staticmethod
    def _parse_constructor_param_names(signature: str | None) -> set[str]:
        if not signature:
            return set()
        inner = signature.strip()
        if inner.startswith("(") and inner.endswith(")"):
            inner = inner[1:-1]
        out: set[str] = set()
        for part in inner.split(","):
            token = part.strip()
            if not token or token == "self":
                continue
            token = token.split(":")[0].split("=")[0].strip()
            if token:
                out.add(token)
        return out

    @staticmethod
    def _safe_filename(key: str, suffix: str = ".json") -> str:
        return key.replace(".", "_").replace("/", "_") + suffix

    # Extensions that are persisted as binary databases by their owning engines
    # (e.g. SQLite via MemoryManagerLyra). For these we must:
    #   1. preserve the extension when building the path we hand to the engine
    #   2. skip the generic JSON load_state fallback (the engine handles its own
    #      durable load via the DB connection it opens at construction time)
    DB_STORAGE_EXTENSIONS: ClassVar[frozenset[str]] = frozenset(
        {".db", ".sqlite", ".sqlite3"}
    )

    # Cheap magic-number sniffer so we can detect a SQLite DB that has
    # accidentally been persisted under a `.json` filename (legacy bug,
    # see _migrate_misnamed_db_state).
    _SQLITE_MAGIC: ClassVar[bytes] = b"SQLite format 3\x00"

    @staticmethod
    def _extract_param_default(signature: str | None, param_name: str) -> str | None:
        """Return the literal quoted default value of a constructor parameter
        from its signature string, e.g. 'memory.db' for
        `state_path: str = 'memory.db'`, or 'mistral' for `model: str = 'mistral'`.

        Returns None when the parameter is missing or the default is not a
        simple quoted string. Numeric defaults (`tau: float = 0.6`) and None
        defaults (`memory_core=None`) are intentionally not handled here —
        callers that need those should add a separate parser.
        """
        if not signature or not param_name:
            return None
        # Match either single- or double-quoted defaults. We tolerate (and
        # skip past) an optional type annotation between the param name and
        # the equals sign, since the introspection step writes them in.
        pattern = (
            re.escape(param_name)
            + r"\s*(?::\s*[^=,)]+?)?\s*=\s*(['\"])([^'\"]*)\1"
        )
        m = re.search(pattern, signature)
        if not m:
            return None
        return m.group(2)

    @classmethod
    def _extract_state_path_default(cls, signature: str | None) -> str | None:
        """Backwards-compatible alias used by the existing helper smoke tests."""
        return cls._extract_param_default(signature, "state_path")

    @classmethod
    def _state_path_extension(cls, signature: str | None) -> str:
        """Return the file extension to use for this engine's `state_path`.
        Falls back to `.json` when no default is parseable. Critically returns
        `.db` (or whatever the engine declared) for DB-backed engines like
        MemoryManagerLyra, so we don't try to JSON-decode SQLite files."""
        default_value = cls._extract_param_default(signature, "state_path")
        if not default_value:
            return ".json"
        suffix = Path(default_value).suffix.lower()
        if not suffix:
            return ".json"
        return suffix

    @classmethod
    def _is_db_backed(cls, signature: str | None) -> bool:
        ext = cls._state_path_extension(signature)
        return ext in cls.DB_STORAGE_EXTENSIONS

    @classmethod
    def _maybe_override_model_kwarg(cls, signature: str | None) -> str | None:
        """If the engine constructor has a `model` parameter that defaults to
        the ENGINE_DEFAULT_MODEL string ('mistral'), return the resolved
        Ollama model we should pass instead. Returns None when no override
        applies (engine doesn't take `model`, default is something else, or
        the resolver concluded that 'mistral' is still the right answer).

        Conservative on purpose: we only touch the kwarg when the engine
        specifically asked for the known-broken default. An engine with
        `model: str = 'llama3.2'` would not be overridden, even though we
        could technically rewrite it; that's a deliberate choice to avoid
        clobbering forward configuration.
        """
        default_model = cls._extract_param_default(signature, "model")
        if default_model != ENGINE_DEFAULT_MODEL:
            return None
        resolved = resolve_ollama_model()
        if resolved == ENGINE_DEFAULT_MODEL:
            # Resolver concluded mistral is what to use (e.g. user set
            # the env var to mistral, or Ollama is offline). No-op.
            return None
        return resolved

    @classmethod
    def _migrate_misnamed_db_state(
        cls,
        state_dir: Path,
        item: DiscoveredEngineClass,
        target_path: Path,
    ) -> None:
        """If a previous run wrote a SQLite database to `<key>.json` (the
        legacy bug, before we honored the constructor default's extension),
        rename it to the proper extension so the engine reopens its own data
        instead of starting blank. Logs and continues on any failure."""
        if target_path.exists():
            return
        legacy_json = state_dir / cls._safe_filename(item.key, ".json")
        if not legacy_json.exists():
            return
        try:
            with legacy_json.open("rb") as f:
                head = f.read(len(cls._SQLITE_MAGIC))
        except OSError:
            return
        if head != cls._SQLITE_MAGIC:
            # Genuine JSON file at the legacy path; leave it alone. The engine
            # will not consume it because its `state_path` now points at the
            # correctly-suffixed location.
            return
        try:
            legacy_json.replace(target_path)
            print(
                f"[EngineBundle] migrated misnamed SQLite state "
                f"{legacy_json.name} -> {target_path.name}"
            )
        except OSError as exc:
            print(
                f"[EngineBundle] failed to migrate misnamed SQLite state "
                f"{legacy_json}: {exc}"
            )

    @staticmethod
    def _classify_role(package: str, class_name: str) -> str:
        name = class_name.lower()
        if any(x in name for x in ["observer", "monitor", "instrumentation", "dashboard", "load_balancer"]):
            return "PASSIVE_MONITOR"
        if any(x in name for x in ["voice", "avatar", "song", "writing", "response", "image", "vision", "djmusic"]):
            return "EXPRESSION"
        if class_name in {"RecompositionEngine"}:
            return "EXPRESSION"
        if class_name in {"KnowledgeFusionEngine", "ReasoningEngine", "ReflectionEngine"}:
            return "COGNITION"
        if package == "emotion":
            return "EMOTION"
        if package == "memory":
            return "MEMORY"
        if package == "personality":
            return "PERSONALITY"
        if package == "behavior":
            return "CONTROL"
        if package == "cognitive":
            return "COGNITION"
        if package == "utility":
            return "UTILITY"
        return "UTILITY"

    def _constructor_kwargs_for(self, item: DiscoveredEngineClass, state_dir: Path) -> dict[str, Any]:
        names = self._parse_constructor_param_names(item.constructor_signature)
        # Honour the extension declared in the engine's own constructor default.
        # Most engines default to `.json`, but a few (e.g. MemoryManagerLyra
        # with `state_path = 'memory.db'`) persist a SQLite database. Passing
        # them a `.json` path corrupts both directions: the engine writes
        # binary to a `.json` file, and our generic JSON `load_state` blows up
        # on UTF-8 decode the next startup.
        state_ext = self._state_path_extension(item.constructor_signature)
        key_file = self._safe_filename(item.key, state_ext)
        out: dict[str, Any] = {}
        if "state_path" in names:
            target = state_dir / key_file
            # If the previous run created a `.json`-named SQLite file, rename
            # it so the engine reattaches to its own historical state.
            if state_ext in self.DB_STORAGE_EXTENSIONS:
                self._migrate_misnamed_db_state(state_dir, item, target)
            out["state_path"] = str(target)
        if "db_path" in names:
            out["db_path"] = str(state_dir / self._safe_filename(item.key, ".db"))
        # Engines that hard-code `model = 'mistral'` (notably the Ollama client
        # utility) need to be steered onto whatever the local Ollama install
        # actually has. Otherwise every engine LLM call logs a "model not
        # found" warning and silently falls back to a stub. Only kicks in
        # when the engine declared exactly the known-broken default.
        if "model" in names:
            override = self._maybe_override_model_kwarg(item.constructor_signature)
            if override is not None:
                out["model"] = override
        if "behavior_registry_path" in names:
            out["behavior_registry_path"] = str(state_dir / "behavior_registry.json")
        if "config" in names:
            out["config"] = {
                "entity_id": self.entity_id,
                "display_name": self.display_name,
                "enabled": False if "observer" in item.class_name.lower() else True,
            }
        if "agent_name" in names:
            out["agent_name"] = self.display_name
        if "owner_id" in names:
            out["owner_id"] = self.entity_id
        if "user_id" in names:
            out["user_id"] = self.entity_id
        if "path" in names and "state_path" not in names and "db_path" not in names:
            out["path"] = str(state_dir / key_file)
        if "output_dir" in names:
            path = state_dir / "output"
            path.mkdir(parents=True, exist_ok=True)
            out["output_dir"] = str(path)
        if "log_dir" in names:
            path = state_dir / "logs"
            path.mkdir(parents=True, exist_ok=True)
            out["log_dir"] = str(path)
        for optional_none in [
            "vector_memory",
            "memory_manager",
            "llm_generate",
            "llm_client",
            "backend_router",
            "diary_writer",
            "presence_manager",
            "voice_client",
            "whisper_model",
            "tts_engine",
            "tokenizer",
            "personality_engine",
            "mental_health",
            "goal_engine",
            "memory_core",
            "episode_memory",
            "knowledge_base",
            "self_model",
            "drive_model",
            "daily_rhythm",
            "emotion_kernel",
            "initiative_scheduler",
            "connor_state",
            "seed",
            "relational_memory",
            "deep_review_engine",
            "regulator",
            "psi_engine",
            "agent",
        ]:
            if optional_none in names:
                out[optional_none] = None
        return out

    def _disable(self, key: str, reason: str) -> None:
        self.disabled_engines[key] = reason
        self.active_engines.pop(key, None)
        for row in self.inventory:
            if row.get("key") == key:
                row["runtimeRole"] = "DISABLED_WITH_REASON"
                row["status"] = "disabled"
                row["reason"] = reason
                break

    def _register_contract(self, key: str, obj: Any, role: str, item: DiscoveredEngineClass) -> None:
        methods = [
            "initialize",
            "load_state",
            "save_state",
            "get_state",
            "get_state_dict",
            "update",
            "tick",
            "process",
            "reflect",
            "analyze",
            "plan",
            "select_behavior",
            "decide",
            "suggest_decision",
            "store",
            "store_memory",
            "record_event",
            "record_outcome",
            "observe_state",
            "get_top_intent",
            "get_intent_prompt_modifier",
            "get_traits",
            "get_summary",
            "get_status",
        ]
        self.engine_contracts[key] = {
            "class": obj.__class__.__name__,
            "module": item.module_name,
            "constructor": item.constructor_signature,
            "runtimeRole": role,
            "methods": {m: method_signature(obj, m) for m in methods if getattr(obj, m, None) is not None},
        }
        self.active_engines[key] = {
            "class": obj.__class__.__name__,
            "module": item.module_name,
            "runtimeRole": role,
        }

    @staticmethod
    def _annotation_accepts_dict(ann: Any) -> bool:
        if ann is inspect._empty:
            return True
        try:
            ann_str = str(ann)
        except Exception:
            return False
        if ann is dict:
            return True
        return any(token in ann_str for token in ("Dict", "Mapping", "dict", "Any"))

    def _invoke(self, key: str, method_name: str, payload: dict[str, Any]) -> Any:
        """Generic, type-aware fallback caller.

        Only used for engines without a registered typed adapter. Conservative:
        - calls 0-arg methods directly
        - feeds dict payloads only into params annotated as dict/Mapping/Any
        - skips silently when required params demand str/int/float we cannot guess
        """
        eng = self.engines.get(key)
        if eng is None:
            return None
        fn = getattr(eng, method_name, None)
        if fn is None:
            return None
        try:
            sig = inspect.signature(fn)
        except (TypeError, ValueError):
            try:
                return fn()
            except Exception:
                return None
        params = [p for p in sig.parameters.values() if p.name != "self"]
        required = [
            p for p in params if p.default is inspect._empty and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)
        ]
        try:
            if not required:
                return fn()
            if len(required) == 1:
                p = required[0]
                if p.name in payload:
                    return fn(payload[p.name])
                if p.name in ("ctx", "context", "tick_ctx", "decision_ctx"):
                    return fn(payload.get("context", {}))
                if p.name in ("event", "event_data"):
                    return fn(payload.get("event", {}))
                if self._annotation_accepts_dict(p.annotation):
                    return fn(payload.get("context", {}))
                return None
            kwargs: dict[str, Any] = {}
            ok = True
            for p in params:
                if p.name in payload:
                    kwargs[p.name] = payload[p.name]
                elif p.name == "context" and self._annotation_accepts_dict(p.annotation):
                    kwargs[p.name] = payload.get("context", {})
                elif p.name in ("event", "event_data") and self._annotation_accepts_dict(p.annotation):
                    kwargs[p.name] = payload.get("event", {})
                elif p.default is not inspect._empty:
                    continue
                else:
                    ok = False
                    break
            if not ok:
                return None
            return fn(**kwargs)
        except Exception as e:
            self._disable(key, f"{method_name} failed: {e}")
            return None

    @staticmethod
    def _phase_label(phase_name: str) -> str:
        if phase_name.startswith("emotion"):
            return "emotion"
        if phase_name.startswith("memory"):
            return "memory"
        if phase_name.startswith("personality"):
            return "personality"
        if phase_name.startswith("cognition"):
            return "cognition"
        if phase_name.startswith("behavior"):
            return "behavior"
        if phase_name.startswith("expression"):
            return "expression"
        if phase_name.startswith("utility"):
            return "utility"
        return "physiology"

    def _phase_tick(self, phase_name: str, roles: set[str], methods: list[str], context: dict[str, Any]) -> None:
        phase_label = self._phase_label(phase_name)
        last_event = self.last_input_event.get("event") if isinstance(self.last_input_event, dict) else {}
        if not isinstance(last_event, dict):
            last_event = {}
        for key, meta in list(self.active_engines.items()):
            role = str(meta.get("runtimeRole"))
            if role not in roles:
                continue
            class_name = str(meta.get("class"))
            adapter = get_typed_adapter(class_name)
            if adapter is not None:
                try:
                    out = adapter(self.engines.get(key), phase_label, context, last_event)
                except Exception as e:
                    self._disable(key, f"typed adapter {phase_label} failed: {e}")
                    continue
                if out is not None:
                    self.last_engine_outputs[key] = out
                continue

            # No typed adapter: use the capability-driven generic adapter.
            adp = self.generic_adapters.get(key)
            cap = self.capabilities.get(key)
            if adp is None or cap is None or not cap.has_any():
                continue

            last_out: Any = None
            try:
                # Try methods that the spec says should fire during this phase.
                for method_name in methods:
                    info = next((m for m in cap.event_methods + cap.state_methods + cap.decision_methods + cap.expression_methods
                                 if m.name == method_name), None)
                    if info is None:
                        continue
                    out = adp._try(info, ctx=context, event=last_event, primary_text=None)
                    if out is not None:
                        last_out = out
                # Always pull a state read at the end of the phase if available.
                state_pair = adp.gather_state(context)
                if state_pair is not None:
                    last_out = state_pair[1]
            except Exception as e:
                # Generic adapter must NEVER take down the loop. Log via disable
                # only if the failure looks reproducible; otherwise swallow.
                self._disable(key, f"generic adapter {phase_label} failed: {e}")
                continue
            if last_out is not None:
                self.last_engine_outputs[key] = last_out

    def _wire_known_dependencies(self) -> None:
        lower_key = {k.lower(): k for k in self.engines.keys()}

        def first_contains(chunks: list[str]) -> Any:
            for key in lower_key.values():
                lk = key.lower()
                if all(chunk in lk for chunk in chunks):
                    return self.engines.get(key)
            return None

        for key, eng in self.engines.items():
            if key in self.disabled_engines:
                continue
            try:
                if hasattr(eng, "emotion_kernel") and getattr(eng, "emotion_kernel", None) is None:
                    setattr(eng, "emotion_kernel", first_contains(["emotion"]))
                if hasattr(eng, "drive_model") and getattr(eng, "drive_model", None) is None:
                    setattr(eng, "drive_model", first_contains(["drive", "model"]))
                if hasattr(eng, "goal_engine") and getattr(eng, "goal_engine", None) is None:
                    setattr(eng, "goal_engine", first_contains(["goal", "engine"]))
                if hasattr(eng, "daily_rhythm") and getattr(eng, "daily_rhythm", None) is None:
                    setattr(eng, "daily_rhythm", first_contains(["daily", "rhythm"]))
                if hasattr(eng, "memory_core") and getattr(eng, "memory_core", None) is None:
                    setattr(eng, "memory_core", first_contains(["memory", "core"]))
                if hasattr(eng, "self_model") and getattr(eng, "self_model", None) is None:
                    setattr(eng, "self_model", first_contains(["self", "model"]))
            except Exception as e:
                self._disable(key, f"dependency wiring failed: {e}")

    @classmethod
    def create(cls, entity_id: str, snapshot: dict[str, Any]) -> "EngineBundle":
        name = str(snapshot.get("displayName") or entity_id)
        b = cls(entity_id=entity_id, display_name=name, state={"snapshot": snapshot})
        state_dir = cls._engine_state_dir(entity_id)

        discovered = discover_engine_inventory()
        b.total_classes_discovered = len(discovered)

        deferred: list[DiscoveredEngineClass] = []
        for item in discovered:
            if item.is_data_container:
                b.excluded_classes.append(
                    {
                        "key": item.key,
                        "package": item.package,
                        "module": item.module_name,
                        "class": item.class_name,
                        "constructor": item.constructor_signature,
                        "runtimeRole": "DATA_CONTAINER",
                        "status": "excluded",
                        "reason": "value object / dataclass / enum, not an engine",
                    }
                )
                continue
            if item.is_composite:
                deferred.append(item)
                continue
            b._instantiate_engine(item, state_dir, snapshot)

        b._wire_advanced_pairing_composites(state_dir, snapshot, deferred)
        b._wire_known_dependencies()
        b._build_capabilities()

        b.total_engines_discovered = b.total_classes_discovered - len(b.excluded_classes)
        b.total_excluded_data_containers = len(b.excluded_classes)
        return b

    def _build_capabilities(self) -> None:
        """Inspect every active engine ONCE and build the per-engine capability map.

        Engines with a typed adapter still get their capability scanned (for
        debug visibility), but the typed adapter takes precedence at call time.
        """
        self.capabilities = build_capability_registry(self.engines, self.active_engines)
        self.generic_adapters = {}
        for key, eng in self.engines.items():
            cap = self.capabilities.get(key)
            if cap is None:
                continue
            self.generic_adapters[key] = GenericEngineAdapter(eng, cap)

    def _instantiate_engine(
        self,
        item: DiscoveredEngineClass,
        state_dir: Path,
        snapshot: dict[str, Any],
    ) -> bool:
        module_rel = item.module_name.removeprefix("Engines.")
        role = self._classify_role(item.package, item.class_name)
        kwargs = self._constructor_kwargs_for(item, state_dir)
        built = build_engine(module_rel, item.class_name, **kwargs)

        row = {
            "key": item.key,
            "package": item.package,
            "module": item.module_name,
            "class": item.class_name,
            "constructor": item.constructor_signature,
            "runtimeRole": role,
            "status": "active" if built.active else "disabled",
            "reason": built.error if not built.active else None,
        }
        self.inventory.append(row)

        if not built.active:
            self.disabled_engines[item.key] = built.error or "import/construct failed"
            row["runtimeRole"] = "DISABLED_WITH_REASON"
            return False

        self.engines[item.key] = built.instance
        self._register_contract(item.key, built.instance, role, item)
        self.total_engines_instantiated += 1

        _ = self._invoke(item.key, "initialize", {"context": snapshot, "state": self.state, "event": {}})
        # DB-backed engines (SQLite-style) load themselves via the connection
        # they opened at construction time. Calling our generic JSON-shaped
        # `load_state` against them throws "'utf-8' codec can't decode" on
        # the SQLite header bytes — which is exactly the noise we used to see
        # for memory_manager_lyra on every restart, causing every NPC's lyra
        # memory to come up empty. So we skip it for DB-backed engines.
        if not self._is_db_backed(item.constructor_signature):
            _ = self._invoke(item.key, "load_state", {"context": snapshot, "state": self.state, "event": {}})
        return True

    def _wire_advanced_pairing_composites(
        self,
        state_dir: Path,
        snapshot: dict[str, Any],
        deferred: list[DiscoveredEngineClass],
    ) -> None:
        """Build the four `advanced_pairing_engine` composites that need sibling engine
        instances as constructor args. Order is fixed because some composites depend
        on others (e.g. KnowledgeFusionEngine needs RecompositionEngine)."""

        word_lib = self.engines.get("cognitive.advanced_pairing_engine.word_library")
        pat_lib = self.engines.get("cognitive.advanced_pairing_engine.pattern_library")
        fact_db = self.engines.get("cognitive.advanced_pairing_engine.fact_database")
        concept = self.engines.get("cognitive.advanced_pairing_engine.concept_dictionary")
        parser = self.engines.get("cognitive.advanced_pairing_engine.sentence_parser")

        def find_item(name: str) -> DiscoveredEngineClass | None:
            for item in deferred:
                if item.class_name == name:
                    return item
            return None

        order: list[tuple[str, dict[str, Any]]] = []
        recomp_kwargs: dict[str, Any] = {}
        if word_lib is not None and pat_lib is not None:
            recomp_kwargs = {"word_library": word_lib, "pattern_library": pat_lib}
            order.append(("RecompositionEngine", recomp_kwargs))
        if word_lib is not None and pat_lib is not None and fact_db is not None and parser is not None:
            order.append(
                (
                    "ReasoningEngine",
                    {
                        "word_library": word_lib,
                        "pattern_library": pat_lib,
                        "fact_database": fact_db,
                        "parser": parser,
                    },
                )
            )

        built_recomp: Any = None
        for class_name, kwargs in order:
            item = find_item(class_name)
            if item is None:
                continue
            ok = self._instantiate_composite(item, kwargs)
            if ok and class_name == "RecompositionEngine":
                built_recomp = self.engines.get(item.key)

        # Second wave: needs RecompositionEngine
        if built_recomp is not None and concept is not None:
            for class_name, kwargs in [
                (
                    "KnowledgeFusionEngine",
                    {"concept_dictionary": concept, "recomposition_engine": built_recomp},
                ),
                (
                    "ReflectionEngine",
                    {
                        "word_library": word_lib,
                        "pattern_library": pat_lib,
                        "concept_dictionary": concept,
                        "recomposition_engine": built_recomp,
                    },
                ),
            ]:
                item = find_item(class_name)
                if item is None:
                    continue
                if any(v is None for v in kwargs.values()):
                    self._record_composite_skipped(item, "missing sibling dependency")
                    continue
                self._instantiate_composite(item, kwargs)

        # Any composites still untouched (deps missing) get recorded as disabled with reason.
        recorded_keys = {row["key"] for row in self.inventory}
        for item in deferred:
            if item.key in recorded_keys:
                continue
            self._record_composite_skipped(item, "required sibling engine not built")

    def _instantiate_composite(self, item: DiscoveredEngineClass, kwargs: dict[str, Any]) -> bool:
        module_rel = item.module_name.removeprefix("Engines.")
        role = self._classify_role(item.package, item.class_name)
        built = build_engine(module_rel, item.class_name, **kwargs)
        row = {
            "key": item.key,
            "package": item.package,
            "module": item.module_name,
            "class": item.class_name,
            "constructor": item.constructor_signature,
            "runtimeRole": role,
            "status": "active" if built.active else "disabled",
            "reason": built.error if not built.active else None,
            "composite": True,
        }
        self.inventory.append(row)
        if not built.active:
            self.disabled_engines[item.key] = built.error or "composite construct failed"
            row["runtimeRole"] = "DISABLED_WITH_REASON"
            return False
        self.engines[item.key] = built.instance
        self._register_contract(item.key, built.instance, role, item)
        self.total_engines_instantiated += 1
        self.total_composites_wired += 1
        return True

    def _record_composite_skipped(self, item: DiscoveredEngineClass, reason: str) -> None:
        row = {
            "key": item.key,
            "package": item.package,
            "module": item.module_name,
            "class": item.class_name,
            "constructor": item.constructor_signature,
            "runtimeRole": "DISABLED_WITH_REASON",
            "status": "disabled",
            "reason": reason,
            "composite": True,
        }
        self.inventory.append(row)
        self.disabled_engines[item.key] = reason

    def to_state(self) -> dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "display_name": self.display_name,
            "state": self.state,
            "events": self.events[-200:],
            "inventory": self.inventory,
            "excluded_classes": self.excluded_classes,
            "active_engines": self.active_engines,
            "disabled_engines": self.disabled_engines,
            "engine_contracts": self.engine_contracts,
            "last_engine_outputs": self.last_engine_outputs,
            "last_input_event": self.last_input_event,
            "last_decision_output": self.last_decision_output,
            "last_decision_source": self.last_decision_source,
            "last_emotion_summary": self.last_emotion_summary,
            "last_personality_summary": self.last_personality_summary,
            "last_memory_summary": self.last_memory_summary,
            "total_classes_discovered": self.total_classes_discovered,
            "total_engines_discovered": self.total_engines_discovered,
            "total_engines_instantiated": self.total_engines_instantiated,
            "total_excluded_data_containers": self.total_excluded_data_containers,
            "total_composites_wired": self.total_composites_wired,
            # Phase 7 runtime visibility — preserved across reloads.
            "last_decision_breakdown": self.last_decision_breakdown,
            "last_context_sources": self.last_context_sources,
            "last_event_tags": self.last_event_tags,
            "contribution_counters": self.contribution_counters,
        }

    @classmethod
    def from_state(cls, entity_id: str, data: dict[str, Any]) -> "EngineBundle":
        base_snapshot = data.get("state", {}).get("snapshot", {})
        b = cls.create(entity_id, base_snapshot if isinstance(base_snapshot, dict) else {})
        b.state = data.get("state", {}) if isinstance(data.get("state"), dict) else {}
        events = data.get("events", [])
        b.events = events if isinstance(events, list) else []
        b.last_input_event = data.get("last_input_event")
        b.last_decision_output = data.get("last_decision_output")
        b.last_decision_source = str(data.get("last_decision_source", b.last_decision_source))
        b.last_emotion_summary = data.get("last_emotion_summary")
        b.last_personality_summary = data.get("last_personality_summary")
        b.last_memory_summary = data.get("last_memory_summary")
        # Restore Phase 7 visibility fields if present (they're harmless if not).
        breakdown = data.get("last_decision_breakdown")
        if isinstance(breakdown, list):
            b.last_decision_breakdown = breakdown
        sources = data.get("last_context_sources")
        if isinstance(sources, list):
            b.last_context_sources = sources
        tags = data.get("last_event_tags")
        if isinstance(tags, list):
            b.last_event_tags = [str(t) for t in tags]
        counters = data.get("contribution_counters")
        if isinstance(counters, dict):
            b.contribution_counters = {str(k): int(v) for k, v in counters.items() if isinstance(v, (int, float))}
        # Counts always reflect the current discovery, not an old snapshot.
        return b

    @staticmethod
    def _summarize(value: Any) -> str:
        if value is None:
            return "none"
        if isinstance(value, str):
            return value.strip()[:140]
        if isinstance(value, (int, float, bool)):
            return str(value)
        if isinstance(value, dict):
            keys = list(value.keys())[:4]
            return ", ".join(f"{k}={value.get(k)}" for k in keys)
        if isinstance(value, list):
            return ", ".join(str(x)[:30] for x in value[:4])
        return str(value)[:140]

    def tick(self, tick_ctx: dict[str, Any]) -> dict[str, Any]:
        self.last_input_event = {
            "kind": "tick",
            "at": datetime.now().isoformat(),
            "tickContext": tick_ctx,
        }
        self.state["last_tick_context"] = tick_ctx
        self.state["last_goal"] = tick_ctx.get("currentGoal", self.state.get("last_goal", "idle"))
        self.state["last_mood"] = tick_ctx.get("mood", self.state.get("last_mood", "calm"))

        self._phase_tick("physiology/state", RUNTIME_ROLES - {"DISABLED_WITH_REASON"}, ["tick", "update"], tick_ctx)
        self._phase_tick("emotion", {"EMOTION"}, ["update", "tick", "process_event"], tick_ctx)
        self._phase_tick("memory", {"MEMORY"}, ["update", "tick", "process", "consolidate", "reconcile"], tick_ctx)
        self._phase_tick("personality/self", {"PERSONALITY"}, ["update", "tick", "reflect", "get_traits", "get_summary"], tick_ctx)
        self._phase_tick("cognition/reflection/planning", {"COGNITION"}, ["update", "tick", "analyze", "reflect", "plan"], tick_ctx)
        self._phase_tick("behavior/action", {"CONTROL"}, ["update", "tick", "select_behavior", "decide"], tick_ctx)
        self._phase_tick("expression/context", {"EXPRESSION"}, ["update", "tick", "generate", "compose"], tick_ctx)
        self._phase_tick("utility/monitoring", {"UTILITY", "PASSIVE_MONITOR"}, ["update", "tick", "observe_state", "monitor", "get_status"], tick_ctx)

        emotion_blobs = [self._summarize(v) for k, v in self.last_engine_outputs.items() if "emotion" in k]
        personality_blobs = [self._summarize(v) for k, v in self.last_engine_outputs.items() if "personality" in k or "self_model" in k]
        memory_blobs = [self._summarize(v) for k, v in self.last_engine_outputs.items() if "memory" in k]
        self.last_emotion_summary = emotion_blobs[0] if emotion_blobs else self.last_emotion_summary
        self.last_personality_summary = personality_blobs[0] if personality_blobs else self.last_personality_summary
        self.last_memory_summary = memory_blobs[0] if memory_blobs else self.last_memory_summary

        return {
            "ok": True,
            "emotionSummary": self.last_emotion_summary or f"{self.display_name} remains steady",
            "summary": f"engines_active={len(self.active_engines)} disabled={len(self.disabled_engines)}",
        }

    @staticmethod
    def _normalize_intent(raw: Any) -> tuple[str | None, float, str | None, str | None]:
        """Strict intent normalizer.

        Accepts:
        - explicit dicts: must carry one of {"intent","action","next_action","decision","behavior"}
          whose value normalizes to a known intent.
        - explicit strings: full-string match against DECISION_INTENTS or the
          short alias map below.

        Refuses to do substring-fallthrough on `str(some_dict)` because that
        used to produce false votes whenever a state-shaped dict happened to
        contain the substring of an intent name (e.g. "idle" in `{'behavior':
        'idle'}` strangely matched, but so did `{'state': 'building_idle_loop'}`
        which is not a decision)."""
        if raw is None:
            return (None, 0.0, None, None)
        intent_str: str | None = None
        conf = 0.55
        target: Any = None
        rationale: Any = None
        if isinstance(raw, dict):
            for k in ("intent", "action", "next_action", "decision", "behavior"):
                v = raw.get(k)
                if isinstance(v, str) and v.strip():
                    intent_str = v.strip().lower()
                    break
            if intent_str is None:
                return (None, 0.0, None, None)
            conf = float(raw.get("confidence", 0.55) or 0.55)
            target = raw.get("targetEntityId")
            rationale = raw.get("rationale")
        elif isinstance(raw, str):
            intent_str = raw.strip().lower()
            if not intent_str:
                return (None, 0.0, None, None)
        else:
            return (None, 0.0, None, None)

        # Direct match wins.
        if intent_str in DECISION_INTENTS:
            return (intent_str, conf,
                    str(target) if isinstance(target, str) else None,
                    str(rationale) if isinstance(rationale, str) else None)

        # Short alias map. Whole-string match (or first-token match for
        # multi-word strings) — never substring-of-arbitrary-text.
        alias = {
            "rest": "go_home",
            "sleep": "go_home",
            "home": "go_home",
            "food": "seek_food",
            "eat": "seek_food",
            "social": "seek_social",
            "talk": "start_conversation",
            "conversation": "start_conversation",
            "avoid": "avoid_entity",
            "objective": "pursue_daily_objective",
            "goal": "pursue_daily_objective",
            "reflect": "reflect",
            "wander": "wander",
            "idle": "idle",
        }
        if intent_str in alias:
            return (alias[intent_str], conf, None, intent_str[:120])
        # First token only — refuses to chase substrings deep inside text.
        head = intent_str.split()[0] if intent_str else ""
        head = head.strip(".,;:!?-_")
        if head in alias:
            return (alias[head], conf, None, intent_str[:120])
        return (None, 0.0, None, None)

    # Class-aware mapping from typed-adapter engines to the canonical intent
    # method used to interpret their cached output. Without this, a single
    # cached output can be misattributed across the wrong mapper.
    _TYPED_INTENT_METHOD: ClassVar[dict[str, str]] = {
        "DriveModelSeed": "get_active_drive",
        "IntentSystem": "get_top_intent",
        "GoalEngineGramps": "get_active_goals",
        "DailyRhythmLyra": "get_current_phase",
    }

    # -- Decision source bonuses ---------------------------------------------
    # Method-name → source-bonus multiplier. These bias the vote *on top of*
    # the role priority. Higher = louder voice.
    _DECISION_SOURCE_BONUS: ClassVar[dict[str, float]] = {
        "synthesize_decision": 1.0,
        "suggest_decision": 1.0,
        "select_behavior": 1.0,
        "decide": 1.0,
        "recommend_action": 1.0,
        "next_action": 1.0,
        "choose_action": 1.0,
        # Intent surface — explicit "I want this" beats raw decision votes.
        "get_top_intent": 1.2,
        "get_active_intent": 1.2,
        "get_intent_prompt_modifier": 1.1,
        # Drive surface — physiological pressure should weigh hardest (user spec).
        "get_active_drive": 1.4,
        # Goal surface — also explicitly biased per user spec.
        "get_active_goal": 1.3,
        "get_active_goals": 1.3,
        # Phase / rhythm — soft signal.
        "get_current_phase": 0.7,
    }

    @staticmethod
    def _signal_to_intent_hint(method_name: str, raw: Any) -> str | None:
        """For non-decision methods (drive/goal/phase), map their output to a
        plausible intent so they can vote in the ledger. Returns None if we
        cannot derive one."""
        if raw is None:
            return None
        text = ""
        if isinstance(raw, str):
            text = raw.lower()
        elif isinstance(raw, dict):
            for key in ("text", "name", "label", "description", "summary", "intent"):
                v = raw.get(key)
                if isinstance(v, str) and v:
                    text = v.lower()
                    break
        elif isinstance(raw, (list, tuple)) and raw:
            head = raw[0]
            if isinstance(head, str):
                text = head.lower()
            elif isinstance(head, dict):
                for key in ("text", "name", "label", "description", "summary", "intent"):
                    v = head.get(key)
                    if isinstance(v, str) and v:
                        text = v.lower()
                        break
        if not text:
            return None
        # Drive-name → intent. Includes the standard DriveModelSeed drives
        # ("understand_user", "respond_meaningfully", "build_rapport", etc.).
        if method_name == "get_active_drive":
            if any(w in text for w in ("rest", "sleep", "fatigue", "tired")):
                return "go_home"
            if any(w in text for w in ("hunger", "food", "nourish")):
                return "seek_food"
            if any(w in text for w in ("connect", "social", "lonely", "company",
                                        "rapport", "respond", "understand_user",
                                        "build_rapport")):
                return "seek_social"
            if any(w in text for w in ("avoid", "withdraw", "retreat")):
                return "avoid_entity"
            if any(w in text for w in ("explore", "curious", "wander")):
                return "wander"
            if any(w in text for w in ("reflect", "ponder", "review")):
                return "reflect"
            return None
        # Daily-rhythm phase → intent bias
        if method_name == "get_current_phase":
            if any(w in text for w in ("evening", "night", "wind_down", "wind-down", "rest")):
                return "go_home"
            if any(w in text for w in ("morning", "midday")):
                return "pursue_daily_objective"
            if any(w in text for w in ("afternoon",)):
                return "seek_social"
            return None
        # Goal text → tighter mappings only. Refuse to fall through to a
        # generic intent because that would pollute votes for engines whose
        # output happens to look like a goal but isn't.
        if method_name in ("get_active_goal", "get_active_goals"):
            if any(w in text for w in ("rest", "sleep", "home")):
                return "go_home"
            if any(w in text for w in ("eat", "food", "store")):
                return "seek_food"
            if any(w in text for w in ("meet", "social", "connect", "talk", "neighbor")):
                return "seek_social"
            if any(w in text for w in ("avoid",)):
                return "avoid_entity"
            if any(w in text for w in ("objective", "task", "errand", "complete")):
                return "pursue_daily_objective"
            return None
        # Intent-system surfaces — lean on existing _normalize_intent.
        return None

    def _emotional_pressure_bias(self, decision_ctx: dict[str, Any]) -> list[tuple[str, float, str]]:
        """Inspect the latest emotion-engine output to surface a bias vote."""
        votes: list[tuple[str, float, str]] = []
        # Read from cached emotion outputs; never re-call engines here.
        for key in list(self.last_engine_outputs.keys()):
            if "emotion" not in key and "mental_health" not in key:
                continue
            value = self.last_engine_outputs.get(key)
            if not isinstance(value, dict):
                continue
            anxiety = float(value.get("anxiety") or value.get("fear") or 0.0)
            anger = float(value.get("anger") or value.get("frustration") or 0.0)
            joy = float(value.get("joy") or value.get("contentment") or 0.0)
            sadness = float(value.get("sadness") or value.get("grief") or 0.0)
            if anxiety > 0.55:
                votes.append(("go_home", 0.6 * anxiety, f"high anxiety in {key}"))
            if anger > 0.55:
                votes.append(("avoid_entity", 0.6 * anger, f"high anger in {key}"))
            if joy > 0.55:
                votes.append(("seek_social", 0.55 * joy, f"high joy in {key}"))
            if sadness > 0.55:
                votes.append(("reflect", 0.55 * sadness, f"high sadness in {key}"))
        return votes

    def _personality_consistency_bias(self) -> list[tuple[str, float, str]]:
        """Personality engines lend a small vote toward intents matching their traits.

        Threshold lowered to 0.51 so default-init personalities (which sit at
        0.5) still produce a tiny vote that lets the bias surface in debug,
        and so trait differences as small as 0.05 above default produce
        observable divergence between residents."""
        votes: list[tuple[str, float, str]] = []
        for key in ("personality.self_model_gramps.self_model_gramps",
                    "personality.personality_seed.personality_seed",
                    "personality.personality_beast.personality_engine_beast",
                    "personality.personality_lyra.personality_engine_lyra"):
            value = self.last_engine_outputs.get(key)
            if not isinstance(value, dict):
                continue
            traits = value.get("traits") if isinstance(value.get("traits"), dict) else value
            if not isinstance(traits, dict):
                continue
            extraversion = float(traits.get("extraversion") or traits.get("sociability")
                                  or traits.get("playful") or 0.0)
            conscientiousness = float(traits.get("conscientiousness") or traits.get("focused")
                                       or traits.get("initiative") or 0.0)
            curiosity = float(traits.get("curiosity") or traits.get("curiosity_level")
                               or traits.get("openness") or 0.0)
            if extraversion > 0.51:
                votes.append(("seek_social", 0.45 * extraversion, "extraverted self-model"))
            if conscientiousness > 0.51:
                votes.append(("pursue_daily_objective", 0.45 * conscientiousness, "conscientious self-model"))
            if curiosity > 0.51:
                votes.append(("wander", 0.4 * curiosity, "curious self-model"))
        return votes

    def _world_state_bias(self, decision_ctx: dict[str, Any]) -> list[tuple[str, float, str]]:
        """Convert in-coming snapshot fields (hunger/energy/socialTolerance/mood)
        into explicit votes. Called *bias* and labeled as such in breakdown so
        the source is clear: this is the engine layer reading the body-state
        that the world handed it. Without this, two residents at the same
        default engine state always pick the same intent on first tick.

        Mapped at lower priority than full engine signals so engines remain
        the dominant authority once they have diverged."""
        votes: list[tuple[str, float, str]] = []
        try:
            hunger = float(decision_ctx.get("hunger") or 0.0)
            energy = float(decision_ctx.get("energy") or 0.5)
            social_tol = float(decision_ctx.get("socialTolerance") or 0.5)
            mood = str(decision_ctx.get("mood") or "calm").lower()
        except (TypeError, ValueError):
            return votes
        if hunger > 0.65:
            votes.append(("seek_food", 0.7 * hunger, f"hunger {hunger:.2f}"))
        if energy < 0.28:
            votes.append(("go_home", 0.7 * (1.0 - energy), f"energy low {energy:.2f}"))
        if (1.0 - social_tol) > 0.5:
            votes.append(("seek_social", 0.55 * (1.0 - social_tol), f"social_urge {(1.0 - social_tol):.2f}"))
        if mood in ("annoyed", "angry"):
            votes.append(("avoid_entity", 0.5, f"mood={mood}"))
        if mood == "friendly":
            votes.append(("seek_social", 0.4, f"mood={mood}"))
        if mood == "nervous" and energy < 0.5:
            votes.append(("go_home", 0.45, f"mood={mood} + energy={energy:.2f}"))
        return votes

    def synthesizeDecision(self, decision_ctx: dict[str, Any]) -> dict[str, Any]:
        self.last_input_event = {
            "kind": "decision",
            "at": datetime.now().isoformat(),
            "decisionContext": decision_ctx,
        }
        self.tick(decision_ctx)

        # Vote ledger: intent → (total_weight, list[contributing entries]).
        vote_weight: dict[str, float] = {}
        vote_contributors: dict[str, list[dict[str, Any]]] = {}
        winning_target: str | None = None
        rationales: list[str] = []
        breakdown: list[dict[str, Any]] = []

        def _record(intent: str, weight: float, *, engine_key: str, role: str,
                    method: str, raw_text: str | None, source_bonus: float) -> None:
            nonlocal winning_target
            if not intent or weight <= 0:
                return
            vote_weight[intent] = vote_weight.get(intent, 0.0) + weight
            vote_contributors.setdefault(intent, []).append({
                "engineKey": engine_key,
                "role": role,
                "method": method,
                "weight": round(weight, 4),
                "sourceBonus": source_bonus,
            })
            if raw_text:
                rationales.append(raw_text[:120])
            breakdown.append({
                "engineKey": engine_key,
                "role": role,
                "method": method,
                "intent": intent,
                "weight": round(weight, 4),
                "sourceBonus": source_bonus,
            })

        # ---- 1. Direct engine signals (typed first, then capability-driven) ----
        for key, meta in list(self.active_engines.items()):
            if key in self.disabled_engines:
                continue
            role = str(meta.get("runtimeRole") or "UTILITY")
            class_name = str(meta.get("class"))
            role_priority = DECISION_PRIORITY.get(role, 1)

            # Typed adapter path: if the engine has one, the adapter has
            # already populated last_engine_outputs[key] during the tick.
            # We extract a vote from that cached output using the
            # class-aware intent method (so DriveModelSeed always uses
            # the drive mapper, IntentSystem always uses the intent
            # mapper, etc.). This avoids the cross-mapper pollution
            # that the smoke test caught.
            adapter_fn = get_typed_adapter(class_name)
            cached_out = self.last_engine_outputs.get(key)
            if adapter_fn is not None and cached_out is not None:
                method_hint = self._TYPED_INTENT_METHOD.get(class_name)
                if method_hint:
                    intent_hint = self._signal_to_intent_hint(method_hint, cached_out)
                    if intent_hint is not None:
                        bonus = self._DECISION_SOURCE_BONUS.get(method_hint, 1.0)
                        weight = role_priority * bonus
                        _record(intent_hint, weight, engine_key=key, role=role,
                                method=f"typed:{method_hint}", raw_text=str(cached_out)[:120],
                                source_bonus=bonus)
                # Also try the standard intent normalizer (catches dicts
                # already shaped like {"intent": "..."}).
                norm_intent, norm_conf, norm_target, norm_rat = self._normalize_intent(cached_out)
                if norm_intent is not None:
                    bonus = 1.0
                    weight = role_priority * bonus * max(0.4, norm_conf)
                    _record(norm_intent, weight, engine_key=key, role=role,
                            method="typed:normalized", raw_text=norm_rat, source_bonus=bonus)
                    if norm_target and not winning_target:
                        winning_target = norm_target
                continue

            # Generic adapter path
            adp = self.generic_adapters.get(key)
            if adp is None:
                continue

            try:
                signals = adp.gather_decision_signals(decision_ctx)
            except Exception:
                signals = []
            for method_name, raw in signals:
                bonus = self._DECISION_SOURCE_BONUS.get(method_name, 1.0)

                # Try direct intent normalization first.
                norm_intent, norm_conf, norm_target, norm_rat = self._normalize_intent(raw)
                if norm_intent is not None:
                    weight = role_priority * bonus * max(0.4, norm_conf)
                    _record(norm_intent, weight, engine_key=key, role=role,
                            method=method_name, raw_text=norm_rat, source_bonus=bonus)
                    if norm_target and not winning_target:
                        winning_target = norm_target
                    continue

                # Otherwise map drive/phase/goal/intent text to an intent.
                hinted = self._signal_to_intent_hint(method_name, raw)
                if hinted is not None:
                    weight = role_priority * bonus
                    _record(hinted, weight, engine_key=key, role=role,
                            method=method_name, raw_text=str(raw)[:120],
                            source_bonus=bonus)

        # ---- 2. Inferred biases from cached emotion + personality state ----
        for intent, w, why in self._emotional_pressure_bias(decision_ctx):
            _record(intent, w * DECISION_PRIORITY["EMOTION"] * 0.6,
                    engine_key="bias.emotional_pressure", role="EMOTION",
                    method="inferred", raw_text=why, source_bonus=0.6)

        for intent, w, why in self._personality_consistency_bias():
            _record(intent, w * DECISION_PRIORITY["PERSONALITY"] * 0.55,
                    engine_key="bias.personality_consistency", role="PERSONALITY",
                    method="inferred", raw_text=why, source_bonus=0.55)

        # ---- 3. World-state bias (snapshot fields → explicit votes) -----
        # This is the engine layer reading the body-state the world handed it.
        # Without it, freshly-initialized residents converge to the same
        # default-engine intent regardless of their snapshot. Lower priority
        # than role-driven engine signals, so engines override once they
        # have meaningfully diverged.
        for intent, w, why in self._world_state_bias(decision_ctx):
            _record(intent, w * 3.0,
                    engine_key="bias.world_state_pressure", role="CONTROL",
                    method="snapshot", raw_text=why, source_bonus=1.0)

        self.last_decision_breakdown = breakdown[:60]

        if not vote_weight:
            self.last_decision_source = "fallback"
            out = {
                "intent": "idle",
                "confidence": 0.0,
                "targetEntityId": None,
                "rationale": "No full-brain consensus available",
                "emotionSummary": self.last_emotion_summary or f"{self.display_name} steady",
                "source": "fallback",
                "contributors": [],
                "contributingEngines": [],
            }
            self.last_decision_output = out
            return out

        # Pick the top intent by total weight. Ties broken by lexicographic
        # intent name so behavior is deterministic for tests.
        intent = max(sorted(vote_weight.items()), key=lambda kv: kv[1])[0]
        total = sum(vote_weight.values())
        share = vote_weight[intent] / total if total > 0 else 0.0
        # Confidence: scaled by share of the total weight, with a floor of 0.25
        # whenever there was at least one contributor (lets the world layer
        # follow), and a soft cap of 0.98 (we are never certain).
        confidence = min(0.98, max(0.25, share * 0.85 + 0.15))

        # Track contributors used by the world side and HUD.
        contributors_full = vote_contributors[intent]
        contributors_keys = sorted({c["engineKey"] for c in contributors_full})

        # Note: counters useful for "are different residents diverging?" probes.
        for key in contributors_keys:
            self.contribution_counters[key] = self.contribution_counters.get(key, 0) + 1

        self.last_decision_source = "full_brain_synthesis"
        out = {
            "intent": intent,
            "confidence": confidence,
            "targetEntityId": winning_target,
            "rationale": "; ".join(dict.fromkeys(rationales[:3])) if rationales else f"{self.display_name} full-brain synthesis selected {intent}",
            "emotionSummary": self.last_emotion_summary or f"{self.display_name} steady",
            "source": "full_brain_synthesis",
            "contributors": contributors_keys,
            "contributingEngines": contributors_full[:12],
        }
        self.last_decision_output = out
        return out

    def _build_engine_brain_context(self, ctx: dict[str, Any]) -> dict[str, Any]:
        """Pull the 7 named in-world signals required by the conversation prompt.

        Each field is sourced from a specific real engine when available. We never
        leak engine class names or method names; the strings are short, in-world,
        and prompt-safe.
        """

        # 1. Emotional state -> EmotionKernelGramps.get_state() / EmotionModelSeed.get_state()
        emotional_state = "steady"
        for key, eng in self.engines.items():
            if key in self.disabled_engines:
                continue
            if "emotion_kernel" in key or "emotion_model_seed" in key or "connor_state_beast" in key:
                state = None
                try:
                    state = eng.get_state()
                except Exception:
                    state = None
                if isinstance(state, dict):
                    top = sorted(
                        [(k, float(v)) for k, v in state.items() if isinstance(v, (int, float))],
                        key=lambda kv: kv[1],
                        reverse=True,
                    )[:3]
                    if top:
                        emotional_state = ", ".join(f"{k} {v:.2f}" for k, v in top)
                        break

        # 2. Relationship reasoning -> RelationalMemorySystem.get_reasoning_summary
        relationship_reasoning = "no specific relationship signal right now"
        rel_eng = self.engines.get("memory.relational_memory_system.relational_memory_system")
        if rel_eng is not None:
            try:
                summary = rel_eng.get_reasoning_summary(3)
            except Exception:
                summary = None
            if isinstance(summary, str) and summary.strip():
                relationship_reasoning = summary.strip().split("\n")[0][:240]

        # 3. Current intent -> IntentSystem.get_intent_prompt_modifier / get_top_intent
        current_intent = "no urgent interaction intent"
        intent_eng = self.engines.get("utility.intent_system.intent_system")
        if intent_eng is not None:
            try:
                modifier = intent_eng.get_intent_prompt_modifier()
            except Exception:
                modifier = None
            if isinstance(modifier, str) and modifier.strip():
                current_intent = modifier.strip()[:200]
            else:
                try:
                    top_intent = intent_eng.get_top_intent()
                except Exception:
                    top_intent = None
                if isinstance(top_intent, dict):
                    text = str(top_intent.get("text") or "").strip()
                    if text:
                        current_intent = text[:200]

        # 4. Active goals -> GoalEngineGramps.get_active_goals
        active_goals = "no active goals are pulling them"
        goal_eng = self.engines.get("cognitive.goal_engine_gramps.goal_engine_gramps")
        if goal_eng is not None:
            try:
                goals = goal_eng.get_active_goals()
            except Exception:
                goals = None
            if isinstance(goals, list) and goals:
                bits: list[str] = []
                for g in goals[:3]:
                    desc = None
                    if isinstance(g, dict):
                        desc = g.get("description") or g.get("summary") or g.get("name")
                    elif hasattr(g, "description"):
                        desc = getattr(g, "description")
                    if desc:
                        bits.append(str(desc)[:120])
                if bits:
                    active_goals = "; ".join(bits)

        # 5. Drive state -> DriveModelSeed.get_active_drive / .get_state
        drive_state = "drives balanced"
        drive_eng = self.engines.get("behavior.drive_model_seed.drive_model_seed")
        if drive_eng is not None:
            try:
                active_drive = drive_eng.get_active_drive()
            except Exception:
                active_drive = None
            if isinstance(active_drive, str) and active_drive.strip():
                drive_state = active_drive.replace("_", " ").strip()
            else:
                try:
                    state = drive_eng.get_state()
                except Exception:
                    state = None
                if isinstance(state, dict):
                    top = sorted(
                        [(k, float(v)) for k, v in state.items() if isinstance(v, (int, float))],
                        key=lambda kv: kv[1],
                        reverse=True,
                    )[:2]
                    if top:
                        drive_state = ", ".join(f"{k.replace('_', ' ')} {v:.2f}" for k, v in top)

        # 6. Self narrative -> SelfModelGramps.get_traits / append_to_narrative state
        self_narrative = f"{self.display_name} carries on with their usual sense of self"
        sm_eng = self.engines.get("personality.self_model_gramps.self_model_gramps")
        if sm_eng is not None:
            traits: Any = None
            try:
                traits = sm_eng.get_traits()
            except Exception:
                traits = None
            if isinstance(traits, dict) and traits:
                top = sorted(
                    [(k, float(v)) for k, v in traits.items() if isinstance(v, (int, float))],
                    key=lambda kv: kv[1],
                    reverse=True,
                )[:3]
                if top:
                    self_narrative = (
                        f"{self.display_name} sees themself as "
                        + ", ".join(f"{k} {v:.2f}" for k, v in top)
                    )

        # 7. Recent episodic memory -> EpisodeMemoryGramps recent episodes
        recent_episodes: list[str] = []
        ep_eng = self.engines.get("memory.episode_memory_gramps.episode_memory_gramps")
        if ep_eng is not None:
            episodes_raw: Any = None
            try:
                if hasattr(ep_eng, "get_recent_episodes"):
                    episodes_raw = ep_eng.get_recent_episodes(3)
                elif hasattr(ep_eng, "retrieve"):
                    episodes_raw = ep_eng.retrieve("recent", 3)
            except Exception:
                episodes_raw = None
            if isinstance(episodes_raw, list):
                for ep in episodes_raw[:3]:
                    if isinstance(ep, dict):
                        text = ep.get("summary") or ep.get("theme") or ep.get("content")
                    else:
                        text = getattr(ep, "summary", None) or getattr(ep, "theme", None)
                    if text:
                        recent_episodes.append(str(text)[:160])
        if not recent_episodes:
            for ev in reversed(self.events[-3:]):
                summary = str(ev.get("summary") or "").strip()
                if summary:
                    recent_episodes.append(summary[:160])
        if not recent_episodes:
            recent_episodes = ["nothing notable in the past few exchanges"]

        return {
            "emotionalState": emotional_state,
            "relationshipReasoning": relationship_reasoning,
            "currentIntent": current_intent,
            "activeGoals": active_goals,
            "driveState": drive_state,
            "selfNarrative": self_narrative,
            "recentEpisodes": recent_episodes,
        }

    # Engines whose state is the SPINE of the conversation prompt — they fill
    # the 7 core fields directly. They should never appear in extendedContext
    # to avoid double-counting.
    _CORE_CONTEXT_KEYS: ClassVar[tuple[str, ...]] = (
        "memory.relational_memory_system.relational_memory_system",
        "utility.intent_system.intent_system",
        "cognitive.goal_engine_gramps.goal_engine_gramps",
        "behavior.drive_model_seed.drive_model_seed",
        "personality.self_model_gramps.self_model_gramps",
        "memory.episode_memory_gramps.episode_memory_gramps",
        "emotion.emotion_kernel_gramps.emotion_kernel_gramps",
        "emotion.emotion_model_seed.emotion_model_seed",
        "emotion.connor_state_beast.connor_state_beast",
    )

    def _build_extended_context(self, ctx: dict[str, Any], limit: int = 8) -> list[dict[str, Any]]:
        """Rank cached engine outputs by context-relevance and return up to
        `limit` short structured summaries.

        This is INTENTIONALLY parallel to engineBrainContext (the 7 core fields)
        rather than appended to it. The LLM prompt's spine is the 7 fields; this
        list is for the HUD and for richer prompt experiments.
        """
        # Ranking order: by role-based context priority, ties broken by recency
        # in last_engine_outputs (which roughly tracks last-tick freshness),
        # excluding the core engines and engines whose output is None.
        signals: list[dict[str, Any]] = []
        for key, value in self.last_engine_outputs.items():
            if value is None:
                continue
            if key in self._CORE_CONTEXT_KEYS:
                continue
            meta = self.active_engines.get(key)
            if meta is None:
                continue
            role = str(meta.get("runtimeRole") or "UTILITY")
            if role in ("PASSIVE_MONITOR", "DISABLED_WITH_REASON"):
                continue
            summary = summarize_engine_output(value, max_chars=120)
            if not summary or summary == "none":
                continue
            score = relevance_score(role, base=10)
            # Lightly boost engines that have a state method available — those
            # are the ones designed to be summarized.
            cap = self.capabilities.get(key)
            if cap is not None and cap.state_methods:
                score += 1
            signals.append({
                "engineKey": key,
                "className": str(meta.get("class") or ""),
                "role": role,
                "summary": summary,
                "relevance": score,
            })
        # Cap per-role to avoid one role flooding (e.g. cognitive has 45 engines).
        per_role_cap = {"COGNITION": 4, "MEMORY": 3, "PERSONALITY": 3, "EMOTION": 3,
                        "EXPRESSION": 2, "CONTROL": 2, "UTILITY": 2}
        seen_per_role: dict[str, int] = {}
        signals.sort(key=lambda s: (-s["relevance"], s["engineKey"]))
        selected: list[dict[str, Any]] = []
        for s in signals:
            cap = per_role_cap.get(s["role"], 1)
            if seen_per_role.get(s["role"], 0) >= cap:
                continue
            seen_per_role[s["role"]] = seen_per_role.get(s["role"], 0) + 1
            selected.append(s)
            if len(selected) >= limit:
                break
        return selected

    def synthesizeConversationContext(self, ctx: dict[str, Any]) -> dict[str, Any]:
        self.last_input_event = {
            "kind": "conversation_context",
            "at": datetime.now().isoformat(),
            "conversationContext": ctx,
        }
        self.tick(ctx)

        engine_brain_context = self._build_engine_brain_context(ctx)
        extended = self._build_extended_context(ctx)
        # Track which engines fed the conversation context for debug visibility.
        self.last_context_sources = [
            {"engineKey": k, "field": f, "role": "CORE"} for k, f in (
                ("memory.relational_memory_system.relational_memory_system", "relationshipReasoning"),
                ("utility.intent_system.intent_system", "currentIntent"),
                ("cognitive.goal_engine_gramps.goal_engine_gramps", "activeGoals"),
                ("behavior.drive_model_seed.drive_model_seed", "driveState"),
                ("personality.self_model_gramps.self_model_gramps", "selfNarrative"),
                ("memory.episode_memory_gramps.episode_memory_gramps", "recentEpisodes"),
                ("emotion.emotion_kernel_gramps.emotion_kernel_gramps", "emotionalState"),
            ) if k in self.active_engines
        ] + [
            {"engineKey": s["engineKey"], "field": "extendedContext", "role": s["role"]}
            for s in extended
        ]

        emotion = engine_brain_context["emotionalState"]
        personality_line = self.last_personality_summary or f"{self.display_name} keeps their usual personality tone"
        memory = self.last_memory_summary or "no standout memory surfaced right now"
        relationship = engine_brain_context["relationshipReasoning"]
        goals = engine_brain_context["activeGoals"]
        drives = engine_brain_context["driveState"]
        self_narrative = engine_brain_context["selfNarrative"]
        intent = engine_brain_context["currentIntent"]
        episodes = engine_brain_context["recentEpisodes"]

        lines = [
            f"{self.display_name} emotional read: {emotion}.",
            f"Personality and self-model: {personality_line}; {self_narrative}.",
            f"Relationship memory: {relationship}.",
            f"Active goals: {goals}.",
            f"Drive state: {drives}.",
            f"Current interaction intent: {intent}.",
            f"Recent memory anchor: {memory}; episodes: " + " | ".join(episodes) + ".",
        ]
        # Always attach extendedContext to the structured engineBrainContext so
        # downstream consumers can opt in. The 7 core fields stay unchanged.
        engine_brain_context_out = dict(engine_brain_context)
        engine_brain_context_out["extendedContext"] = extended
        return {
            "contextLines": lines,
            "moodLine": lines[0],
            "intentionLine": lines[5],
            "memoryLine": lines[-1],
            "emotionSummary": self.last_emotion_summary or emotion,
            "engineBrainContext": engine_brain_context_out,
            "extendedContext": extended,
            "contextSources": self.last_context_sources,
        }

    def recordEvent(self, event: dict[str, Any]) -> None:
        self.last_input_event = {
            "kind": "event",
            "at": datetime.now().isoformat(),
            "event": event,
        }
        self.events.append(event)
        if len(self.events) > 400:
            self.events = self.events[-400:]
        self.state["last_event"] = event
        summary = str(event.get("summary", "event")).strip()
        self.last_memory_summary = summary or self.last_memory_summary

        # Phase 5: tag the event so callers can see which channels fired.
        self.last_event_tags = classify_event_tags(event)

        ctx = {
            "entityId": self.entity_id,
            "displayName": self.display_name,
            "eventTags": self.last_event_tags,
        }
        for key, meta in list(self.active_engines.items()):
            if key in self.disabled_engines:
                continue
            class_name = str(meta.get("class"))
            adapter = get_typed_adapter(class_name)
            if adapter is not None:
                try:
                    out = adapter(self.engines.get(key), "event", ctx, event)
                except Exception as e:
                    self._disable(key, f"typed adapter event failed: {e}")
                    continue
                if out is not None:
                    self.last_engine_outputs[key] = out
                continue

            # Generic adapter path: capability-driven event absorption. The
            # GenericEngineAdapter swallows per-call exceptions; only catastrophic
            # failures get the engine disabled.
            adp = self.generic_adapters.get(key)
            cap = self.capabilities.get(key)
            if adp is None or cap is None or not cap.event_methods:
                continue
            try:
                out = adp.absorb_event(event, ctx)
            except Exception as e:
                self._disable(key, f"generic adapter event failed: {e}")
                continue
            if out is not None:
                self.last_engine_outputs[key] = out

    # Backward-compatible API used by existing FastAPI routes.
    def update(self, tick_ctx: dict[str, Any]) -> dict[str, Any]:
        return self.tick(tick_ctx)

    def suggest_decision(self, decision_ctx: dict[str, Any]) -> dict[str, Any]:
        return self.synthesizeDecision(decision_ctx)

    def conversation_context(self, ctx: dict[str, Any]) -> dict[str, Any]:
        return self.synthesizeConversationContext(ctx)

    def record_event(self, event: dict[str, Any]) -> None:
        self.recordEvent(event)

    def child_seed_defaults(
        self,
        other: "EngineBundle",
        child_seed: dict[str, Any],
        parent_a_summary: dict[str, Any] | None,
        parent_b_summary: dict[str, Any] | None,
    ) -> dict[str, Any]:
        a_traits = list((parent_a_summary or {}).get("traits", []))
        b_traits = list((parent_b_summary or {}).get("traits", []))
        suggestions = sorted(set([*(str(t) for t in a_traits), *(str(t) for t in b_traits), "adaptable"]))
        return {
            "childBrainSummary": f"{child_seed.get('displayName', 'Child')} initialized from {self.display_name} and {other.display_name}",
            "inheritedTraitSuggestions": suggestions[:8],
            "defaults": {
                "mood": child_seed.get("mood", "calm"),
                "stability": 0.58,
                "socialDrive": 0.56,
            },
        }

    def _active_by_role(self) -> dict[str, list[str]]:
        by_role: dict[str, list[str]] = {}
        for key, meta in self.active_engines.items():
            role = str(meta.get("runtimeRole", "UTILITY"))
            by_role.setdefault(role, []).append(key)
        for role in by_role:
            by_role[role].sort()
        return by_role

    def _silent_engines(self) -> list[str]:
        """Engines that are active but have produced no captured output. The
        list is informational — silence does not imply broken."""
        return sorted(
            key for key in self.active_engines
            if key not in self.last_engine_outputs and key not in self.disabled_engines
        )

    def _contributing_engine_keys(self) -> list[str]:
        """Engines that have actually produced output that landed somewhere."""
        return sorted(
            key for key in self.last_engine_outputs.keys()
            if self.last_engine_outputs.get(key) is not None
        )

    def _capabilities_summary(self) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for key, cap in self.capabilities.items():
            out[key] = cap.to_dict()
        return out

    def debug_snapshot(self) -> dict[str, Any]:
        return {
            "entityId": self.entity_id,
            "displayName": self.display_name,
            "totalClassesDiscovered": self.total_classes_discovered,
            "totalEnginesDiscovered": self.total_engines_discovered,
            "totalEnginesInstantiated": self.total_engines_instantiated,
            "totalExcludedDataContainers": self.total_excluded_data_containers,
            "totalCompositesWired": self.total_composites_wired,
            "activeEnginesByRole": self._active_by_role(),
            "activeEngines": self.active_engines,
            "disabledEngines": self.disabled_engines,
            "engineContracts": self.engine_contracts,
            "inventory": self.inventory,
            "excludedClasses": self.excluded_classes,
            "typedAdaptersAvailable": sorted(TYPED_ADAPTERS.keys()),
            "lastOutputByEngine": self.last_engine_outputs,
            "lastInputEvent": self.last_input_event,
            "lastDecisionOutput": self.last_decision_output,
            "lastDecisionSource": self.last_decision_source,
            "lastEmotionSummary": self.last_emotion_summary,
            "lastPersonalitySummary": self.last_personality_summary,
            "lastMemorySummary": self.last_memory_summary,
            # Phase 7: visibility upgrades
            "capabilities": self._capabilities_summary(),
            "contributingEngines": self._contributing_engine_keys(),
            "silentEngines": self._silent_engines(),
            "decisionBreakdown": self.last_decision_breakdown,
            "contextSources": self.last_context_sources,
            "lastEventTags": self.last_event_tags,
            "contributionCounters": dict(sorted(
                self.contribution_counters.items(), key=lambda kv: -kv[1]
            )[:30]),
        }

