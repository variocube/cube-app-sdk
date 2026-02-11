# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Lerna monorepo containing the Variocube Cube App SDK - a toolkit for developing web applications that run on Variocube smart lockers. The SDK enables web apps to communicate with locker hardware (locks, barcode readers, keypads, NFC readers) through a local WebSocket service.

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

# Format code with dprint
npx dprint fmt

# Check formatting
npx dprint check

# Start virtual cube for development
npx @variocube/cube-app-service

# Release new version
./release.sh
```

### Package-specific commands

```bash
# Build/dev specific package
cd packages/cube-app-sdk && npm run build
cd packages/cube-app-service && npm run dev  # Starts with verbose logging (-vvv)
cd packages/cube-app-demo && npm run dev     # Vite dev server
cd packages/cube-app-mock && npm run dev     # Mock UI dev server
```

## Architecture

### Package Structure

- **cube-app-sdk** (`@variocube/cube-app-sdk`): Core SDK providing the `connect()` function and `Cube` interface for locker communication
- **cube-app-react-sdk** (`@variocube/cube-app-react-sdk`): React wrapper with `CubeProvider` context and hooks (`useCube`, `useCompartments`, `useLocks`, `useCodeEvent`, etc.)
- **cube-app-service** (`@variocube/cube-app-service`): Node.js gateway service that bridges the SDK to actual locker hardware via VCMP protocol. Also serves a mock UI for development
- **cube-app-mock**: React UI for simulating locker hardware during development (private, not published)
- **cube-app-demo**: Demo application showcasing SDK features (private, deployed to GitHub Pages)

### Communication Flow

```
Web App (SDK) ←→ WebSocket ←→ cube-app-service ←→ VCMP ←→ Locker Controller
                    ↓
              Mock UI (for development)
```

The SDK uses VCMP (Variocube Communication Protocol) over WebSocket. The service listens on port 4000 by default and can connect to either a real locker controller (port 9000) or the mock UI for development.

### Key Types

- `Cube`: Main interface for locker interaction (open locks, receive events)
- `Compartment`: Describes a locker compartment with lock assignments
- `Device`: Hardware devices (BarcodeReader, Keypad, NfcReader, etc.)
- `LockStatus`: "OPEN" | "CLOSED" | "BREAKIN" | "BLOCKED"
- Events: `code`, `lock`, `open`, `close`, `compartments`, `devices`

## Code Style

This project follows Variocube coding standards. See `.devtools/PROJECT_CLAUDE.md` and `.devtools/guidelines/` for details.

### Key Points
- Tabs for indentation, 120 char line width
- dprint for TypeScript/JSON/Markdown formatting
- TypeScript strict mode enabled
- Use `interface` for object shapes, `type` for unions
- Prefer `undefined` over `null`
- No wildcard imports
- React: Functional components only, use hooks

## Testing

Currently no unit tests are configured. The test script is a placeholder.

## Publishing

Publishing is handled automatically by CI when a tag is pushed:
1. Run `./release.sh` which invokes `lerna version`
2. Push the tag
3. CI publishes to npm under `@variocube` scope
