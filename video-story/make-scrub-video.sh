#!/usr/bin/env bash
# Turns your generated clips into one scroll-scrubbable video.
# Scrubbing needs EVERY frame to be a keyframe (-g 1), otherwise seeking stutters.
#
#   bash make-scrub-video.sh clip1.mp4 clip2.mp4 clip3.mp4 ...
#
# Output: assets/story.mp4 (H.264, all-intra) and assets/poster.jpg.
# Options (environment variables):
#   WIDTH=1280   output width (1920 looks sharper but the file gets much bigger)
#   CRF=24       quality, lower = better and bigger
#   WEBM=1       also write assets/story.webm (slow to encode)
# All-intra files are large: about 10 MB per 12 s at 1280 px. Keep the whole story under ~30 s.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: bash $0 clip1.mp4 [clip2.mp4 ...]"; exit 1; }
WIDTH="${WIDTH:-1280}"; CRF="${CRF:-24}"
mkdir -p assets
list=$(mktemp)
for f in "$@"; do echo "file '$(realpath "$f")'" >> "$list"; done

ffmpeg -hide_banner -loglevel error -stats -y -f concat -safe 0 -i "$list" \
  -vf "scale=${WIDTH}:-2:flags=lanczos,fps=30,format=yuv420p" \
  -c:v libx264 -g 1 -keyint_min 1 -crf "$CRF" -preset slow -movflags +faststart -an assets/story.mp4

ffmpeg -hide_banner -loglevel error -y -i assets/story.mp4 -frames:v 1 -q:v 2 assets/poster.jpg

if [ "${WEBM:-0}" = "1" ]; then
  ffmpeg -hide_banner -loglevel error -stats -y -i assets/story.mp4 -c:v libvpx-vp9 -g 1 -crf 34 -b:v 0 -row-mt 1 -an assets/story.webm
  echo "WebM written. Add it as a <source> before the mp4 in index.html."
fi
echo "Done: assets/story.mp4"
