#!/bin/sh
# Generates the placeholder replay clip for the Pages demo (no binary is committed).
# Usage: scripts/make-demo-clip.sh <output.mp4>
set -e
out="${1:?output path}"
mkdir -p "$(dirname "$out")"
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=8" \
  -vf "drawtext=text='DEMO REPLAY':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=60:box=1:boxcolor=black@0.5" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$out" 2>/dev/null || \
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=8" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$out"
