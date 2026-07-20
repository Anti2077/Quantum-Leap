# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An iperf3 network bandwidth testing desktop GUI implemented with Tauri 2, Rust, React, and TypeScript:

- **`src-tauri/` + `src/`** — Tauri 2 (Rust) + Vite + React 18 + TypeScript + Tailwind CSS + framer-motion

UI is a dark glass-morphism (glassmorphism) design with animated SVG energy links, fluid area charts, and spring-animated number tickers.

## Commands

```bash
npm run dev           # Vite dev server on port 1420 (no Rust backend)
npm run tauri:dev     # Full Tauri dev mode (Vite + Rust backend)
npm run tauri:build   # Production macOS bundle
npm run build         # Vite production build only
npm run preview       # Preview Vite production build
```

There are currently **no tests** in this repository.

## Architecture (Tauri version)

### Rust Backend (`src-tauri/src/main.rs`)

Single file, ~430 lines. Two Tauri commands plus two helper functions:

- `start_speed_test` — Accepts `{ host, port, username, password, direction }`, SSHes into the remote host via `ssh2` crate, starts `iperf3 -s -p <port>` in the background via `nohup`, captures its PID, then spawns `iperf3 -c <host> -p <port> --json-stream -i 1` locally. Parses each JSON line to extract bandwidth, latency, jitter, retransmits. Emits Tauri events `speed://sample` (per-second metrics) and `speed://state` (phase: starting/running/completed/cancelled/failed). On cancel or completion, SSHes back to kill the remote iperf3 server.
- `stop_speed_test` — Sets a `tokio::sync::Notify` cancel token, kills the local iperf3 process via `kill -TERM`, cleans up remote server.
- Global state is an `Arc<Mutex<Option<ActiveSession>>>` managed by Tauri — only one test can run at a time.
- Download tests use the `-R` (reverse) flag on the local iperf3 client.
- JSON parsing (`parse_sample`, `parse_state_line`) handles both single-interval `interval.sum` and array `intervals[0].sum` formats, plus `sum_received`/`sum_sent` variants.

### React Frontend

```
src/
├── main.tsx              # React 18 createRoot entry
├── App.tsx               # Renders <GlassShell />
├── styles.css            # Tailwind directives + body defaults (dark bg, overflow hidden)
├── lib/
│   ├── api.ts            # Thin wrappers: invoke("start_speed_test", { payload }), invoke("stop_speed_test")
│   ├── types.ts          # SpeedTestRequest, SpeedSample, SpeedStateEvent, TransferDirection
│   └── format.ts         # formatBandwidth (bps→Gbps/Mbps/Kbps), formatLatency
├── utils/cn.ts           # className concatenation helper
└── components/
    ├── SpeedWorkbench.tsx  # Main screen: SSH form + live chart + status
    ├── GlassPanel.tsx      # Frosted-glass container (rounded-[2rem], backdrop-blur-3xl, border white/10)
    ├── GlassShell.tsx      # Thin wrapper → SpeedWorkbench
    ├── FluidAreaChart.tsx  # recharts AreaChart with gradient fill, 450ms animation
    ├── EnergyLink.tsx      # SVG animated dashed path between form and chart, direction-aware
    ├── NumberTicker.tsx    # Animated number with spring transition and blur entrance
    └── MacGlyph.tsx        # Decorative frosted-glass orb with glowing dots
```

**Event flow**: Frontend calls `startSpeedTest()` → Rust spawns iperf3, emits `speed://state` and `speed://sample` events → `SpeedWorkbench` listens via `@tauri-apps/api/event` `listen()`, updates React state (latest sample, rolling 49-sample window for chart).

**Tauri config** (`tauri.conf.json`): Window 1440×980, no native decorations (`decorations: false`), `titleBarStyle: "Overlay"`, macOS 13.0+ minimum.

## Key Design Decisions

- The app does **not bundle iperf3** — it expects `iperf3` to be available on both the local machine and the remote host's `$PATH`.
- SSH authentication is handled by the Rust backend through the `ssh2` library.
- The remote iperf3 server runs on a user-specified port; the app uses the same port for SSH (22) and iperf3 traffic — these are independently configurable in the form but the `port` field in the Tauri frontend controls the iperf3 port only (SSH always uses port 22).
