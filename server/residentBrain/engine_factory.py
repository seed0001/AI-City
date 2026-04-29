from __future__ import annotations

import dataclasses
import enum
import importlib
import inspect
import os
import pkgutil
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def _candidate_engines_roots() -> list[Path]:
    here = Path(__file__).resolve()
    env = os.getenv("ENGINES_ROOT")
    candidates: list[Path | None] = [
        Path(env) if env else None,
        Path("C:/Engines"),
        Path.cwd() / "Engines",
    ]
    for p in here.parents[:8]:
        candidates.append(p / "Engines")
    for p in Path.cwd().resolve().parents[:8]:
        candidates.append(p / "Engines")
    out: list[Path] = []
    for c in candidates:
        if c and c.exists() and c.is_dir() and (c / "__init__.py").exists():
            if c not in out:
                out.append(c)
    return out


def ensure_engines_on_path() -> list[str]:
    roots = _candidate_engines_roots()
    for root in roots:
        # Needed for `import Engines.*`
        parent = str(root.parent)
        if parent not in sys.path:
            sys.path.insert(0, parent)
        # Also keep direct root for optional flat imports
        direct = str(root)
        if direct not in sys.path:
            sys.path.insert(0, direct)
    return [str(r) for r in roots]


class NullEngine:
    def __init__(self, name: str, reason: str = "unavailable") -> None:
        self.name = name
        self.reason = reason

    def summary(self) -> str:
        return f"{self.name} unavailable ({self.reason}); using fallback"


@dataclass
class EngineBuildResult:
    name: str
    module_name: str
    import_path: str | None
    active: bool
    instance: Any
    constructor_signature: str | None
    error: str | None = None


@dataclass
class DiscoveredEngineClass:
    package: str
    module_name: str
    class_name: str
    constructor_signature: str | None
    is_data_container: bool = False
    is_composite: bool = False

    @property
    def key(self) -> str:
        module_tail = self.module_name.split(".")[-1]
        class_snake = re.sub(r"(?<!^)(?=[A-Z])", "_", self.class_name).lower()
        return f"{self.package}.{module_tail}.{class_snake}"


def _import_candidates(module_name: str) -> list[str]:
    return [f"Engines.{module_name}", module_name]


def build_engine(module_name: str, class_name: str, **kwargs: Any) -> EngineBuildResult:
    errors: list[str] = []
    ctor_sig: str | None = None
    for import_name in _import_candidates(module_name):
        try:
            mod = importlib.import_module(import_name)
        except Exception as e:
            errors.append(f"import {import_name}: {e}")
            continue
        cls = getattr(mod, class_name, None)
        if cls is None:
            errors.append(f"class {class_name} missing in {import_name}")
            continue
        try:
            ctor_sig = str(inspect.signature(cls.__init__))
        except Exception:
            ctor_sig = None
        try:
            instance = cls(**kwargs)
            return EngineBuildResult(
                name=class_name,
                module_name=module_name,
                import_path=import_name,
                active=True,
                instance=instance,
                constructor_signature=ctor_sig,
                error=None,
            )
        except TypeError:
            try:
                instance = cls()
                return EngineBuildResult(
                    name=class_name,
                    module_name=module_name,
                    import_path=import_name,
                    active=True,
                    instance=instance,
                    constructor_signature=ctor_sig,
                    error=None,
                )
            except Exception as e:
                errors.append(f"construct {import_name}.{class_name}: {e}")
        except Exception as e:
            errors.append(f"construct {import_name}.{class_name}: {e}")

    reason = " | ".join(errors[-3:]) if errors else "unknown"
    null = NullEngine(class_name, reason=reason)
    return EngineBuildResult(
        name=class_name,
        module_name=module_name,
        import_path=None,
        active=False,
        instance=null,
        constructor_signature=None,
        error=reason,
    )


def method_signature(obj: Any, method_name: str) -> str | None:
    try:
        fn = getattr(obj, method_name, None)
        if fn is None:
            return None
        return str(inspect.signature(fn))
    except Exception:
        return None


# Classes that live inside engine packages but represent data records, not engines.
_HARD_DATA_CONTAINERS = {
    "Memory",
    "Episode",
    "UnifiedEpisode",
    "ConnorSnapshot",
    "QuantumState",
    "QuantumThought",
    "ThoughtPattern",
    "NeuralCluster",
    "NeuralNode",
    "EmotionalState",
    "KnowledgeEntry",
    "Goal",
    "RegulatorSettings",
    "Contact",
}

_COMPOSITE_CLASSES = {
    ("cognitive.advanced_pairing_engine", "RecompositionEngine"),
    ("cognitive.advanced_pairing_engine", "ReasoningEngine"),
    ("cognitive.advanced_pairing_engine", "KnowledgeFusionEngine"),
    ("cognitive.advanced_pairing_engine", "ReflectionEngine"),
}


def _is_data_container(cls: type, class_name: str) -> bool:
    if class_name in _HARD_DATA_CONTAINERS:
        return True
    if dataclasses.is_dataclass(cls):
        return True
    try:
        if issubclass(cls, enum.Enum):
            return True
    except TypeError:
        pass
    return False


def discover_engine_inventory(
    packages: tuple[str, ...] = (
        "emotion",
        "personality",
        "memory",
        "cognitive",
        "behavior",
        "utility",
    ),
) -> list[DiscoveredEngineClass]:
    ensure_engines_on_path()
    discovered: list[DiscoveredEngineClass] = []
    seen: set[tuple[str, str, str]] = set()

    for package in packages:
        pkg_mod_name = f"Engines.{package}"
        try:
            pkg_mod = importlib.import_module(pkg_mod_name)
        except Exception:
            continue

        module_names = [pkg_mod.__name__]
        if hasattr(pkg_mod, "__path__"):
            module_names.extend(
                m.name for m in pkgutil.walk_packages(pkg_mod.__path__, prefix=f"{pkg_mod.__name__}.")
            )

        for mod_name in module_names:
            try:
                mod = importlib.import_module(mod_name)
            except Exception:
                continue
            for class_name, cls in inspect.getmembers(mod, inspect.isclass):
                if class_name.startswith("_"):
                    continue
                if getattr(cls, "__module__", "") != mod.__name__:
                    continue
                sig: str | None
                try:
                    sig = str(inspect.signature(cls.__init__))
                except Exception:
                    sig = None
                triple = (package, mod_name, class_name)
                if triple in seen:
                    continue
                seen.add(triple)
                module_rel = mod_name.removeprefix("Engines.")
                discovered.append(
                    DiscoveredEngineClass(
                        package=package,
                        module_name=mod_name,
                        class_name=class_name,
                        constructor_signature=sig,
                        is_data_container=_is_data_container(cls, class_name),
                        is_composite=(module_rel, class_name) in _COMPOSITE_CLASSES,
                    )
                )
    discovered.sort(key=lambda x: (x.package, x.module_name, x.class_name))
    return discovered

