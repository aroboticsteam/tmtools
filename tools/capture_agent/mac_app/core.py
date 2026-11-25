"""Non-UI logic of the Mac tray app: config, Keychain, ffmpeg and device discovery, launch-at-login.

Standard library only, so it is unit tested without rumps or a Mac (`backend/tests/test_capture/test_mac_app_core.py`).
"""
from __future__ import annotations

import json
import os
import plistlib
import re
import shlex
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

APP_NAME = "TMTools Capture"
BUNDLE_ID = "dev.tmtools.capture"
KEYCHAIN_SERVICE = "TMTools Capture agent key"
KEYCHAIN_ACCOUNT = "tmtools"

CONFIG_DIR = Path.home() / "Library" / "Application Support" / APP_NAME
CONFIG_PATH = CONFIG_DIR / "config.json"
LOG_DIR = Path.home() / "Library" / "Logs" / APP_NAME
LOG_PATH = LOG_DIR / "agent.log"
DEFAULT_WORK_DIR = Path.home() / "tmtools-capture" / "capture-data"
LAUNCH_AGENT_PATH = Path.home() / "Library" / "LaunchAgents" / f"{BUNDLE_ID}.plist"
LEGACY_ENV = Path.home() / "tmtools-capture" / ".agent.env"  # written by capture-setup.sh

# GUI apps get a bare PATH, so Homebrew's ffmpeg is not found without these.
FFMPEG_DIRS = ("/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin")
# Capture cards only accept the frame rates their current signal uses; a wrong one fails with
# "Could not lock device for configuration" (same list and order as capture-setup.sh).
FRAME_RATES = ("30", "29.97", "25", "24", "23.976", "60", "59.94", "50", "15")
PIXEL_FORMATS = ("", "uyvy422")


@dataclass
class Config:
    server: str = ""
    video_device: str = ""  # device NAME (numbers shift when e.g. OBS Virtual Camera starts)
    audio_device: str = "none"
    input_args: str = ""  # the ffmpeg input that passed the test recording
    work_dir: str = str(DEFAULT_WORK_DIR)
    keep_local: bool = False
    reencode: bool = True
    video_bitrate: str = "15M"
    insecure: bool = False  # skip TLS verification (venue networks that re-sign HTTPS)
    agent_id: str = field(default_factory=lambda: "mac-" + os.urandom(3).hex())

    @classmethod
    def load(cls, path: Path = CONFIG_PATH) -> "Config":
        try:
            raw = json.loads(path.read_text())
        except (OSError, ValueError):
            return cls()
        known = {k: v for k, v in raw.items() if k in cls.__dataclass_fields__} if isinstance(raw, dict) else {}
        return cls(**known)

    def save(self, path: Path = CONFIG_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2))
        tmp.replace(path)

    @property
    def configured(self) -> bool:
        return bool(self.server and self.input_args)


def parse_legacy_env(text: str) -> dict[str, str]:
    """Reads the `.agent.env` that capture-setup.sh wrote with `printf %q` (shell-quoted `KEY=value` lines)."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        m = re.match(r"\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$", line)
        if not m:
            continue
        try:
            parts = shlex.split(m.group(2))
        except ValueError:
            continue
        out[m.group(1)] = parts[0] if parts else ""
    return out


# ── Keychain (the API key never goes in the config file) ─────────────────

def key_get() -> str:
    r = subprocess.run(["security", "find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def key_set(key: str) -> None:
    subprocess.run(["security", "add-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w", key, "-U"],
                   capture_output=True, text=True, check=True)


# ── ffmpeg and capture devices ───────────────────────────────────────────

def find_ffmpeg(dirs: tuple[str, ...] = FFMPEG_DIRS, which=shutil.which) -> str | None:
    """Full path of ffmpeg (a sibling ffprobe is also required: the agent derives it from this path)."""
    for d in dirs:
        p = Path(d) / "ffmpeg"
        if p.is_file() and os.access(p, os.X_OK) and (Path(d) / "ffprobe").is_file():
            return str(p)
    found = which("ffmpeg")
    if found and Path(found).with_name("ffprobe").is_file():
        return found
    return None


def parse_devices(listing: str) -> dict[str, list[str]]:
    """Parses `ffmpeg -f avfoundation -list_devices true -i ""` into {"video": [names], "audio": [names]}."""
    out: dict[str, list[str]] = {"video": [], "audio": []}
    section = ""
    for line in listing.splitlines():
        if "AVFoundation video devices" in line:
            section = "video"
        elif "AVFoundation audio devices" in line:
            section = "audio"
        elif section:
            m = re.search(r"\]\s+\[(\d+)\]\s+(.+?)\s*$", line)
            if m:
                out[section].append(m.group(2))
    return out


def list_devices(ffmpeg: str) -> dict[str, list[str]]:
    r = subprocess.run([ffmpeg, "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
                       capture_output=True, text=True, timeout=20)
    return parse_devices(r.stderr + r.stdout)


def device_spec(video: str, audio: str, devices: dict[str, list[str]]) -> str:
    """The avfoundation `-i` value. ffmpeg splits it at the first ':', so a name that contains one is passed by its
    (current) number instead; any other name is looked up, so it must still exist."""
    def one(kind: str, name: str) -> str:
        if kind == "audio" and name == "none":
            return "none"
        names = devices[kind]
        if name not in names:
            raise ValueError(f"{kind} device '{name}' is not connected (or is in use by another app)")
        return str(names.index(name)) if ":" in name else name
    return f"{one('video', video)}:{one('audio', audio)}"


def candidate_inputs(spec: str) -> list[str]:
    """ffmpeg input strings to try, best first: every usual frame rate, then again with the UYVY pixel format."""
    return [f"-f avfoundation {pf + ' ' if pf else ''}-framerate {fr} -i {json.dumps(spec)}"
            for pf in ("-pixel_format " + p if p else "" for p in PIXEL_FORMATS) for fr in FRAME_RATES]


def test_input(ffmpeg: str, input_args: str, seconds: int = 3) -> tuple[bool, str]:
    """Records a few seconds with the given input; returns (ok, ffmpeg's complaint)."""
    out = Path(tempfile.mkdtemp(prefix="tmtools-capture-test-")) / "t.mkv"
    try:
        r = subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *shlex.split(input_args), "-t", str(seconds),
             "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", str(out)],
            capture_output=True, text=True, timeout=seconds + 30)
        return (r.returncode == 0 and out.is_file() and out.stat().st_size > 0), r.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "ffmpeg timed out (device busy or no signal)"
    finally:
        shutil.rmtree(out.parent, ignore_errors=True)


def find_working_input(ffmpeg: str, spec: str, on_try=lambda _: None) -> tuple[str | None, str]:
    """First candidate input that records; (None, last error) when none does."""
    err = ""
    for cand in candidate_inputs(spec):
        on_try(cand)
        ok, err = test_input(ffmpeg, cand)
        if ok:
            return cand, ""
    return None, err


# ── launch at login ──────────────────────────────────────────────────────

def launch_agent_plist(app_bundle: str) -> bytes:
    """A LaunchAgent that opens the .app at login (`open` gives it the normal app context, so the camera
    permission and the menu-bar item behave as when double-clicked)."""
    return plistlib.dumps({
        "Label": BUNDLE_ID,
        "ProgramArguments": ["/usr/bin/open", "-a", app_bundle],
        "RunAtLoad": True,
        "KeepAlive": False,
        "ProcessType": "Interactive",
    })


def set_launch_at_login(enabled: bool, app_bundle: str = "", path: Path = LAUNCH_AGENT_PATH) -> None:
    if enabled:
        if not app_bundle:
            raise ValueError("the app bundle path is required to enable launch at login")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(launch_agent_plist(app_bundle))
    else:
        path.unlink(missing_ok=True)


def launch_at_login(path: Path = LAUNCH_AGENT_PATH) -> bool:
    return path.is_file()
