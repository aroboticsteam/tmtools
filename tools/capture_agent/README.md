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
it. On macOS the script tries several frame rates until one works (capture cards only accept their signal's rate). Extra flags go to the agent (`bash capture-setup.sh --keep-local`); `--reconfigure` redoes
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
- **Crash recovery.** If the agent or the laptop dies mid-match, the next start remuxes the leftover `master.mkv` (Matroska is readable while growing) and uploads it, and the server closes the recording that was marked live. Only the last moment or two before the crash can be missing.
- Ctrl-C finishes and queues the current recording before exiting.

## Tests

`backend/tests/test_capture/test_agent_tool.py` records a synthetic `lavfi` source and uploads it to the real object store through the real API.

## TLS verification (`CERTIFICATE_VERIFY_FAILED`)

`capture-setup.sh` currently starts the agent with `CAPTURE_INSECURE=1` (certificate checks off) as a
stopgap for a `CERTIFICATE_VERIFY_FAILED` seen on a venue network. **That default is unchanged and
deliberately not decided here.** The cause was not reproduced on that network; the usual ones, in order:

1. **Python has no CA bundle** (python.org builds on macOS). The script already points
   `SSL_CERT_FILE` at `certifi`'s bundle, which fixes this case.
2. **The network intercepts TLS** (a captive proxy or firewall re-signs HTTPS with its own CA, which
   no system trusts). Check who signed what the agent sees:
   `openssl s_client -connect <server-host>:443 -showcerts </dev/null | grep -E 'issuer|subject'`.
   If the issuer is the venue's, trust that CA instead of disabling checks: put its PEM path in
   `.agent.env` as `SSL_CERT_FILE=/path/ca.pem` (a bundle that also contains the normal roots) and set
   `CAPTURE_INSECURE=0`.
3. **The server presents a self-signed or incomplete chain** (a LAN stack without a real certificate).
   Same fix: trust that CA, or serve a proper chain.

To turn verification on now: add `CAPTURE_INSECURE=0` to `.agent.env`.

## Capture device

The setup script saves the device by **name** (the numbers shift when OBS Virtual Camera or another
camera starts or stops). If recording cannot open it, the agent reports "capture device busy" (another
app is using it, no signal, wrong frame rate) or "capture device missing" (unplugged or renamed; re-run
`bash capture-setup.sh --reconfigure`). A name containing `:` can only be saved by number.
