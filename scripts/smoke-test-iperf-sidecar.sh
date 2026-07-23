#!/usr/bin/env bash
set -euo pipefail

BIN="${1:?usage: smoke-test-iperf-sidecar.sh /path/to/iperf3}"
PORT="${IPERF_SMOKE_PORT:-45201}"
EXPECTED_VERSION="${IPERF_EXPECTED_VERSION:-3.21}"
STAGING="$(mktemp -d)"
OUTPUT="$(mktemp)"
SERVER_PID=""
cleanup() {
  [[ -n "${SERVER_PID}" ]] && kill "${SERVER_PID}" 2>/dev/null || true
  rm -rf "${STAGING}"
  rm -f "${OUTPUT}"
}
trap cleanup EXIT

install -m 0755 "${BIN}" "${STAGING}/iperf3"
BIN="${STAGING}/iperf3"
VERSION_OUTPUT="$(PATH=/usr/bin:/bin "${BIN}" --version 2>&1)"
grep -F "iperf ${EXPECTED_VERSION}" <<<"${VERSION_OUTPUT}"

PATH=/usr/bin:/bin "${BIN}" -s -1 -p "${PORT}" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 0.3
PATH=/usr/bin:/bin "${BIN}" -c 127.0.0.1 -p "${PORT}" --json-stream -t 1 -P 1 >"${OUTPUT}"
wait "${SERVER_PID}"
SERVER_PID=""
grep -F '"event":"interval"' "${OUTPUT}"
echo "iperf3 sidecar loopback smoke test passed"
