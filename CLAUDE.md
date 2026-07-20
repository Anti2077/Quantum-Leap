# CLAUDE.md

This file provides guidance for coding agents working in this repository.

## Project Overview

Quantum Leap is a macOS iperf3 bandwidth testing GUI built with Tauri 2, Rust, React 18, and TypeScript. The Tauri application under `src-tauri/` and `src/` is the only maintained implementation.

## Commands

```bash
npm run dev           # Vite frontend on port 1420
npm run tauri:dev     # Full Tauri application
npm run build         # Frontend production build
npx tsc --noEmit      # TypeScript check
npm run tauri:build   # macOS app and DMG

cd src-tauri
cargo test --locked
cargo clippy --locked -- -D warnings
```

## Rust Backend

- `main.rs`: Tauri commands, single-session state, prompts, cancellation, and cleanup orchestration.
- `model.rs`: request validation, connection/test modes, and event models.
- `ssh.rs`: password/private-key SSH authentication, known-host checks, remote iperf3 startup, package-manager detection, and verified cleanup.
- `iperf.rs`: local iperf3/ping processes, JSON-stream parsing, live samples, and connection error classification.
- `saved_server.rs`: saved-server metadata and macOS Keychain secrets.

The app supports two server modes:

- `sshManaged`: starts a temporary remote server over SSH, optionally reuses an occupied port after confirmation, and cleans up only the process it manages.
- `existing`: connects directly to a persistent iperf3 service without SSH and never stops that service.

## React Frontend

- `SpeedWorkbench.tsx`: connection and test forms, state machine, prompts, saved servers, live metrics, and result views.
- `ComparisonChart.tsx` and `FluidAreaChart.tsx`: completed and live bandwidth charts.
- `ParticleCanvas.tsx` and `EnergyLink.tsx`: animated data-flow visualization.
- `src/lib/api.ts`: Tauri command wrappers.
- `src/lib/types.ts`: frontend request/event contracts mirrored by Rust models.

Frontend calls `start_speed_test`; Rust emits `speed://state`, `speed://sample`, and `speed://prompt`. Keep TypeScript field names aligned with Rust `camelCase` serialization.

## Key Constraints

- Local iperf3 must support `--json-stream` (3.17+).
- Passwords and private-key passphrases belong in process memory or macOS Keychain, never ordinary config files or logs.
- Existing remote services must never be terminated. Managed cleanup must verify PID, server mode, and port before signaling a process.
- Host-key mismatch and occupied-port reuse require explicit user confirmation.
