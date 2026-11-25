"""TMTools Capture: a menu-bar app that runs the capture agent (`agent.py`) in the background.

Built into a double-clickable `.app` by `build.sh` (py2app). The agent runs in a thread of this process, so it
needs no separate Python install; only ffmpeg (with ffprobe) must be installed, e.g. `brew install ffmpeg`.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import logging.handlers
import queue
import subprocess
import sys
import threading
from pathlib import Path

import rumps

try:  # bundled by py2app, or running from source next to the agent
    import agent as agent_mod
except ImportError:  # pragma: no cover - source checkout
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    import agent as agent_mod

import core

RES = Path(__file__).resolve().parent
log = logging.getLogger("capture_agent.tray")


def _icon(name: str) -> str | None:
    for base in (Path(sys.argv[0]).resolve().parent.parent / "Resources", RES / "icons"):
        p = base / name
        if p.is_file():
            return str(p)
    return None


def setup_logging() -> None:
    core.LOG_DIR.mkdir(parents=True, exist_ok=True)
    h = logging.handlers.RotatingFileHandler(core.LOG_PATH, maxBytes=2_000_000, backupCount=3)
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(h)


class AgentRunner:
    """Runs one `CaptureAgent` on its own asyncio loop in a thread; stop() finishes a recording in progress."""

    def __init__(self) -> None:
        self.agent: agent_mod.CaptureAgent | None = None
        self.thread: threading.Thread | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.task: asyncio.Task | None = None
        self.crashed = ""

    @property
    def running(self) -> bool:
        return bool(self.thread and self.thread.is_alive())

    def start(self, settings: agent_mod.Settings) -> None:
        if self.running:
            return
        self.crashed = ""
        self.agent = agent_mod.CaptureAgent(settings)
        ready = threading.Event()

        def body() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self.loop = loop
            self.task = loop.create_task(self.agent.run())
            ready.set()
            try:
                loop.run_until_complete(self._supervise(self.agent, self.task))
            except Exception as exc:  # noqa: BLE001
                self.crashed = str(exc) or type(exc).__name__
                log.exception("agent stopped unexpectedly")
            finally:
                loop.close()

        self.thread = threading.Thread(target=body, name="capture-agent", daemon=True)
        self.thread.start()
        ready.wait(5)

    @staticmethod
    async def _supervise(agent: agent_mod.CaptureAgent, task: asyncio.Task) -> None:
        try:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        finally:
            if agent.recorder:  # leave a playable file behind
                with contextlib.suppress(Exception):
                    await agent._stop({"recording_id": agent.recorder.recording_id})
            with contextlib.suppress(Exception):
                await agent.queue.stop()
            with contextlib.suppress(Exception):
                await agent.client.aclose()

    async def _finish_then_cancel(self) -> None:
        """Ends a recording in progress while the server link is still up (so the server learns it stopped and the
        MP4 is queued), then drops the link."""
        a = self.agent
        if a and a.recorder:
            with contextlib.suppress(Exception):
                await a._stop({"recording_id": a.recorder.recording_id})
        if self.task:
            self.task.cancel()

    def stop(self, timeout: float = 90) -> None:
        if self.loop and self.running:
            asyncio.run_coroutine_threadsafe(self._finish_then_cancel(), self.loop)
        if self.thread:
            self.thread.join(timeout)


class TrayApp(rumps.App):
    def __init__(self) -> None:
        super().__init__(core.APP_NAME, icon=_icon("menubar.png"), template=True, quit_button=None)
        self.cfg = core.Config.load()
        self.runner = AgentRunner()
        self.ffmpeg = core.find_ffmpeg()
        self.devices: dict[str, list[str]] = {"video": [], "audio": []}
        self.ui_events: queue.Queue = queue.Queue()  # background threads -> main thread (AppKit is main-thread only)
        self.busy = ""  # shown in the status line while a probe runs

        self.status_item = rumps.MenuItem("Starting…")
        self.toggle_item = rumps.MenuItem("Start capture", callback=self.on_toggle)
        self.setup_item = rumps.MenuItem("Server and API key…", callback=self.on_setup)
        self.video_menu = rumps.MenuItem("Video device")
        self.audio_menu = rumps.MenuItem("Audio device")
        self.keep_item = rumps.MenuItem("Keep recordings after upload", callback=self.on_keep)
        self.insecure_item = rumps.MenuItem("Skip TLS verification (venue network)", callback=self.on_insecure)
        self.login_item = rumps.MenuItem("Launch at login", callback=self.on_login)
        self.menu = [
            self.status_item,
            self.toggle_item,
            None,
            self.setup_item,
            self.video_menu,
            self.audio_menu,
            None,
            self.keep_item,
            self.insecure_item,
            self.login_item,
            None,
            rumps.MenuItem("Open log", callback=lambda _: subprocess.run(["open", str(core.LOG_PATH)])),
            rumps.MenuItem("Open recordings folder", callback=self.on_open_work),
            None,
            rumps.MenuItem("Quit TMTools Capture", callback=self.on_quit),
        ]
        self.sync_toggles()
        self.refresh_devices_async()
        self.timer = rumps.Timer(self.tick, 1)
        self.timer.start()
        if self.cfg.configured and core.key_get() and self.ffmpeg:
            self.start_agent()

    # ── state ────────────────────────────────────────────────────────────

    def sync_toggles(self) -> None:
        self.keep_item.state = int(self.cfg.keep_local)
        self.insecure_item.state = int(self.cfg.insecure)
        self.login_item.state = int(core.launch_at_login())
        self.toggle_item.title = "Stop capture" if self.runner.running else "Start capture"

    def status_text(self) -> tuple[str, str | None]:
        """(status line, menu-bar title)"""
        if not self.ffmpeg:
            return "ffmpeg not found: run `brew install ffmpeg`", "!"
        if self.busy:
            return self.busy, None
        if not self.cfg.server or not core.key_get():
            return "Set the server and API key to begin", "!"
        if not self.cfg.input_args:
            return "Choose a video device to begin", "!"
        r = self.runner
        if not r.running:
            return (f"Stopped ({r.crashed})" if r.crashed else "Stopped"), None
        a = r.agent
        pending = len(a.queue.jobs) if a else 0
        up = f" · {pending} upload{'s' if pending != 1 else ''} queued" if pending else ""
        if a and a.recorder:
            return f"Recording {a.recorder.match_type} {a.recorder.match_number}{up}", "REC"
        if a and a.connected:
            return f"Connected · idle{up}", None
        why = f" ({a.last_error[:60]})" if a and a.last_error else ""
        return f"Connecting to the server…{why}", "!"

    def tick(self, _=None) -> None:
        while True:
            try:
                fn = self.ui_events.get_nowait()
            except queue.Empty:
                break
            try:
                fn()
            except Exception:  # noqa: BLE001
                log.exception("UI event failed")
        text, title = self.status_text()
        self.status_item.title = text
        self.title = title
        self.toggle_item.title = "Stop capture" if self.runner.running else "Start capture"
        self.toggle_item.set_callback(self.on_toggle if self.cfg.configured or self.runner.running else None)

    def on_main(self, fn) -> None:
        self.ui_events.put(fn)

    # ── agent control ────────────────────────────────────────────────────

    def settings(self) -> agent_mod.Settings:
        import shlex
        c = self.cfg
        return agent_mod.Settings(
            server=c.server, key=core.key_get(), input_args=shlex.split(c.input_args), work_dir=Path(c.work_dir),
            ffmpeg=self.ffmpeg or "ffmpeg", reencode=c.reencode, video_bitrate=c.video_bitrate,
            insecure=c.insecure, keep_local=c.keep_local, agent_id=c.agent_id,
        )

    def start_agent(self) -> None:
        import os
        try:  # Python has no CA bundle in a frozen app; use certifi's
            import certifi
            os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        except ImportError:
            pass
        # ffmpeg and ffprobe must be found by the agent and by ffmpeg's own children
        os.environ["PATH"] = ":".join([*core.FFMPEG_DIRS, os.environ.get("PATH", "")])
        self.runner.start(self.settings())
        self.sync_toggles()

    def stop_agent_async(self, then) -> None:
        """Stops the agent off the UI thread (it finishes a recording first), then runs `then` on the main thread."""
        self.busy = "Stopping (finishing any recording)…"

        def go() -> None:
            self.runner.stop()
            self.on_main(then)
        threading.Thread(target=go, daemon=True).start()

    def restart_agent(self) -> None:
        if not (self.cfg.configured and core.key_get() and self.ffmpeg):
            return

        def after() -> None:
            self.busy = ""
            self.start_agent()
        if self.runner.running:
            self.stop_agent_async(after)
        else:
            self.start_agent()

    def on_toggle(self, _) -> None:
        if self.runner.running:
            self.stop_agent_async(self._stopped)
        elif self.cfg.configured:
            self.start_agent()

    def _stopped(self) -> None:
        self.busy = ""
        self.sync_toggles()

    # ── settings ─────────────────────────────────────────────────────────

    def on_setup(self, _) -> None:
        w = rumps.Window("TMTools server address (e.g. https://tmtools.example.com)", "Server", self.cfg.server,
                         ok="Next", cancel="Cancel", dimensions=(340, 24))
        r = w.run()
        if not r.clicked:
            return
        server = r.text.strip().rstrip("/")
        if not server.startswith(("http://", "https://")):
            rumps.alert("Server address", "It must start with https:// (or http:// for a local test).")
            return
        w = rumps.Window("API key (Settings → API keys; needs only the capture:upload permission). "
                         "Leave empty to keep the saved key.", "API key", "", ok="Save", cancel="Cancel",
                         dimensions=(340, 24), secure=True)
        r = w.run()
        if not r.clicked:
            return
        key = r.text.strip()
        try:
            if key:
                core.key_set(key)
        except Exception as exc:  # noqa: BLE001
            rumps.alert("Could not save the key to the Keychain", str(exc))
            return
        self.cfg.server = server
        self.cfg.save()
        self.restart_agent()

    def on_keep(self, item) -> None:
        self.cfg.keep_local = not self.cfg.keep_local
        self.cfg.save()
        self.sync_toggles()
        self.restart_agent()

    def on_insecure(self, item) -> None:
        if not self.cfg.insecure and rumps.alert(
            "Skip TLS verification?", "Only for a venue network that re-signs HTTPS. The server's certificate "
            "will not be checked.", ok="Skip verification", cancel="Cancel") != 1:
            return
        self.cfg.insecure = not self.cfg.insecure
        self.cfg.save()
        self.sync_toggles()
        self.restart_agent()

    def on_login(self, item) -> None:
        try:
            from AppKit import NSBundle
            bundle = str(NSBundle.mainBundle().bundlePath())
            if not bundle.endswith(".app"):
                rumps.alert("Launch at login", "Only available when running as the TMTools Capture app.")
                return
            core.set_launch_at_login(not core.launch_at_login(), bundle)
        except Exception as exc:  # noqa: BLE001
            rumps.alert("Launch at login", str(exc))
        self.sync_toggles()

    def on_open_work(self, _) -> None:
        Path(self.cfg.work_dir).mkdir(parents=True, exist_ok=True)
        subprocess.run(["open", self.cfg.work_dir])

    # ── devices ──────────────────────────────────────────────────────────

    def refresh_devices_async(self) -> None:
        if not self.ffmpeg:
            return

        def go() -> None:
            try:
                devices = core.list_devices(self.ffmpeg)
            except Exception:  # noqa: BLE001
                log.exception("listing capture devices failed")
                return
            self.on_main(lambda: self.build_device_menus(devices))
        threading.Thread(target=go, daemon=True).start()

    def build_device_menus(self, devices: dict[str, list[str]]) -> None:
        self.devices = devices
        for menu, kind, current in ((self.video_menu, "video", self.cfg.video_device),
                                    (self.audio_menu, "audio", self.cfg.audio_device)):
            with contextlib.suppress(Exception):
                menu.clear()
            names = (["none"] if kind == "audio" else []) + devices[kind]
            for n in names:
                it = rumps.MenuItem(n, callback=self.on_pick_audio if kind == "audio" else self.on_pick_video)
                it.state = int(n == current)
                menu.add(it)
            if not names:
                menu.add(rumps.MenuItem("No devices found", callback=None))
            menu.add(None)
            menu.add(rumps.MenuItem("Refresh list", callback=lambda _: self.refresh_devices_async()))

    def on_pick_video(self, item) -> None:
        self.choose_device(video=item.title, audio=self.cfg.audio_device)

    def on_pick_audio(self, item) -> None:
        if not self.cfg.video_device:
            rumps.alert("Audio device", "Choose the video device first.")
            return
        self.choose_device(video=self.cfg.video_device, audio=item.title)

    def choose_device(self, video: str, audio: str) -> None:
        """Test-records with every usual frame rate until one works, then saves it (the first test also triggers
        macOS's camera permission prompt for this app)."""
        was_running = self.runner.running
        self.busy = f"Testing {video}…"

        def go() -> None:
            try:
                if was_running:
                    self.runner.stop()  # the device can only be opened once
                devices = core.list_devices(self.ffmpeg)
                spec = core.device_spec(video, audio, devices)

                def progress(cand: str) -> None:
                    self.busy = "Testing: " + cand.split("-framerate ")[1].split(" ")[0] + " fps…"
                found, err = core.find_working_input(self.ffmpeg, spec, progress)
            except Exception as exc:  # noqa: BLE001
                found, err = None, str(exc)
                devices = self.devices

            def done() -> None:
                self.busy = ""
                self.build_device_menus(devices)
                if found:
                    self.cfg.video_device, self.cfg.audio_device, self.cfg.input_args = video, audio, found
                    self.cfg.save()
                    self.build_device_menus(devices)
                    rumps.alert("Capture device ready", f"Recorded 3 s from {video}.\n\n{found}")
                else:
                    rumps.alert("Could not record from that device",
                                f"{err or 'No frame rate worked.'}\n\nCheck the card has a signal, that no other app "
                                "(OBS, FaceTime) is using it, and that TMTools Capture is allowed in System Settings → "
                                "Privacy & Security → Camera.")
                self.restart_agent() if (found or was_running) else None
            self.on_main(done)
        threading.Thread(target=go, daemon=True).start()

    # ── quit ─────────────────────────────────────────────────────────────

    def on_quit(self, _) -> None:
        a = self.runner.agent
        if self.runner.running and a and a.recorder:
            if rumps.alert("A match is recording", "Quit now? The recording is finished and queued for upload first.",
                           ok="Finish and quit", cancel="Keep recording") != 1:
                return
        self.timer.stop()
        self.runner.stop()
        rumps.quit_application()


def import_legacy_setup(cfg: core.Config) -> bool:
    """First launch only: adopt the server/key/device that capture-setup.sh saved, so nobody re-enters them."""
    if cfg.server or not core.LEGACY_ENV.is_file():
        return False
    env = core.parse_legacy_env(core.LEGACY_ENV.read_text())
    if not env.get("TMTOOLS_SERVER") or not env.get("CAPTURE_INPUT"):
        return False
    cfg.server = env["TMTOOLS_SERVER"]
    cfg.input_args = env["CAPTURE_INPUT"]
    if env.get("CAPTURE_WORK_DIR"):
        cfg.work_dir = env["CAPTURE_WORK_DIR"]
    if env.get("TMTOOLS_AGENT_KEY") and not core.key_get():
        core.key_set(env["TMTOOLS_AGENT_KEY"])
    cfg.save()
    return True


def main() -> None:
    setup_logging()
    cfg = core.Config.load()
    with contextlib.suppress(Exception):
        import_legacy_setup(cfg)
    TrayApp().run()


if __name__ == "__main__":
    main()
