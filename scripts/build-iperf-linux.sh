#!/usr/bin/env bash
set -euo pipefail

IPERF_VERSION="3.21"
IPERF_SHA256="656e4405ebd620121de7ceca3eaf43a88f79ea1b857d041a6a0b1314801acdd8"
IPERF_URL="https://github.com/esnet/iperf/releases/download/${IPERF_VERSION}/iperf-${IPERF_VERSION}.tar.gz"

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "Linux x64 sidecar builds require an x86_64 host; found $(uname -m)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="${IPERF_BUILD_DIR:-${ROOT}/src-tauri/target/iperf-sidecar/linux}"
ARCHIVE="${BUILD_ROOT}/iperf-${IPERF_VERSION}.tar.gz"
SOURCE="${BUILD_ROOT}/iperf-${IPERF_VERSION}"
OUTPUT="${ROOT}/src-tauri/binaries"

mkdir -p "${BUILD_ROOT}" "${OUTPUT}/licenses"
if [[ ! -f "${ARCHIVE}" ]]; then
  curl --fail --location "${IPERF_URL}" --output "${ARCHIVE}"
fi
printf '%s  %s\n' "${IPERF_SHA256}" "${ARCHIVE}" | sha256sum --check --status

rm -rf "${SOURCE}"
tar -xzf "${ARCHIVE}" -C "${BUILD_ROOT}"

(
  cd "${SOURCE}"
  ./configure --enable-static-bin --without-openssl --without-sctp
  make -j"$(getconf _NPROCESSORS_ONLN)"
)

install -m 0755 "${SOURCE}/src/iperf3" "${OUTPUT}/iperf3-x86_64-unknown-linux-gnu"
install -m 0644 "${SOURCE}/LICENSE" "${OUTPUT}/licenses/iperf3-LICENSE"

"${OUTPUT}/iperf3-x86_64-unknown-linux-gnu" --version | grep -F "iperf ${IPERF_VERSION}"
"${OUTPUT}/iperf3-x86_64-unknown-linux-gnu" --help 2>&1 | grep -F -- "--json-stream"
echo "Linux iperf3 sidecar ready: ${OUTPUT}/iperf3-x86_64-unknown-linux-gnu"
