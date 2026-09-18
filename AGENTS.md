# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Lerna monorepo containing the Variocube Cube App SDK - a toolkit for developing web applications that run on Variocube smart lockers. The SDK enables web apps to communicate with locker hardware (locks, barcode readers, keypads, NFC readers) over an authenticated WebSocket connection to the locker controller.

## Common Commands

```bash
# Install dependencies
npm ci

# Build all packages
npm run build

# Development mode (watch all packages)
npm run dev

# Run tests
npm run test

# Type-check packages, demo and tests
npm run typecheck

# Opt-in real-controller acceptance (see test/README.md)
npm run test:controller

# Format code with dprint
npx dprint fmt

# Check formatting
npx dprint check

# Start a controller for development (see test/README.md)
variocube-controller dev --fixture single --listen 127.0.0.1:9000 --state /tmp/sdk-controller

# Release new version
./release.sh
```

### Package-specific commands

```bash
# Build/dev specific package
cd packages/cube-app-sdk && npm run build
cd packages/cube-app-demo && npm run dev     # Vite dev server
```

## Architecture

### Package Structure

- **cube-app-sdk** (`@variocube/cube-app-sdk`): Core SDK providing the `connect()` function and `Cube` interface for locker communication
- **cube-app-react-sdk** (`@variocube/cube-app-react-sdk`): React wrapper with `CubeProvider` context and hooks (`useCube`, `useCompartments`, `useLocks`, `useCodeEvent`, etc.)
- **cube-app-demo**: Demo application showcasing SDK features (private, deployed to GitHub Pages)

### Communication Flow

```
Web App (SDK) ←→ authenticated /app WebSocket ←→ Locker Controller (controller-rs)
```

The SDK uses VCMP (Variocube Communication Protocol) over WebSocket, connecting directly to the controller on port
9000. The Node gateway service that used to sit in between was removed once `controller-rs` absorbed its
functionality; hardware simulation for development comes from the controller's own `dev --fixture` mode.

### Key Types

- `Cube`: Main interface for locker interaction (open locks, receive events)
- `Compartment`: Describes a locker compartment with lock assignments
- `Device`: Hardware devices (BarcodeReader, Keypad, NfcReader, etc.)
- `LockStatus`: "OPEN" | "CLOSED" | "BREAKIN" | "BLOCKED"
- Events (`CubeEventMap`): hardware events plus `connection`, `identity`, `occupancies`, lifecycle events, and `storage`
- `cube.occupancies`: controller-owned reservation/confirmation/cancellation/update/access/end lifecycle and snapshots
- `cube.storage`: Center-write-only JSON/blob reads from full pushed values/deletions; memory caches only
- Reads (`occupancies.list/get`, `storage.get/getBlob/keys`) are synchronous; absent is `undefined`, not ready throws
- `cube.identity` (`cubeId`, `appId`) / `getToken()`: the token is never part of identity, events or hook results
- `cube.connection`: the only readiness model (`disconnected`, `initializing`, `ready`, `unavailable`, `error`);
  `connected`, `open`/`close` and every hook follow it; unknown data is never represented as loaded-empty
- `error` is recoverable: transient failures keep the reason and reconnect after 10s. Only `AUTHENTICATION_REQUIRED`
  and `PROTOCOL_MISMATCH` are terminal. Enum values a newer controller adds are dropped (unknown feature/device type
  omitted, unknown lock status/code source drops its event), never failed — a closed list would brick installed apps

## Code Style

This project follows Variocube coding standards.

### Key Points

- Tabs for indentation, 120 char line width
- dprint for TypeScript/JSON/Markdown formatting
- TypeScript strict mode enabled
- Use `interface` for object shapes, `type` for unions
- Prefer `undefined` over `null`
- No wildcard imports
- React: Functional components only, use hooks

## Testing

`npm test` runs Vitest SDK and React component tests. `npm run typecheck` checks source and tests
against workspace source aliases. CI runs both alongside the normal package builds.

`test/fixtures/controller-wire.json` is the byte-identical controller wire fixture (provenance in its README).
Do not format this shared fixture independently. `test/real-controller.test.ts` is opt-in and exercises the real
native Rust development fixture through a retained local VCMP kiosk driver; see `test/README.md` for startup instructions.

Keep extension requests controller-only. Raw VCMP debug logging exposes bearer tokens and must stay disabled even at
verbose log levels. Simulated scans from the controller's development fixture can feed UI tests; a real door cycle must
reach controller `/test/locks`.

## Extension contract and recovery

Exactly one installed Center app is resolved by the controller; requests cannot select `appId` or token audience.
Use the actual controller `api/app` message classes: occupancy states are `pending`, `confirmed`, `ended`,
confirmation upserts via `occupancyCreated`, and cancellation removes pending reservations via `occupancyEnded`.
Preserve full nullable occupancy fields and content. The SDK caches snapshots in memory and surfaces typed ACK
results/NAKs with correlation. Storage JSON null is distinct from a missing key (`undefined`). Occupancies are scoped
to the installed app by filtering foreign entries out of a snapshot, never by dropping the snapshot.
`occupancyEnded` carries no `appId`, so the snapshot attributes it; an unattributable end is still dispatched.

On disconnect/app change clear data/identity and reject pending requests. Discard old generation/key results.
Controller 6 has no capability discovery. Authentication/initial-state and commands have 10-second deadlines.
Lost mutation replies are `COMMAND_OUTCOME_UNKNOWN`; never replay allocate/open/end automatically. Reconcile UUIDs
or handover references with fresh controller reads. Controller 6 provides contiguous per-session publication revisions; these do not promise global equality across sessions.

`getToken()` reads only the current pushed token and rejects expired/wrong-audience values without sending a request.
Controller renewals arrive via `cube`; `expiresAt` is epoch seconds. Generation changes clear credentials. Read a token immediately
before fetch/OpenAPI calls, never persist or log it. Business state remains in the controller, not browser storage.

React hooks share `CubeProvider`: `useOccupancies`, `useOccupancy`, `useStorageItem`, `useStorageValue`,
`useIdentity`, `useConnectionState`. Data hooks return `CubeResult<T>`: `data` only with status `ready`, where
`undefined` establishes absence; value-only reads cannot. Keep wire sequencing (generation/revision) and credentials
out of public state and events. `ControllerSession` is a public interface; credential handling stays on the internal
`ControllerSessionImpl`. `session.close()` also ends every connection made from it.

## Publishing

Releases are cut by creating a **GitHub Release**; CI does the rest. The versions committed in the
repo stay at `0.0.0` — the published version comes from the release tag.

1. Create the release: `./release.sh <version>` (wraps `gh release create <version> --target main --generate-notes`), or create it from the GitHub UI. Tags may be `1.3.0` or `v1.3.0`.
2. The `release: published` event triggers CI, which:
   - stamps the tag's version into every package via `lerna version --no-git-tag-version`,
   - publishes the public packages to npm (`lerna publish from-package`) under `@variocube`,
   - deploys the demo to GitHub Pages.

## Rust controller major 6 integration

The SDK connects directly to the controller's authenticated `/app`; the Node gateway service it replaced has been
removed from this repo. Read `docs/controller-6.md` for wire/provenance and `test/README.md` for native checks. SDK
major 2 requires protocol 6. Bootstrap before importing router/analytics, never trust URL-selected
app/terminal/audience, and never persist or log grants, API credentials or JWTs.
Use `useConnectionState()` for authenticated readiness. Physical kiosk and release acceptance remain separately evidenced.
