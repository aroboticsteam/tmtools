# Capture agent

Runs on the AV laptop that receives the ATEM program/camera feed (issue #45). It
records matches with ffmpeg, cuts instant-replay clips on request and uploads
everything to the object store. It talks **only to the TMTools server**: commands
arrive over `/ws/agent`, uploads go through presigned PUT URLs the server issues.
It is not involved in playback (OBS plays clips from a browser source), and it may
run on a different machine from OBS.

## Quick setup (macOS / Linux)

`capture-setup.sh` is one self-contained file (the agent is embedded in it). Copy it to the
AV laptop and run it from anywhere:

```bash
bash capture-setup.sh
```

First run: checks ffmpeg/Python, installs into `~/tmtools-capture` (override with
`TMTOOLS_CAPTURE_DIR`), asks for the server URL and API key (hidden), lets you pick the capture
device, test-records 3 s, saves everything to `.agent.env` (mode 600) and starts the agent.
Every later run reuses the saved setup with no questions, refreshes the agent code and starts
it. Extra flags go to the agent (`bash capture-setup.sh --keep-local`); `--reconfigure` redoes
the questions. `~/tmtools-capture/run.sh` starts the agent directly. After editing `agent.py`
run `python3 tools/capture_agent/build_setup.py` to re-embed it (a test checks they match).

## Setup (manual)

1. Install [ffmpeg](https://ffmpeg.org/) (with `ffprobe`) and Python 3.10+.
2. `pip install -r requirements.txt`
3. In TMTools **Settings → API keys**, create a key with only the **`capture:upload`**
   permission and copy it.
4. Find the ffmpeg input for the feed, e.g.
   - macOS: `ffmpeg -f avfoundation -list_devices true -i ""` → `-f avfoundation -framerate 30 -i "0:none"`
   - Windows: `ffmpeg -list_devices true -f dshow -i dummy` → `-f dshow -i video="Blackmagic WDM Capture"`
   - Linux: `-f v4l2 -i /dev/video0`
5. Run it:

```bash
python agent.py --server https://tm.example.com --key tmt_... --input "-f avfoundation -framerate 30 -i 0:none"
```

`TMTOOLS_SERVER`, `TMTOOLS_AGENT_KEY`, `CAPTURE_INPUT` and `CAPTURE_WORK_DIR` can be used instead of flags.

## Settings

| Flag | Default | Meaning |
|---|---|---|
| `--reencode` / `--no-reencode` | on | On: H.264 at `--video-bitrate` with 1 s keyframes (~41 GB for 245 IQ matches at 15 Mbps). Off: stream copy of the feed as-is (can be ~190 GB at ~70 Mbps). Clips are always re-encoded. |
| `--video-bitrate` | `15M` | Target bitrate when re-encoding |
| `--work-dir` | `./capture-data` | Local recordings and the upload queue (`queue.json`) |
| `--keep-local` | off | Keep recordings on disk after upload. By default each file is deleted once the object store has it and the server has confirmed it, and the recording's folder goes with the last file. The `master.mkv` is deleted as soon as the MP4 is made. Env: `CAPTURE_KEEP_LOCAL=1` |
| `--agent-id` | random | Shown in the deck |

## How it behaves

- **Local first.** Each match is written to `work-dir/<recording id>/master.mkv` (Matroska, safe to read while growing), then remuxed to a `+faststart` `match.mp4` when the match ends (the master is then deleted, since the MP4 is a copy of it).
- **Clips.** `mark` cuts the last *N* seconds into a standalone MP4 about 1.5 s after the mark (so the tail is flushed) and uploads it immediately; the target is a playable clip within ~10 s.
- **Priorities.** Clip upload and match-file upload run on separate workers, so a clip never waits behind a multi-GB match file, and uploads never touch the running recording.
- **Resilience.** The upload queue is persisted and retried with backoff, so a dropped venue connection or a restart loses nothing. The WebSocket reconnects automatically; a recording in progress continues while it is down.
- **Disk use.** Local files are deleted after a confirmed upload, so the work dir only holds what is recording or still waiting to upload (a few GB during an outage, not the whole event). Pass `--keep-local` to keep everything.
- **Layout in the bucket.** `{matchType}/{matchNumber}/match.mp4` and `{matchType}/{matchNumber}/segments/moment-N.mp4`. Clear between events from the server (`DELETE /api/v1/capture/recordings`).
- Ctrl-C finishes and queues the current recording before exiting.

## Tests

`backend/tests/test_capture/test_agent_tool.py` records a synthetic `lavfi` source and uploads it to the real object store through the real API.
