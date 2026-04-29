"""AI City local dev launcher.

Starts both processes in one terminal:
  - Resident brain service: uvicorn server.residentBrain.main:app
  - Vite dev server:        npm run dev

Use:
    python start_dev.py
    python start_dev.py --no-brain      # only Vite
    python start_dev.py --no-vite       # only brain
    python start_dev.py --brain-port 8787
    python start_dev.py --install        # pip install + npm install before start
    python start_dev.py --reset-state    # delete server/residentBrain/state/engines/

Stops both processes on Ctrl+C or when either child exits.
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import IO, Optional


PROJECT_ROOT = Path(__file__).resolve().parent
BRAIN_DIR = PROJECT_ROOT / "server" / "residentBrain"
ENGINES_DIR = PROJECT_ROOT / "Engines"
BRAIN_STATE_DIR = BRAIN_DIR / "state" / "engines"


# Windows-friendly ANSI colors. Most modern Windows terminals (Windows Terminal,
# VS Code integrated terminal, Cursor) support them.
COLORS = {
    "brain": "\033[38;5;141m",  # purple
    "vite": "\033[38;5;120m",   # green
    "info": "\033[38;5;220m",   # gold
    "error": "\033[38;5;203m",  # red
    "reset": "\033[0m",
}


def _supports_ansi() -> bool:
    if os.environ.get("NO_COLOR"):
        return False
    if not sys.stdout.isatty():
        return False
    if os.name == "nt":
        # Best-effort: enable virtual terminal processing on Win10+.
        try:
            import ctypes

            kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
            return True
        except Exception:
            return False
    return True


_ANSI = _supports_ansi()


def colorize(label: str, text: str) -> str:
    if not _ANSI:
        return text
    color = COLORS.get(label, "")
    return f"{color}{text}{COLORS['reset']}"


def log(label: str, message: str) -> None:
    prefix = f"[{label.upper():5}]"
    print(f"{colorize(label, prefix)} {message}", flush=True)


def stream_output(label: str, stream: Optional[IO[str]]) -> None:
    if stream is None:
        return
    for raw in iter(stream.readline, ""):
        line = raw.rstrip("\r\n")
        if not line:
            continue
        print(f"{colorize(label, f'[{label.upper():5}]')} {line}", flush=True)


def find_npm() -> Optional[str]:
    candidates = ["npm.cmd", "npm"] if os.name == "nt" else ["npm"]
    for name in candidates:
        path = shutil.which(name)
        if path:
            return path
    return None


def find_uvicorn() -> Optional[str]:
    return shutil.which("uvicorn")


def ensure_python_deps() -> None:
    log("info", "running: pip install -r server/residentBrain/requirements.txt")
    req_file = BRAIN_DIR / "requirements.txt"
    if not req_file.exists():
        log("error", f"missing {req_file}")
        return
    code = subprocess.call(
        [sys.executable, "-m", "pip", "install", "-r", str(req_file)],
        cwd=str(PROJECT_ROOT),
    )
    if code != 0:
        log("error", f"pip install failed (exit {code})")
        sys.exit(code)


def ensure_node_modules() -> None:
    if (PROJECT_ROOT / "node_modules").exists():
        return
    npm = find_npm()
    if npm is None:
        log("error", "npm not found on PATH; install Node.js first")
        sys.exit(1)
    log("info", "node_modules missing — running npm install")
    code = subprocess.call([npm, "install"], cwd=str(PROJECT_ROOT))
    if code != 0:
        log("error", f"npm install failed (exit {code})")
        sys.exit(code)


def reset_brain_state() -> None:
    if BRAIN_STATE_DIR.exists():
        log("info", f"deleting {BRAIN_STATE_DIR}")
        shutil.rmtree(BRAIN_STATE_DIR, ignore_errors=True)
    else:
        log("info", "no brain state to reset")


def start_brain(port: int) -> Optional[subprocess.Popen]:
    if not BRAIN_DIR.exists():
        log("error", f"brain dir missing: {BRAIN_DIR}")
        return None
    env = os.environ.copy()
    if ENGINES_DIR.exists():
        env["ENGINES_ROOT"] = str(ENGINES_DIR)
    env["PYTHONUNBUFFERED"] = "1"

    uvicorn = find_uvicorn()
    if uvicorn is not None:
        cmd = [uvicorn, "main:app", "--host", "127.0.0.1", "--port", str(port), "--reload"]
    else:
        cmd = [
            sys.executable,
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--reload",
        ]

    log("brain", f"starting on http://127.0.0.1:{port} (cwd={BRAIN_DIR})")
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    return subprocess.Popen(
        cmd,
        cwd=str(BRAIN_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        creationflags=creationflags,
    )


def start_vite() -> Optional[subprocess.Popen]:
    npm = find_npm()
    if npm is None:
        log("error", "npm not found on PATH; install Node.js first")
        return None
    log("vite", f"starting `npm run dev` (cwd={PROJECT_ROOT})")
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    return subprocess.Popen(
        [npm, "run", "dev"],
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        creationflags=creationflags,
    )


def stop_process(label: str, proc: Optional[subprocess.Popen]) -> None:
    if proc is None or proc.poll() is not None:
        return
    log("info", f"stopping {label} (pid {proc.pid})")
    try:
        if os.name == "nt":
            proc.send_signal(signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
        else:
            proc.terminate()
    except Exception:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        log("info", f"{label} ignored signal, killing")
        try:
            proc.kill()
        except Exception:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="AI City dev launcher")
    parser.add_argument("--no-brain", action="store_true", help="skip Python brain service")
    parser.add_argument("--no-vite", action="store_true", help="skip Vite dev server")
    parser.add_argument("--brain-port", type=int, default=8787, help="brain service port")
    parser.add_argument("--install", action="store_true", help="install Python deps + node modules first")
    parser.add_argument("--reset-state", action="store_true", help="delete server/residentBrain/state/engines before start")
    args = parser.parse_args()

    if args.no_brain and args.no_vite:
        log("error", "nothing to do — both --no-brain and --no-vite were set")
        return 2

    if args.install:
        if not args.no_brain:
            ensure_python_deps()
        if not args.no_vite:
            ensure_node_modules()

    if args.reset_state and not args.no_brain:
        reset_brain_state()

    procs: list[tuple[str, subprocess.Popen]] = []
    threads: list[threading.Thread] = []

    if not args.no_brain:
        brain = start_brain(args.brain_port)
        if brain is None:
            return 1
        procs.append(("brain", brain))
        t = threading.Thread(target=stream_output, args=("brain", brain.stdout), daemon=True)
        t.start()
        threads.append(t)
        # Give the brain a moment to bind so Vite hot reload doesn't show a 404 on first health.
        time.sleep(0.5)

    if not args.no_vite:
        vite = start_vite()
        if vite is None:
            for label, p in procs:
                stop_process(label, p)
            return 1
        procs.append(("vite", vite))
        t = threading.Thread(target=stream_output, args=("vite", vite.stdout), daemon=True)
        t.start()
        threads.append(t)

    log("info", "press Ctrl+C to stop both")

    exit_code = 0
    try:
        while True:
            for label, p in procs:
                rc = p.poll()
                if rc is not None:
                    log("error", f"{label} exited with code {rc}; stopping the rest")
                    exit_code = rc if rc not in (0, None) else 1
                    raise SystemExit
            time.sleep(0.5)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        for label, p in procs:
            stop_process(label, p)
        # Give streamers a moment to flush.
        for t in threads:
            t.join(timeout=1)

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
