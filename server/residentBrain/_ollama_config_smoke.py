"""Smoke test: ollama_config.resolve_ollama_model().

Two scenarios:
  1. Live: query Ollama on this machine via /api/tags. We don't assert on
     a specific model name (that depends on what the user has installed)
     but we print the result so the caller can eyeball it.
  2. Offline / synthetic: stub _fetch_available_models with various
     installed-model lists and assert the picker matches the documented
     preference order.

Also covers the env-var override and the `mistral` fallback when nothing
is reachable.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ollama_config  # noqa: E402


def _scenario_env_override() -> bool:
    os.environ["RESIDENT_BRAIN_OLLAMA_MODEL"] = "explicit-test-model"
    ollama_config.reset_cache()
    got = ollama_config.resolve_ollama_model()
    del os.environ["RESIDENT_BRAIN_OLLAMA_MODEL"]
    ollama_config.reset_cache()
    print(f"env-override -> {got!r}")
    return got == "explicit-test-model"


def _scenario_pick_preferred() -> bool:
    cases: list[tuple[list[str], str]] = [
        # llama3.2:latest ranks ahead of dolphin-mixtral and llama2-uncensored
        (
            ["llama2-uncensored:latest", "dolphin-mixtral:latest", "llama3.2:latest"],
            "llama3.2:latest",
        ),
        # When 3.2 isn't installed but 3.1 is, prefer 3.1
        (["llama3.1:latest", "dolphin-mixtral:latest"], "llama3.1:latest"),
        # When only mistral is around, that's still preferred over nothing
        (["mistral:latest"], "mistral:latest"),
        # When NOTHING in PREFERRED_MODELS is installed, the picker returns
        # None (caller falls through to "first available").
        (["weird-model:1b"], None),
    ]
    all_ok = True
    for installed, expected in cases:
        got = ollama_config._pick_preferred(installed)
        ok = got == expected
        if not ok:
            all_ok = False
        prefix = "PASS" if ok else "FAIL"
        print(f"{prefix}: pick_preferred({installed}) = {got!r} (expected {expected!r})")
    return all_ok


def _scenario_offline_fallback(monkeypatch_fetch: object) -> bool:
    # Force the "ollama unreachable" path: stub _fetch_available_models to
    # always return []. The resolver should fall back to ENGINE_DEFAULT_MODEL.
    original = ollama_config._fetch_available_models
    ollama_config._fetch_available_models = lambda *args, **kwargs: []  # type: ignore[assignment]
    try:
        ollama_config.reset_cache()
        got = ollama_config.resolve_ollama_model()
    finally:
        ollama_config._fetch_available_models = original  # type: ignore[assignment]
        ollama_config.reset_cache()
    print(f"offline-fallback -> {got!r}")
    return got == ollama_config.ENGINE_DEFAULT_MODEL


def _scenario_first_available_when_no_preferred() -> bool:
    # When nothing in PREFERRED_MODELS is installed but Ollama IS reachable
    # and reports something, return whatever it reports first.
    original = ollama_config._fetch_available_models
    ollama_config._fetch_available_models = lambda *args, **kwargs: [  # type: ignore[assignment]
        "weird-coder:33b",
        "tiny-model:1b",
    ]
    try:
        ollama_config.reset_cache()
        got = ollama_config.resolve_ollama_model()
    finally:
        ollama_config._fetch_available_models = original  # type: ignore[assignment]
        ollama_config.reset_cache()
    print(f"first-available -> {got!r}")
    return got == "weird-coder:33b"


def _scenario_live() -> None:
    ollama_config.reset_cache()
    got = ollama_config.resolve_ollama_model()
    print(f"LIVE: resolved against {ollama_config.OLLAMA_URL} -> {got!r}")
    print(f"      describe_resolution: {ollama_config.describe_resolution()}")


def main() -> int:
    print("=" * 60)
    print("Synthetic scenarios (no network)")
    print("=" * 60)
    results = [
        ("env_override", _scenario_env_override()),
        ("pick_preferred", _scenario_pick_preferred()),
        ("offline_fallback", _scenario_offline_fallback(None)),
        ("first_available_when_no_preferred", _scenario_first_available_when_no_preferred()),
    ]

    print()
    print("=" * 60)
    print("Live scenario (queries local Ollama if reachable)")
    print("=" * 60)
    _scenario_live()
    print()

    failed = [n for n, ok in results if not ok]
    if failed:
        print(f"FAIL: {failed}")
        return 1
    print(f"PASS: {len(results)} synthetic scenarios passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
