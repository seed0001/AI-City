"""Tiny smoke for the new state_path-extension helpers in EngineBundle.

Runs in process, no FastAPI, no engines. Just verifies that:
  - the regex correctly pulls the default value of `state_path` out of
    constructor signature strings as captured in the per-NPC state JSONs
  - the right extension and the right db_backed flag are inferred for both
    the lyra memory manager (the actual bug we hit) and a sampling of
    well-behaved engines that should keep their `.json` path.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from brain_bundle import EngineBundle  # noqa: E402

CASES: list[tuple[str | None, str | None, str, bool]] = [
    (
        "(self, config: Dict = None, state_path: str = 'memory.db')",
        "memory.db",
        ".db",
        True,
    ),
    (
        "(self, config: Dict = None, state_path: str = 'goals.json')",
        "goals.json",
        ".json",
        False,
    ),
    (
        "(self, config: Dict = None, state_path: str = 'avatar_generator_lyra.json', "
        "avatar_image: str = 'input/lyra.jpg', output_dir: str = 'output', tts_lang: str = 'en')",
        "avatar_generator_lyra.json",
        ".json",
        False,
    ),
    (
        "(self, state_path: str = 'next_interaction_intents.json')",
        "next_interaction_intents.json",
        ".json",
        False,
    ),
    (
        "(self, config: Dict = None)",
        None,
        ".json",
        False,
    ),
    (None, None, ".json", False),
    (
        "(self, config: Dict = None, state_path: str = 'foo.sqlite3')",
        "foo.sqlite3",
        ".sqlite3",
        True,
    ),
    (
        '(self, config: Dict = None, state_path: str = "double_quoted.db")',
        "double_quoted.db",
        ".db",
        True,
    ),
]


def main() -> int:
    failed = 0
    for sig, expect_default, expect_ext, expect_db in CASES:
        got_default = EngineBundle._extract_state_path_default(sig)
        got_ext = EngineBundle._state_path_extension(sig)
        got_db = EngineBundle._is_db_backed(sig)
        ok = (
            got_default == expect_default
            and got_ext == expect_ext
            and got_db == expect_db
        )
        prefix = "PASS" if ok else "FAIL"
        if not ok:
            failed += 1
        sig_short = (sig or "<none>")[:80].replace("\n", " ")
        print(
            f"{prefix}: default={got_default!r:<35} ext={got_ext:<10} db={got_db}  sig={sig_short}"
        )
    print()
    print(f"{len(CASES) - failed}/{len(CASES)} passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
