"""Dev inspection helper: prints public method signatures for selected engine classes.

Run from project root:  python server/residentBrain/_inspect_methods.py
This file is dev-only; not imported by the runtime.
"""
from __future__ import annotations

import importlib
import inspect
import sys
from pathlib import Path


def main() -> None:
    here = Path(__file__).resolve()
    root = here.parents[2]
    sys.path.insert(0, str(root))
    sys.path.insert(0, str(root / "Engines"))

    targets = [
        ("emotion.emotion_kernel_gramps", "EmotionKernelGramps"),
        ("emotion.connor_state_beast", "ConnorStateBeast"),
        ("emotion.mental_health_beast", "MentalHealthEngineBeast"),
        ("emotion.emotional_feedback_beast", "EmotionalFeedbackBeast"),
        ("memory.memory_manager_lyra", "MemoryManagerLyra"),
        ("personality.self_model_gramps", "SelfModelGramps"),
        ("utility.word_store_seed", "WordStoreSeed"),
        ("cognitive.reflection_engine_gramps", "ReflectionEngineGramps"),
        ("cognitive.advanced_pairing_engine", "WordLibrary"),
        ("cognitive.advanced_pairing_engine", "PatternLibrary"),
        ("cognitive.advanced_pairing_engine", "FactDatabase"),
        ("cognitive.advanced_pairing_engine", "ConceptDictionary"),
        ("cognitive.advanced_pairing_engine", "SentenceParser"),
        ("cognitive.advanced_pairing_engine", "RecompositionEngine"),
        ("cognitive.advanced_pairing_engine", "KnowledgeFusionEngine"),
        ("cognitive.advanced_pairing_engine", "ReasoningEngine"),
        ("cognitive.advanced_pairing_engine", "ReflectionEngine"),
    ]

    for mod_name, class_name in targets:
        try:
            mod = importlib.import_module(f"Engines.{mod_name}")
            cls = getattr(mod, class_name)
        except Exception as e:
            print(f"IMPORT_FAIL {mod_name} {class_name}: {e}")
            continue
        print(f"== {class_name} @ {mod_name}")
        for name, fn in inspect.getmembers(cls, predicate=inspect.isfunction):
            if name.startswith("_"):
                continue
            try:
                sig = str(inspect.signature(fn))
            except Exception:
                sig = "(?)"
            print(f"   {name}{sig}")


if __name__ == "__main__":
    main()
