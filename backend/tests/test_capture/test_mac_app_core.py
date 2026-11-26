"""The Mac tray app's non-UI logic (`tools/capture_agent/mac_app/core.py`): stdlib only, so it runs anywhere."""
from __future__ import annotations

import importlib.util
import plistlib
import sys
from pathlib import Path

import pytest

CORE = Path(__file__).resolve().parents[3] / "tools" / "capture_agent" / "mac_app" / "core.py"
spec = importlib.util.spec_from_file_location("mac_app_core", CORE)
core = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules["mac_app_core"] = core  # dataclasses look the module up by name
spec.loader.exec_module(core)

LISTING = """\
[AVFoundation indev @ 0x1] AVFoundation video devices:
[AVFoundation indev @ 0x1] [0] FaceTime HD Camera
[AVFoundation indev @ 0x1] [1] Blackmagic: UltraStudio
[AVFoundation indev @ 0x1] [2] OBS Virtual Camera
[AVFoundation indev @ 0x1] AVFoundation audio devices:
[AVFoundation indev @ 0x1] [0] MacBook Pro Microphone
[AVFoundation indev @ 0x1] [1] Blackmagic Audio
"""


def test_parse_devices_splits_video_and_audio() -> None:
    d = core.parse_devices(LISTING)
    assert d["video"] == ["FaceTime HD Camera", "Blackmagic: UltraStudio", "OBS Virtual Camera"]
    assert d["audio"] == ["MacBook Pro Microphone", "Blackmagic Audio"]


def test_device_spec_uses_names_but_numbers_for_names_with_a_colon() -> None:
    d = core.parse_devices(LISTING)
    assert core.device_spec("FaceTime HD Camera", "none", d) == "FaceTime HD Camera:none"
    assert core.device_spec("Blackmagic: UltraStudio", "Blackmagic Audio", d) == "1:Blackmagic Audio"


def test_device_spec_rejects_a_missing_device() -> None:
    d = core.parse_devices(LISTING)
    with pytest.raises(ValueError, match="not connected"):
        core.device_spec("Gone Camera", "none", d)


def test_candidate_inputs_try_every_frame_rate_then_uyvy() -> None:
    c = core.candidate_inputs("Cam:none")
    assert c[0] == '-f avfoundation -framerate 30 -i "Cam:none"'
    assert len(c) == 2 * len(core.FRAME_RATES)
    assert c[len(core.FRAME_RATES)] == '-f avfoundation -pixel_format uyvy422 -framerate 30 -i "Cam:none"'


def test_config_roundtrip_and_unknown_keys_are_ignored(tmp_path: Path) -> None:
    p = tmp_path / "c.json"
    cfg = core.Config(server="https://tm.example.com", input_args="-f avfoundation -i x", keep_local=True)
    cfg.save(p)
    back = core.Config.load(p)
    assert back.server == cfg.server and back.keep_local and back.configured
    p.write_text('{"server": "s", "future_option": 1}')
    assert core.Config.load(p).server == "s"
    p.write_text("not json")
    assert not core.Config.load(p).configured


def test_parse_legacy_env_reads_printf_q_output() -> None:
    env = core.parse_legacy_env(
        "TMTOOLS_SERVER=https://tm.example.com\n"
        "TMTOOLS_AGENT_KEY=tmt_abc\\$def\n"
        "CAPTURE_INPUT=-f\\ avfoundation\\ -framerate\\ 30\\ -i\\ \\\"Cam:none\\\"\n"
        "CAPTURE_WORK_DIR=/Users/x/my\\ dir/capture-data\n"
    )
    assert env["TMTOOLS_SERVER"] == "https://tm.example.com"
    assert env["TMTOOLS_AGENT_KEY"] == "tmt_abc$def"
    assert env["CAPTURE_INPUT"] == '-f avfoundation -framerate 30 -i "Cam:none"'
    assert env["CAPTURE_WORK_DIR"] == "/Users/x/my dir/capture-data"


def test_launch_at_login_writes_and_removes_a_launch_agent(tmp_path: Path) -> None:
    p = tmp_path / "LaunchAgents" / "x.plist"
    assert not core.launch_at_login(p)
    core.set_launch_at_login(True, "/Applications/TMTools Capture.app", p)
    assert core.launch_at_login(p)
    data = plistlib.loads(p.read_bytes())
    assert data["ProgramArguments"] == ["/usr/bin/open", "-a", "/Applications/TMTools Capture.app"]
    assert data["RunAtLoad"] is True
    core.set_launch_at_login(False, path=p)
    assert not core.launch_at_login(p)
    with pytest.raises(ValueError):
        core.set_launch_at_login(True, "", p)


def test_find_ffmpeg_needs_ffprobe_beside_it(tmp_path: Path) -> None:
    (tmp_path / "ffmpeg").write_text("#!/bin/sh\n")
    (tmp_path / "ffmpeg").chmod(0o755)
    assert core.find_ffmpeg((str(tmp_path),), which=lambda _: None) is None
    (tmp_path / "ffprobe").write_text("#!/bin/sh\n")
    assert core.find_ffmpeg((str(tmp_path),), which=lambda _: None) == str(tmp_path / "ffmpeg")
