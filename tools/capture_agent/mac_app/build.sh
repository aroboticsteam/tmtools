#!/usr/bin/env bash
# Builds "TMTools Capture.app" (menu-bar app) and a zip of it into ./dist. macOS only.
#   bash build.sh            # needs Python 3.10-3.13 (python3.13 from Homebrew is fine)
# The app is ad-hoc signed, not notarized: on first open use right-click -> Open (see README).
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3.13 python3.12 python3.11 python3.10 python3; do command -v "$c" >/dev/null && { PY="$c"; break; }; done
fi
[ -n "$PY" ] || { echo "no python3 found"; exit 1; }
VENV="${BUILD_VENV:-.build-venv}"
"$PY" -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r requirements-build.txt
# the agent is bundled from the parent directory (one source of truth)
cp ../agent.py ./agent.py
trap 'rm -f ./agent.py' EXIT
"$VENV/bin/python" make_icons.py
rm -rf build dist
"$VENV/bin/python" setup.py py2app >build.log 2>&1 || { tail -40 build.log; echo "build failed (full log: mac_app/build.log)"; exit 1; }
APP="dist/TMTools Capture.app"
codesign --force --deep --sign - "$APP"
(cd dist && ditto -c -k --keepParent "TMTools Capture.app" "TMTools-Capture.zip")
echo "built: $APP"
echo "zip:   dist/TMTools-Capture.zip"
