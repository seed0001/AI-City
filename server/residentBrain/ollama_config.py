"""Resolve which Ollama model the cognition engines should use.

Several engines in the cognition library (notably the OllamaClientConnor
utility) hard-code `model = 'mistral'` as their constructor default. When the
local Ollama install does not ship that model, every brain operation logs:

    [Ollama] Warning: Model 'mistral' not found. Available: [...]

and the engine silently falls back to a stub. The fix is to override the
constructor default at instantiation time. This module decides what to pass.

Resolution order (first match wins):
  1. The `RESIDENT_BRAIN_OLLAMA_MODEL` environment variable. The user can
     set this to pin a specific model regardless of what Ollama reports.
  2. A query against Ollama's `/api/tags` endpoint, intersected with a
     preference list that orders models by "best fit for cognition".
  3. The first model Ollama reports as available, if any.
  4. The literal string `'mistral'`. This preserves the engine's own
     default and means "do not change the constructor kwarg" — useful when
     Ollama is genuinely offline at brain-service startup.

The result is cached at module level: we call Ollama at most once per
process and reuse the answer for every engine. Callers that want to force a
re-query (e.g. tests, or after the user installed a new model) can call
`reset_cache()`.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Iterable

# The Ollama URL the cognition engines target. Engines that take a `url`
# constructor parameter receive this. We expose it so other code (e.g.
# brain_bundle's _constructor_kwargs_for) can pass a consistent value.
DEFAULT_OLLAMA_URL = "http://localhost:11434"
OLLAMA_URL = os.environ.get("RESIDENT_BRAIN_OLLAMA_URL", DEFAULT_OLLAMA_URL).rstrip("/")

# Tag string we treat as "engine left at its hard-coded default — leave it
# alone". The OllamaClientConnor and related engines all default to 'mistral';
# any constructor whose default is exactly this string is a candidate for
# being overridden by us.
ENGINE_DEFAULT_MODEL = "mistral"

# Order of preference for the model we will hand to the engines, intersected
# with whatever Ollama actually has installed. The list goes "most generally
# useful for free-form cognition" first, with smaller / faster models above
# larger or specialized ones. The exact order is a judgement call, not a
# benchmark; the important property is that the choice is deterministic and
# does not depend on dictionary iteration order.
PREFERRED_MODELS: tuple[str, ...] = (
    "llama3.2:latest",
    "llama3.2",
    "llama3.1:latest",
    "llama3.1",
    "llama3:latest",
    "llama3",
    "mistral:latest",
    "mistral",
    "dolphin-mixtral:latest",
    "dolphin-mixtral",
    "llama2-uncensored:latest",
    "llama2-uncensored",
    "llama2:latest",
    "llama2",
)

# Module-level cache so `resolve_ollama_model()` is cheap on subsequent calls.
# `None` means "not yet resolved this process". Use `reset_cache()` to clear.
_resolved_model: str | None = None


def _fetch_available_models(url: str, timeout: float = 2.0) -> list[str]:
    """Return the list of model names Ollama reports at /api/tags.

    Returns an empty list on any error (network unreachable, malformed
    response, timeout). Callers must tolerate an empty result. We never
    raise — Ollama being absent is a normal startup state in this project,
    not an error condition.
    """
    try:
        endpoint = f"{url.rstrip('/')}/api/tags"
        req = urllib.request.Request(endpoint, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return []
    models = payload.get("models")
    if not isinstance(models, list):
        return []
    out: list[str] = []
    for entry in models:
        if isinstance(entry, dict):
            name = entry.get("name") or entry.get("model")
            if isinstance(name, str) and name:
                out.append(name)
        elif isinstance(entry, str) and entry:
            out.append(entry)
    return out


def _pick_preferred(available: Iterable[str]) -> str | None:
    """From an Ollama-reported list of installed models, return the
    highest-priority match against `PREFERRED_MODELS`. Returns None if none
    of the preferred names are installed.
    """
    available_set = {a.strip() for a in available if isinstance(a, str)}
    for candidate in PREFERRED_MODELS:
        if candidate in available_set:
            return candidate
    return None


def resolve_ollama_model(force_refresh: bool = False) -> str:
    """Return the model name to hand to engines that hard-code 'mistral'.

    Resolution order:
      1. `RESIDENT_BRAIN_OLLAMA_MODEL` env var (used verbatim if non-empty).
      2. `_pick_preferred(installed)` based on Ollama's /api/tags.
      3. First installed model, if any.
      4. The literal `'mistral'` (engine's own default).

    Cached per process unless `force_refresh=True`.
    """
    global _resolved_model
    if _resolved_model is not None and not force_refresh:
        return _resolved_model

    env_choice = os.environ.get("RESIDENT_BRAIN_OLLAMA_MODEL", "").strip()
    if env_choice:
        _resolved_model = env_choice
        return env_choice

    available = _fetch_available_models(OLLAMA_URL)
    preferred = _pick_preferred(available)
    if preferred:
        _resolved_model = preferred
        return preferred

    if available:
        _resolved_model = available[0]
        return available[0]

    _resolved_model = ENGINE_DEFAULT_MODEL
    return ENGINE_DEFAULT_MODEL


def reset_cache() -> None:
    """Clear the cached resolution. Used by tests and by callers that
    want to re-query Ollama after a model install."""
    global _resolved_model
    _resolved_model = None


def describe_resolution() -> dict[str, Any]:
    """Return a structured summary of how the model was resolved, for the
    /health endpoint and the dev HUD. Never raises; never refreshes the
    cache. Reads the environment fresh every call so users can see whether
    their env var actually took effect."""
    env_choice = os.environ.get("RESIDENT_BRAIN_OLLAMA_MODEL", "").strip()
    return {
        "ollamaUrl": OLLAMA_URL,
        "envOverride": env_choice or None,
        "resolvedModel": _resolved_model,
        "engineDefaultModel": ENGINE_DEFAULT_MODEL,
    }
