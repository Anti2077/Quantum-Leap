#!/usr/bin/env bash
set -euo pipefail

APPIMAGE=$(realpath "${1:?Usage: smoke-test-appimage.sh APPIMAGE}")
export APPIMAGE_EXTRACT_AND_RUN=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1

# A virtual display lets the Linux runner verify an actual application window.
timeout --kill-after=5s 45s xvfb-run -a dbus-run-session -- bash -s -- "$APPIMAGE" <<'SH'
set -euo pipefail
log=$(mktemp)
pid=""
cleanup() {
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
  fi
  cat "$log"
  rm -f "$log"
}
trap cleanup EXIT
"$1" >"$log" 2>&1 &
pid=$!
for attempt in $(seq 1 30); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "AppImage exited before displaying its window" >&2
    exit 1
  fi
  if xdotool search --onlyvisible --name '^Quantum Leap$' >/dev/null 2>&1; then
    sleep 2
    kill -0 "$pid"
    echo "AppImage displayed the Quantum Leap window"
    exit 0
  fi
  sleep 1
done
echo "AppImage did not display its window within 30 seconds" >&2
exit 1
SH
