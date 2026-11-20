#!/usr/bin/env bash
# Guided setup for the TMTools capture agent (macOS or Linux AV laptop).
#
#   cd tools/capture_agent && ./setup.sh
#
# Checks ffmpeg and Python, installs the agent into a local virtualenv, asks for the
# server URL and the API key (hidden), lets you pick the capture device, makes a
# 3 second test recording, then writes `.agent.env` (mode 600) and `run.sh`.
# Start the agent afterwards with `./run.sh`. Safe to re-run; it offers the saved values.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".agent.env"
DEFAULT_SERVER="https://tmtools.qerobotics.co.uk"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m  %s\n' "$*"; }
warn() { printf '  \033[33m!!\033[0m  %s\n' "$*"; }
die()  { printf '\n\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

saved() { [ -f "$ENV_FILE" ] && (set +u; . "./$ENV_FILE"; eval "printf '%s' \"\${$1:-}\""); true; }

OS="$(uname -s)"
case "$OS" in Darwin|Linux) ;; *) die "this script supports macOS and Linux (the agent needs POSIX signal handling); got $OS" ;; esac

say "1/6  Prerequisites"
command -v ffmpeg  >/dev/null || die "ffmpeg not found. macOS: brew install ffmpeg   Linux: sudo apt install ffmpeg"
command -v ffprobe >/dev/null || die "ffprobe not found (it ships with ffmpeg)"
ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"
PY="$(command -v python3.12 || command -v python3.11 || command -v python3.10 || command -v python3 || true)"
[ -n "$PY" ] || die "Python 3.10+ not found. macOS: brew install python   Linux: sudo apt install python3 python3-venv"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || die "$PY is too old; need Python 3.10+"
ok "$("$PY" --version) ($PY)"

say "2/6  Install the agent"
[ -d .venv ] || "$PY" -m venv .venv || die "could not create a virtualenv (Linux: sudo apt install python3-venv)"
.venv/bin/pip install -q --disable-pip-version-check -r requirements.txt
.venv/bin/python -c 'import httpx, websockets' && ok "dependencies installed in tools/capture_agent/.venv"

say "3/6  Server and API key"
SERVER="$(saved TMTOOLS_SERVER)"; SERVER="${SERVER:-$DEFAULT_SERVER}"
read -r -p "  TMTools server URL [$SERVER]: " ANS; SERVER="${ANS:-$SERVER}"; SERVER="${SERVER%/}"
case "$SERVER" in http://*|https://*) ;; *) die "the URL must start with http:// or https://" ;; esac
if curl -fsS --max-time 8 -o /dev/null "$SERVER/healthz" 2>/dev/null; then ok "server reachable at $SERVER"
else warn "could not reach $SERVER/healthz from this laptop (wrong URL, VPN/LAN, or certificate?). Continuing."; fi
KEY="$(saved TMTOOLS_AGENT_KEY)"
echo "  Create the key in TMTools: Settings -> API keys -> only the capture:upload permission."
if [ -n "$KEY" ]; then
  read -r -s -p "  API key [keep the saved one, Enter]: " ANS; echo; KEY="${ANS:-$KEY}"
else
  read -r -s -p "  API key: " KEY; echo
fi
[ -n "$KEY" ] || die "an API key is required"

say "4/6  Capture device"
INPUT=""
if [ "$OS" = Darwin ]; then
  LIST="$(ffmpeg -hide_banner -f avfoundation -list_devices true -i "" 2>&1 || true)"
  echo "  Video devices:"; echo "$LIST" | awk '/video devices:/{v=1;next} /audio devices:/{v=0} v' | sed 's/^.*\] \[/    [/'
  echo "  Audio devices:"; echo "$LIST" | awk '/audio devices:/{a=1;next} a' | sed 's/^.*\] \[/    [/'
  read -r -p "  Video device number (e.g. the Blackmagic/ATEM capture): " V
  read -r -p "  Audio device number, or 'none' [none]: " A; A="${A:-none}"
  case "$V" in ''|*[!0-9]*) die "video device must be a number" ;; esac
  INPUT="-f avfoundation -framerate 30 -i \"$V:$A\""
else
  echo "  Video devices:"; ls /dev/video* 2>/dev/null | sed 's/^/    /' || true
  read -r -p "  Video device [/dev/video0]: " V; V="${V:-/dev/video0}"
  [ -e "$V" ] || die "$V does not exist"
  INPUT="-f v4l2 -i $V"
fi
ok "ffmpeg input: $INPUT"

say "5/6  Test recording (3 s)"
TEST="$(mktemp -t tmtools-capture-test.XXXXXX).mkv"
# shellcheck disable=SC2086  # INPUT is a deliberate word-split ffmpeg argument string
if eval ffmpeg -hide_banner -loglevel error -y $INPUT -t 3 -c:v libx264 -preset veryfast -pix_fmt yuv420p "$TEST" && [ -s "$TEST" ]; then
  ok "recorded $(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of csv=p=0 "$TEST" | tr ',' ' ') (width height fps)"
  rm -f "$TEST"
else
  rm -f "$TEST"
  die "the test recording failed. On macOS, allow your terminal under System Settings -> Privacy & Security -> Camera, then re-run."
fi

say "6/6  Save"
umask 077
{
  printf 'TMTOOLS_SERVER=%q\n' "$SERVER"
  printf 'TMTOOLS_AGENT_KEY=%q\n' "$KEY"
  printf 'CAPTURE_INPUT=%q\n' "$INPUT"
  printf 'CAPTURE_WORK_DIR=%q\n' "$PWD/capture-data"
} > "$ENV_FILE"
cat > run.sh <<'RUN'
#!/usr/bin/env bash
# Start the capture agent with the saved settings. Extra flags go to agent.py
# (e.g. ./run.sh --keep-local, --no-reencode, --video-bitrate 20M).
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.agent.env; set +a
exec .venv/bin/python agent.py "$@"
RUN
chmod 700 run.sh
printf 'capture-data/\n.venv/\n.agent.env\n' > .gitignore
ok "wrote $ENV_FILE (private, holds the key) and run.sh"

say "Done. Start the agent with:"
echo "    ./run.sh"
echo "  It should appear in TMTools (Integrations -> capture) within a few seconds."
read -r -p "  Start it now? [y/N] " GO
[ "${GO:-n}" = y ] || [ "${GO:-n}" = Y ] && exec ./run.sh
exit 0
