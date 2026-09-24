#!/usr/bin/env python3
"""
LLM-assisted MV2 -> MV3 migration & verification harness.

Pipeline (mirrors the manual flow of ../google_manifest_converter/test_extensions.py
but adds an automated Claude Code migration step running in tmux):

  - A tmux session is created with two halves.
  - LEFT pane:  Claude Code is launched (with --dangerously-skip-permissions) on
                extension N and asked, via a standardized prompt, to fix its
                broken MV3 migration.
  - When Claude finishes its first turn, that whole pane is moved to the RIGHT
    (it stays alive for follow-up prompts) and:
        * Chrome 130 opens the original  mv2/  extension
        * Chrome 141 opens the migrated  mv3/  extension
        * a small controls pane opens to record pass / fail / skip + notes
    Meanwhile the LEFT side immediately spawns a fresh Claude session on
    extension N+1.
  - When you finish testing, the two Chrome windows + controls pane close.
  - The next migration is only moved to the RIGHT once the previous test slot is
    free; if you are still testing, the pipeline waits for you. When a tested
    session is retired, its transcript is exported to ./transcripts/.

Usage:
    # inside the nix dev shell (provides tmux):
    nix develop
    python migrate_extensions.py [--ext-dir downloaded_extensions] [--redo]

This file also implements the 'controls' subcommand that runs inside the small
tmux pane; you normally never call it directly.
"""

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

# Where the downloaded extensions live. Each <ext_id>/ holds an mv2/ and mv3/
# directory (download with download_broken_extensions.py WITHOUT --compress).
DEFAULT_EXT_DIR = BASE_DIR / "downloaded_extensions"

# Reuse the Chrome-for-Testing builds that already live in the converter project.
CHROME_PROJECT = BASE_DIR.parent / "google_manifest_converter"
CHROME_130 = (
    CHROME_PROJECT
    / "chrome" / "mac_arm-130.0.6723.116" / "chrome-mac-arm64"
    / "Google Chrome for Testing.app" / "Contents" / "MacOS"
    / "Google Chrome for Testing"
)
CHROME_141 = (
    CHROME_PROJECT
    / "chrome" / "mac_arm-141.0.7390.123" / "chrome-mac-arm64"
    / "Google Chrome for Testing.app" / "Contents" / "MacOS"
    / "Google Chrome for Testing"
)

RUN_DIR = BASE_DIR / ".migrate_run"        # ephemeral: launchers, sentinels, logs
TRANSCRIPTS_DIR = BASE_DIR / "transcripts"  # exported Claude session transcripts
RESULTS_FILE = BASE_DIR / "migration_results.json"
IDS_FILE = BASE_DIR / "ids"                 # optional: defines processing order
LOG_FILE = RUN_DIR / "orchestrator.log"

SESSION = "migrate"

# The standardized prompt handed to every Claude Code migration session. Claude
# is launched with its working directory set to the extension's mv3/ folder, so
# "you are currently in the directory of the broken Manifest V3 extension" holds.
MIGRATION_PROMPT = """You are an expert Chrome extension developer specializing in fixing broken extensions after migration from Manifest V2 to Manifest V3. You are currently in the directory of the broken Manifest V3 extension that has been migrated from Manifest V2. Analyze the extension files and their code to identify and fix issues causing the extension to not work in Google Chrome 140. Do not ask questions."""

# Model used for the SAIA backend when --model is not given. Pick one from the
# model list in the GWDG SAIA docs; devstral is their coding-focused model.
DEFAULT_SAIA_MODEL = "devstral-2-123b-instruct-2512"

# Model used for the OpenCode Zen backend when --model is not given. Zen serves
# Anthropic-protocol models at https://opencode.ai/zen/v1/messages.
DEFAULT_ZEN_MODEL = "claude-sonnet-4-6"

# ---------------------------------------------------------------------------
# Tool resolution
# ---------------------------------------------------------------------------


def resolve_tmux() -> str:
    """Return an absolute path to a tmux binary (PATH, then nix fallback)."""
    found = shutil.which("tmux")
    if found:
        return found
    try:
        out = subprocess.run(
            ["nix-shell", "-p", "tmux", "--run", "command -v tmux"],
            capture_output=True, text=True, timeout=120,
        )
        path = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""
        if path and os.path.exists(path):
            return path
    except Exception:
        pass
    sys.exit(
        "ERROR: tmux not found. Enter the dev shell first:  nix develop\n"
        "       (the flake provides tmux), then re-run this script."
    )


def resolve_claude() -> str:
    """Return an absolute path to the claude binary."""
    found = shutil.which("claude")
    if found:
        return found
    candidate = Path.home() / ".local" / "bin" / "claude"
    if candidate.exists():
        return str(candidate)
    sys.exit("ERROR: could not find the 'claude' binary on PATH or in ~/.local/bin.")


def resolve_ollama() -> str:
    """Return an absolute path to the ollama binary."""
    found = shutil.which("ollama")
    if found:
        return found
    sys.exit("ERROR: could not find the 'ollama' binary on PATH.")


def start_saia_shim(port_file: Path) -> subprocess.Popen:
    """Start the local shim that adapts Claude Code requests for SAIA.

    Claude Code sends role:system messages, which the SAIA /v1/messages
    endpoint (vLLM Anthropic adapter) rejects. The shim moves them into the
    top-level system field and relays the request. Returns once the shim
    listens; the port lands in `port_file`.
    """
    script = Path(__file__).resolve().parent / "saia_anthropic_shim.py"
    port_file.unlink(missing_ok=True)  # a stale file would pass the wait below
    snapshot = RUN_DIR / "saia_ratelimit.json"
    snapshot.unlink(missing_ok=True)   # start from a clean quota state
    shim_env = dict(os.environ)
    shim_env["SAIA_SHIM_RATELIMIT_FILE"] = str(snapshot)
    proc = subprocess.Popen(
        [sys.executable, str(script), str(port_file)],
        env=shim_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 15
    while time.time() < deadline:
        if proc.poll() is not None:
            sys.exit("ERROR: SAIA shim exited during startup.")
        if port_file.exists():
            # Confirm the port really accepts connections before returning.
            try:
                sock = socket.create_connection(("127.0.0.1", int(port_file.read_text())), timeout=1)
                sock.close()
                return proc
            except OSError:
                pass
        time.sleep(0.1)
    proc.terminate()
    sys.exit("ERROR: SAIA shim did not become ready within 15s.")


def start_zen_shim(port_file: Path) -> subprocess.Popen:
    """Start the local shim that adapts Claude Code requests for OpenCode Zen.

    Claude Code sends the SDK-only `context_management` body field, which the
    Zen upstream rejects with HTTP 400. The shim strips that field and relays
    the request. Returns once the shim listens; the port lands in `port_file`.
    """
    script = Path(__file__).resolve().parent / "zen_anthropic_shim.py"
    port_file.unlink(missing_ok=True)  # a stale file would pass the wait below
    proc = subprocess.Popen(
        [sys.executable, str(script), str(port_file)],
        env=dict(os.environ), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 15
    while time.time() < deadline:
        if proc.poll() is not None:
            sys.exit("ERROR: OpenCode Zen shim exited during startup.")
        if port_file.exists():
            # Confirm the port really accepts connections before returning.
            try:
                sock = socket.create_connection(("127.0.0.1", int(port_file.read_text())), timeout=1)
                sock.close()
                return proc
            except OSError:
                pass
        time.sleep(0.1)
    proc.terminate()
    sys.exit("ERROR: OpenCode Zen shim did not become ready within 15s.")


STATUS_RIGHT_BASE = " Ctrl-q: quit & exit   prefix+d: detach "


def _rl_log(msg: str) -> None:
    """Append one quota update to the orchestrator log."""
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def _rl_right_text(reset_at, remaining, limit) -> str:
    """Compose the status-right segment for a rate-limit episode."""
    if remaining is None:
        return "SAIA: rate limited"
    text = f"SAIA: {remaining}/{limit if limit is not None else '?'} per min"
    if reset_at is not None:
        left = int(reset_at - time.time())
        if left > 0:
            text += f", resets in {left}s"
    return text


def _rl_set_status(text: str) -> None:
    """Persist the SAIA quota in status-right; pass None to restore the base."""
    if text:
        tmux("set-option", "-t", SESSION, "status-right",
             f" {text}  {STATUS_RIGHT_BASE.strip()}")
    else:
        tmux("set-option", "-t", SESSION, "status-right", STATUS_RIGHT_BASE)


def watch_ratelimit(stop_event: threading.Event) -> None:
    """Surface SAIA quota from the shim snapshot to the log and tmux.

    Logs the quota once at startup, each fresh 429, and the recovery once
    the quota is available again. Runs until `stop_event` is set.
    """
    snapshot = RUN_DIR / "saia_ratelimit.json"
    logged_intro = False
    last_429 = None      # most recent 429 timestamp seen
    in_episode = False   # quota currently exhausted on the minute window
    last_rem = None      # remaining-minute at the last recorded event
    low_warned = False
    reset_at = None      # wall time when the current window counter resets
    right_text = None    # current quota segment in status-right (None = base)
    last_seen = None     # last_seen_iso used to compute reset_at
    while not stop_event.is_set():
        try:
            if not snapshot.exists():
                logged_intro = False
                time.sleep(3)
                continue
            data = json.loads(snapshot.read_text())
            minute = data.get("minute") or {}
            remaining = minute.get("remaining")
            reset = data.get("reset_seconds")
            # Anchor the countdown to the response time, not the read time,
            # so it keeps ticking while the snapshot stays unchanged.
            ts = data.get("last_seen_iso")
            if reset is not None and ts != last_seen:
                last_seen = ts
                try:
                    dt = datetime.fromisoformat(ts)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    reset_at = dt.timestamp() + reset
                except (ValueError, TypeError):
                    pass

            if not logged_intro:
                logged_intro = True
                if remaining is not None:
                    _rl_log(
                        f"SAIA quota: {remaining}/{minute.get('limit')} per minute"
                        + (f", resets in {reset}s" if reset is not None else "")
                    )

            now_429 = data.get("last_429_iso")
            if now_429 and now_429 != last_429:
                # A new 429 event. Log only the start of an episode so
                # repeated reads of the same snapshot stay quiet.
                last_429 = now_429
                if not in_episode:
                    in_episode = True
                    last_rem = remaining
                    _rl_log(
                        f"SAIA rate limit hit (429): {remaining}/{minute.get('limit')} per minute"
                        + (f", resets in {reset}s" if reset is not None else "")
                    )
                    right_text = _rl_right_text(reset_at, remaining, minute.get("limit"))
                    _rl_set_status(right_text)
            elif now_429 and in_episode and data.get("status") == 200 \
                    and remaining is not None and remaining != last_rem:
                _rl_log(f"SAIA rate limit cleared: {remaining}/{minute.get('limit')} per minute")
                in_episode = False
                last_rem = None
                right_text = None
                _rl_set_status(None)

            if remaining is not None and remaining <= 5 and not low_warned \
                    and not in_episode:
                low_warned = True
                _rl_log(
                    f"SAIA quota nearly exhausted: {remaining}/{minute.get('limit')} per minute remaining"
                )

            # Live countdown while an episode is active; only touch tmux
            # when the visible text actually changes.
            if in_episode:
                text = _rl_right_text(reset_at, remaining, minute.get("limit"))
                if text != right_text:
                    right_text = text
                    _rl_set_status(text)
        except (OSError, json.JSONDecodeError):
            pass
        time.sleep(3)


TMUX = ""     # populated in main()
CLAUDE = ""   # populated in main()
OLLAMA = ""   # populated in main() when --model is used


def tmux(*args: str, capture: bool = False) -> str:
    """Run a tmux command. Returns stdout when capture=True."""
    cmd = [TMUX, *args]
    if capture:
        res = subprocess.run(cmd, capture_output=True, text=True)
        return res.stdout.strip()
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return ""


# ---------------------------------------------------------------------------
# Results persistence
# ---------------------------------------------------------------------------


def load_results() -> dict:
    if RESULTS_FILE.exists():
        try:
            with open(RESULTS_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_results(results: dict) -> None:
    tmp = RESULTS_FILE.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(results, f, indent=2)
    tmp.replace(RESULTS_FILE)


def read_manifest(path: Path) -> Optional[dict]:
    mf = path / "manifest.json"
    if not mf.exists():
        return None
    try:
        with open(mf) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def ext_name(ext_id: str, ext_root: Path) -> str:
    for sub in ("mv2", "mv3"):
        m = read_manifest(ext_root / sub)
        if m and m.get("name"):
            return m["name"]
    return ext_id


def seed_folder_trust(ext_dir: Path, exts: List[str]) -> None:
    """Pre-accept Claude Code's workspace-trust dialog for each extension's mv3/ dir.

    Trust is stored per-folder in ~/.claude.json under
    projects.<abs_path>.hasTrustDialogAccepted, separate from permission mode.
    Seeding it once up front means the spawned sessions skip the prompt.
    """
    cfg = Path.home() / ".claude.json"
    try:
        data = json.loads(cfg.read_text()) if cfg.exists() else {}
    except (json.JSONDecodeError, OSError):
        return
    projects = data.setdefault("projects", {})
    changed = False
    for ext_id in exts:
        path = str((ext_dir / ext_id / "mv3").resolve())
        entry = projects.setdefault(path, {})
        if not entry.get("hasTrustDialogAccepted"):
            entry["hasTrustDialogAccepted"] = True
            changed = True
        if entry.get("projectOnboardingSeenCount", 0) < 1:
            entry["projectOnboardingSeenCount"] = 1
            changed = True
    if changed:
        try:
            tmp = cfg.with_suffix(".json.seedtmp")
            tmp.write_text(json.dumps(data, indent=2))
            tmp.replace(cfg)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Controls subcommand (runs inside the small tmux pane)
# ---------------------------------------------------------------------------


def run_controls(args: argparse.Namespace) -> None:
    """Interactive prompt shown in the controls pane; records the verdict."""
    ext_id = args.ext_id
    name = args.name
    verdict_file = Path(args.verdict_file)
    results_file = Path(args.results_file)

    print("=" * 50)
    print(f"  TEST: {name}")
    print(f"  id:   {ext_id}")
    print("=" * 50)
    print("  Left Chrome 130 = original MV2")
    print("  Right Chrome 141 = migrated MV3")
    print()

    status = None
    while status is None:
        print("  [p] pass   [f] fail   [s] skip")
        try:
            choice = input("  verdict > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            choice = "s"
        status = {"p": "pass", "f": "fail", "s": "skip"}.get(choice)
        if status is None:
            print("  please type p, f or s")

    try:
        notes = input("  notes (optional) > ").strip()
    except (EOFError, KeyboardInterrupt):
        notes = ""

    # Merge into the shared results file.
    results = {}
    if results_file.exists():
        try:
            with open(results_file) as f:
                results = json.load(f)
        except (json.JSONDecodeError, OSError):
            results = {}
    results[ext_id] = {
        "name": name,
        "status": status,
        "notes": notes,
        "tested_at": datetime.now().isoformat(timespec="seconds"),
    }
    tmp = results_file.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(results, f, indent=2)
    tmp.replace(results_file)

    verdict_file.write_text(status)
    print(f"\n  recorded: {status.upper()}")
    print("  done — this pane closes once the next migration is ready.")
    # Stay alive (the orchestrator kills this pane when it retires the slot);
    # this avoids leaving a "dead pane" in the layout.
    while True:
        time.sleep(3600)


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


class TestSlot:
    """A migrated extension currently parked on the right for testing."""

    def __init__(self, ext_id, name, cc_pane, ctrl_pane, chrome_procs,
                 tmpdirs, session_id, verdict_file, ext_root):
        self.ext_id = ext_id
        self.name = name
        self.cc_pane = cc_pane          # tmux pane id of the (kept-alive) CC session
        self.ctrl_pane = ctrl_pane      # tmux pane id of the controls pane
        self.chrome_procs = chrome_procs
        self.tmpdirs = tmpdirs
        self.session_id = session_id
        self.verdict_file = verdict_file
        self.ext_root = ext_root


class Orchestrator:
    def __init__(self, exts: List[str], ext_dir: Path, stop_event: threading.Event,
                 provider: str = "anthropic", model: Optional[str] = None,
                 saia_base: str = "", zen_base: str = ""):
        self.exts = exts
        self.ext_dir = ext_dir
        self.stop = stop_event
        self.provider = provider
        self.model = model
        self.saia_base = saia_base
        self.zen_base = zen_base
        self.work_pane: Optional[str] = None     # LEFT pane: current migration
        self.placeholder: Optional[str] = None   # initial empty right pane
        self.slot: Optional[TestSlot] = None      # RIGHT: extension under test
        # ext_id -> (session_id, sentinel); created when its launcher is written
        # (in setup for the first ext, during the "move" for every following ext).
        self.pending: Dict[str, tuple] = {}

    # -- logging ----------------------------------------------------------
    def log(self, msg: str) -> None:
        line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
        tmux("display-message", "-t", SESSION, msg[:120])

    # -- per-extension run files -----------------------------------------
    def _paths(self, ext_id: str):
        sentinel = RUN_DIR / f"done_{ext_id}"
        settings = RUN_DIR / f"settings_{ext_id}.json"
        launcher = RUN_DIR / f"launch_{ext_id}.sh"
        verdict = RUN_DIR / f"verdict_{ext_id}"
        return sentinel, settings, launcher, verdict

    def _write_migration_launcher(self, ext_id: str) -> tuple:
        """Create the per-ext settings + launcher script. Returns (launcher, session_id, sentinel)."""
        # Claude runs inside the broken MV3 extension directory itself.
        mv3_dir = self.ext_dir / ext_id / "mv3"
        sentinel, settings, launcher, _ = self._paths(ext_id)
        sentinel.unlink(missing_ok=True)
        session_id = str(uuid.uuid4())

        # Stop hook touches the sentinel when Claude finishes a turn.
        settings_data = {
            "hooks": {
                "Stop": [
                    {"hooks": [{"type": "command", "command": f"touch '{sentinel}'"}]}
                ]
            }
        }
        settings.write_text(json.dumps(settings_data))

        prompt_file = RUN_DIR / f"prompt_{ext_id}.txt"
        prompt_file.write_text(MIGRATION_PROMPT)

        model_flag = f" --model '{self.model}'" if self.model else ""

        if self.provider == "openrouter":
            launcher.write_text(
                "#!/bin/sh\n"
                f"cd '{mv3_dir}'\n"
                # OpenRouter: route Claude Code via their Anthropic Skin.
                # Env vars must be set in the launcher (not inherited) because
                # tmux panes don't always pick up the parent shell's env.
                'export ANTHROPIC_BASE_URL="https://openrouter.ai/api"\n'
                'export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"\n'
                'export ANTHROPIC_API_KEY=""\n'
                f"exec '{CLAUDE}' --dangerously-skip-permissions"
                f" --session-id {session_id}"
                f" --settings '{settings}'"
                f"{model_flag}"
                f" -- \"$(cat '{prompt_file}')\"\n"
            )
        elif self.provider == "ollama":
            cmd = (
                f"exec '{OLLAMA}' launch claude --model '{self.model}' --yes"
                f" -- --dangerously-skip-permissions"
                f" --session-id {session_id}"
                f" --settings '{settings}'"
                f" -- \"$(cat '{prompt_file}')\""
            )
            launcher.write_text(
                "#!/bin/sh\n"
                f"cd '{mv3_dir}'\n"
                f"{cmd}\n"
            )
        elif self.provider == "saia":
            model = self.model or DEFAULT_SAIA_MODEL
            # Route through the local shim (started in run_orchestrate): it
            # moves Claude Code's role:system messages into the top-level
            # system field, which SAIA's vLLM adapter requires. Fall back to
            # the direct URL when the shim is absent.
            base = self.saia_base or "https://chat-ai.academiccloud.de"
            launcher.write_text(
                "#!/bin/sh\n"
                f"cd '{mv3_dir}'\n"
                f'export ANTHROPIC_BASE_URL="{base}"\n'
                'export ANTHROPIC_AUTH_TOKEN="$SAIA_API_KEY"\n'
                'export ANTHROPIC_API_KEY=""\n'
                f"exec '{CLAUDE}' --dangerously-skip-permissions"
                f" --session-id {session_id}"
                f" --settings '{settings}'"
                f" --model '{model}'"
                f" -- \"$(cat '{prompt_file}')\"\n"
            )
        elif self.provider == "opencodezen":
            model = self.model or DEFAULT_ZEN_MODEL
            # Route through the local shim (started in run_orchestrate): it
            # strips the SDK-only body fields (e.g. context_management) that
            # the Zen upstream rejects with HTTP 400. Zen accepts the key via
            # x-api-key only; ANTHROPIC_API_KEY makes the SDK send it, while
            # ANTHROPIC_AUTH_TOKEN would send Bearer only and get a 401.
            base = self.zen_base or "https://opencode.ai/zen"
            launcher.write_text(
                "#!/bin/sh\n"
                f"cd '{mv3_dir}'\n"
                f'export ANTHROPIC_BASE_URL="{base}"\n'
                'unset ANTHROPIC_AUTH_TOKEN\n'
                'export ANTHROPIC_API_KEY="$OPENCODE_ZEN_API_KEY"\n'
                f"exec '{CLAUDE}' --dangerously-skip-permissions"
                f" --session-id {session_id}"
                f" --settings '{settings}'"
                f" --model '{model}'"
                f" -- \"$(cat '{prompt_file}')\"\n"
            )
        else:  # anthropic (default)
            cmd = (
                f"exec '{CLAUDE}' --dangerously-skip-permissions"
                f" --session-id {session_id}"
                f" --settings '{settings}'"
                f"{model_flag}"
                f" -- \"$(cat '{prompt_file}')\""
            )
            launcher.write_text(
                "#!/bin/sh\n"
                f"cd '{mv3_dir}'\n"
                f"{cmd}\n"
            )
        launcher.chmod(0o755)
        self.pending[ext_id] = (session_id, sentinel)
        return launcher, session_id, sentinel

    def _write_controls_launcher(self, ext_id: str, name: str, verdict_file: Path) -> Path:
        launcher = RUN_DIR / f"controls_{ext_id}.sh"
        verdict_file.unlink(missing_ok=True)
        script = Path(__file__).resolve()
        launcher.write_text(
            "#!/bin/sh\n"
            f"'{sys.executable}' '{script}' controls"
            f" --ext-id '{ext_id}'"
            f" --name \"{name}\""
            f" --verdict-file '{verdict_file}'"
            f" --results-file '{RESULTS_FILE}'\n"
        )
        launcher.chmod(0o755)
        return launcher

    # -- waiting helpers --------------------------------------------------
    def _wait_for(self, path: Path, what: str) -> bool:
        """Block until `path` exists or stop is requested. Returns False if stopped."""
        while not path.exists():
            if self.stop.is_set():
                return False
            time.sleep(0.4)
        return True

    # -- chrome -----------------------------------------------------------
    def _launch_chrome(self, binary: Path, ext_path: Path, label: str):
        if not binary.exists():
            self.log(f"WARNING: chrome missing: {binary}")
            return None, None
        tmpdir = tempfile.mkdtemp(prefix="chrome_")
        cmd = [
            str(binary),
            f"--load-extension={ext_path}",
            f"--user-data-dir={tmpdir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-default-apps",
            f"--window-name={label}",
        ]
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return proc, tmpdir
        except OSError as e:
            self.log(f"ERROR launching {label}: {e}")
            shutil.rmtree(tmpdir, ignore_errors=True)
            return None, tmpdir

    # -- slot cleanup -----------------------------------------------------
    def _retire_slot(self) -> None:
        """Tear down the current test slot: chrome, controls pane, CC pane, transcript."""
        slot = self.slot
        if slot is None:
            return
        self.log(f"retiring {slot.name}: closing chrome + exporting transcript")
        for proc in slot.chrome_procs:
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                except OSError:
                    pass
        for d in slot.tmpdirs:
            shutil.rmtree(d, ignore_errors=True)

        self._export_transcript(slot.ext_id, slot.session_id)

        # Kill the controls pane and the retired Claude session pane.
        if slot.ctrl_pane:
            tmux("kill-pane", "-t", slot.ctrl_pane)
        if slot.cc_pane:
            tmux("kill-pane", "-t", slot.cc_pane)
        self.slot = None

    def _export_transcript(self, ext_id: str, session_id: str) -> None:
        TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
        matches = list((Path.home() / ".claude" / "projects").glob(f"*/{session_id}.jsonl"))
        if not matches:
            self.log(f"transcript for {ext_id} not found (session {session_id})")
            return
        dest = TRANSCRIPTS_DIR / f"{ext_id}.jsonl"
        try:
            shutil.copy2(matches[0], dest)
            self.log(f"transcript saved: {dest.name}")
        except OSError as e:
            self.log(f"transcript copy failed for {ext_id}: {e}")

    # -- main loop --------------------------------------------------------
    def setup(self) -> None:
        """Create the tmux session with the first migration on the left."""
        ext0 = self.exts[0]
        launcher, _, _ = self._write_migration_launcher(ext0)

        tmux("new-session", "-d", "-s", SESSION, "-x", "240", "-y", "60",
             "sh", str(launcher))
        self.work_pane = tmux("list-panes", "-t", SESSION,
                              "-F", "#{pane_id}", capture=True).splitlines()[0]
        # Empty right placeholder so "two panes appear" at startup.
        self.placeholder = tmux(
            "split-window", "-h", "-t", self.work_pane, "-P", "-F", "#{pane_id}",
            "sh", "-c", "printf '  (waiting for first migration to finish...)\\n'; "
                        "exec sleep 1000000",
            capture=True,
        )
        tmux("select-pane", "-t", self.work_pane)
        tmux("set-option", "-t", SESSION, "remain-on-exit", "on")
        # Mouse mode: click a pane to focus it, scroll, and drag borders to
        # resize — handy for manually intervening in a Claude session.
        tmux("set-option", "-t", SESSION, "mouse", "on")

        # No-prefix quit key: Ctrl-q stops everything and exits the script.
        tmux("bind-key", "-n", "C-q", "kill-session", "-t", SESSION)
        tmux("set-option", "-t", SESSION, "status-right", STATUS_RIGHT_BASE)
        tmux("set-option", "-t", SESSION, "status-right-length",
             "160" if self.provider == "saia" else "60")

    def run(self) -> None:
        try:
            self._run()
        except Exception as e:  # keep the thread from dying silently
            self.log(f"orchestrator crashed: {e!r}")
        finally:
            # Let the foreground attach return.
            if not self.stop.is_set():
                self.log("all done — detach with prefix+d or close the window")

    def _run(self) -> None:
        n = len(self.exts)

        for i, ext_id in enumerate(self.exts):
            ext_root = self.ext_dir / ext_id
            name = ext_name(ext_id, ext_root)

            # The launcher (and thus session_id + sentinel) for this ext was
            # already created — at setup for ext0, or during the previous move
            # for every following ext — and its claude process is already running.
            session_id, sentinel = self.pending[ext_id]

            self.log(f"[{i+1}/{n}] migrating {name} ...")
            if not self._wait_for(sentinel, "migration"):
                return
            self.log(f"[{i+1}/{n}] migration done: {name}")

            # Free the right side before moving this session over.
            if self.slot is not None:
                self.log(f"waiting for you to finish testing {self.slot.name} ...")
                if not self._wait_for(self.slot.verdict_file, "verdict"):
                    return
                self._retire_slot()
            elif self.placeholder is not None:
                tmux("kill-pane", "-t", self.placeholder)
                self.placeholder = None

            # Move the finished CC pane to the RIGHT by spawning a fresh LEFT pane.
            next_i = i + 1
            if next_i < n:
                next_id = self.exts[next_i]
                nl_launcher, _, _ = self._write_migration_launcher(next_id)
                new_left = tmux(
                    "split-window", "-h", "-b", "-t", self.work_pane,
                    "-P", "-F", "#{pane_id}", "sh", str(nl_launcher), capture=True,
                )
            else:
                new_left = tmux(
                    "split-window", "-h", "-b", "-t", self.work_pane,
                    "-P", "-F", "#{pane_id}",
                    "sh", "-c", "printf '  (no more migrations)\\n'; exec sleep 1000000",
                    capture=True,
                )

            cc_pane = self.work_pane  # the kept-alive migration, now on the right

            # Controls pane: small strip under the migrated session.
            _, _, _, verdict_file = self._paths(ext_id)
            ctrl_launcher = self._write_controls_launcher(ext_id, name, verdict_file)
            ctrl_pane = tmux(
                "split-window", "-v", "-l", "8", "-t", cc_pane,
                "-P", "-F", "#{pane_id}", "sh", str(ctrl_launcher), capture=True,
            )

            # Bail out cleanly if the user asked to quit during the move.
            if self.stop.is_set():
                return

            # Open both Chrome builds for side-by-side testing.
            self.log(f"open chrome for {name} (test on the right)")
            p130, d130 = self._launch_chrome(CHROME_130, ext_root / "mv2", "MV2 (Chrome 130)")
            p141, d141 = self._launch_chrome(CHROME_141, ext_root / "mv3", "MV3 (Chrome 141)")

            self.slot = TestSlot(
                ext_id=ext_id, name=name, cc_pane=cc_pane, ctrl_pane=ctrl_pane,
                chrome_procs=[p130, p141], tmpdirs=[d for d in (d130, d141) if d],
                session_id=session_id, verdict_file=verdict_file, ext_root=ext_root,
            )
            tmux("select-pane", "-t", ctrl_pane)

            # The new left pane is the next migration; loop continues.
            self.work_pane = new_left

        # Final extension: wait for its test, then retire and close the session.
        if self.slot is not None:
            self.log(f"waiting for you to finish testing {self.slot.name} (last one) ...")
            if not self._wait_for(self.slot.verdict_file, "verdict"):
                return
            self._retire_slot()

        self.log("pipeline complete — closing session")
        time.sleep(1.0)
        if not self.stop.is_set():
            tmux("kill-session", "-t", SESSION)


# ---------------------------------------------------------------------------
# Extension discovery
# ---------------------------------------------------------------------------


def discover_extensions(ext_dir: Path, redo: bool) -> List[str]:
    """Return extension IDs that have both mv2/ and mv3/ dirs, in ids-file order."""
    if not ext_dir.is_dir():
        sys.exit(f"ERROR: extension directory not found: {ext_dir}\n"
                 f"       run download_broken_extensions.py first (without --compress).")

    available = []
    for d in sorted(ext_dir.iterdir()):
        if not d.is_dir():
            continue
        if (d / "mv2").is_dir() and (d / "mv3").is_dir():
            available.append(d.name)

    # Order by the ids file when present, then any extras.
    if IDS_FILE.exists():
        order = [ln.strip() for ln in IDS_FILE.read_text().splitlines() if ln.strip()]
        rank = {eid: i for i, eid in enumerate(order)}
        available.sort(key=lambda e: (rank.get(e, len(rank)), e))

    if not redo:
        results = load_results()
        available = [e for e in available if e not in results]

    return available


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def run_orchestrate(args: argparse.Namespace) -> None:
    global TMUX, CLAUDE, OLLAMA
    TMUX = resolve_tmux()
    provider = getattr(args, "provider", None)
    model = getattr(args, "model", None)
    # Backward compat: --model alone implies ollama.
    if provider is None:
        provider = "ollama" if model else "anthropic"

    if provider == "ollama":
        OLLAMA = resolve_ollama()
    else:
        CLAUDE = resolve_claude()

    ext_dir = Path(args.ext_dir).resolve()

    for label, p in [("Chrome 130", CHROME_130), ("Chrome 141", CHROME_141)]:
        if not p.exists():
            print(f"WARNING: {label} binary not found at {p}")

    exts = discover_extensions(ext_dir, args.redo)
    if not exts:
        print("No untested extensions with both mv2/ and mv3/ found.")
        print("(use --redo to re-process already-recorded extensions)")
        return

    RUN_DIR.mkdir(parents=True, exist_ok=True)
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    LOG_FILE.write_text("")  # fresh log

    # Pre-accept Claude's workspace-trust dialog for every mv3/ dir up front, so
    # the spawned sessions start straight into the migration.
    seed_folder_trust(ext_dir, exts)

    # Clean any stale session.
    tmux("kill-session", "-t", SESSION)

    # SAIA needs the local shim to rewrite Claude Code's messages format.
    shim_proc = None
    saia_base = ""
    if provider == "saia":
        port_file = RUN_DIR / "saia_shim.port"
        shim_proc = start_saia_shim(port_file)
        saia_base = f"http://127.0.0.1:{int(port_file.read_text())}"

    # OpenCode Zen needs the local shim to strip unsupported body fields.
    zen_proc = None
    zen_base = ""
    if provider == "opencodezen":
        port_file = RUN_DIR / "zen_shim.port"
        zen_proc = start_zen_shim(port_file)
        zen_base = f"http://127.0.0.1:{int(port_file.read_text())}"

    print("=" * 70)
    print("  LLM migration & verification harness")
    print(f"  {len(exts)} extension(s) queued from {ext_dir}")
    print("  Attaching to tmux. Detach any time with: prefix + d")
    print("  Record verdicts in the small controls pane (bottom-right).")
    print("=" * 70)
    time.sleep(1.5)

    stop_event = threading.Event()
    if provider == "saia":
        threading.Thread(target=watch_ratelimit, args=(stop_event,), daemon=True).start()
    orch = Orchestrator(exts, ext_dir, stop_event, provider=provider, model=model,
                        saia_base=saia_base, zen_base=zen_base)
    orch.setup()

    worker = threading.Thread(target=orch.run, daemon=True)
    worker.start()

    # Foreground: hand the terminal to tmux. Returns on detach / session kill.
    subprocess.run([TMUX, "attach", "-t", SESSION])

    # Shutdown: stop the worker and clean up anything still running.
    stop_event.set()
    if orch.slot is not None:
        for proc in orch.slot.chrome_procs:
            if proc and proc.poll() is None:
                proc.terminate()
        for d in orch.slot.tmpdirs:
            shutil.rmtree(d, ignore_errors=True)
    tmux("kill-session", "-t", SESSION)
    tmux("unbind-key", "-n", "C-q")  # remove the server-wide quit binding
    worker.join(timeout=5)
    if shim_proc is not None:
        shim_proc.terminate()
    if zen_proc is not None:
        zen_proc.terminate()

    results = load_results()
    passed = sum(1 for r in results.values() if r.get("status") == "pass")
    failed = sum(1 for r in results.values() if r.get("status") == "fail")
    skipped = sum(1 for r in results.values() if r.get("status") == "skip")
    print(f"\nDone. Recorded {len(results)} total — "
          f"pass {passed} / fail {failed} / skip {skipped}")
    print(f"Transcripts: {TRANSCRIPTS_DIR}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd")

    # Hidden subcommand used by the controls pane.
    c = sub.add_parser("controls", help=argparse.SUPPRESS)
    c.add_argument("--ext-id", required=True)
    c.add_argument("--name", default="")
    c.add_argument("--verdict-file", required=True)
    c.add_argument("--results-file", required=True)

    parser.add_argument("--ext-dir", default=str(DEFAULT_EXT_DIR),
                        help=f"directory of downloaded extensions (default: {DEFAULT_EXT_DIR})")
    parser.add_argument("--provider", default=None,
                        choices=["anthropic", "ollama", "openrouter", "saia", "opencodezen"],
                        help="LLM backend: anthropic (direct API), ollama (local), openrouter (routed),\n"
                             "saia (GWDG gateway; requires the SAIA_API_KEY env var),\n"
                             "opencodezen (OpenCode Zen gateway; requires the OPENCODE_ZEN_API_KEY env var)\n"
                             "Default: ollama when --model is given, anthropic otherwise.")
    parser.add_argument("--model", default=None,
                        help="model name for the chosen provider\n"
                             "ollama: e.g. gemma4:31b (default with --model)\n"
                             "openrouter: e.g. ~anthropic/claude-sonnet-latest\n"
                             "anthropic: e.g. sonnet (omit for default)\n"
                             "saia: any model from the GWDG model list, e.g. devstral-2-123b-instruct-2512\n"
                             "opencodezen: e.g. claude-sonnet-4-6 (Anthropic-protocol models only)")
    parser.add_argument("--redo", action="store_true",
                        help="also process extensions already recorded in migration_results.json")

    args = parser.parse_args()
    if args.cmd == "controls":
        run_controls(args)
    else:
        run_orchestrate(args)


if __name__ == "__main__":
    main()
