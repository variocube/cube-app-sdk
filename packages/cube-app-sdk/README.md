# Cube App SDK

SDK major 2 requires Rust controller major 6. `bootstrapSession()` cleans the kiosk fragment synchronously before
router/application startup, exchanges its one-use grant, and returns an in-memory `ControllerSession`.
`connect({session, secondary?: boolean})` exposes mandatory occupancy, storage, identity and hardware APIs directly over
`/app`. `secondary` selects secondary locks; app and terminal authority remain server-resolved.

See the [root README](../../README.md) for workflows and the [wire contract](../../docs/controller-6.md) for protocol,
source provenance, limits and validation. There is no capability discovery or hardware-only feature fallback.

`cube.connection` is the only readiness model. Its status is `ready` only after authenticated initial state, complete
storage and the `ready` barrier; `cube.connected`, the `open`/`close` events and the `connection` event all follow it.
Occupancy and storage reads are synchronous reads of the pushed cache and never send a `get*` request. They throw a
`CubeError` unless the connection is ready, so unknown data never looks empty: an authoritative empty snapshot is `[]`,
a missing occupancy or storage key is `undefined`, and a stored JSON null stays `null`. `storage.get(key, parse?)`
accepts a validator such as a Zod schema's `parse`. `cube.identity` holds `cubeId` and `appId` only; `getToken()`
returns the current pushed installed-app backend JWT and rejects expired values.

`addEventListener` returns a function that removes the listener; `CubeEventMap` types every event and payload.

A lost mutation result is `COMMAND_OUTCOME_UNKNOWN`; never blindly replay allocation, opening or ending. Read the
controller's authoritative state to reconcile the known UUID/reference. Caches are bounded and live only in memory.
`session.close()` discards the credential and ends every connection made from that session, so application shutdown
needs only that call; `cube.close()` and a React provider unmount close one connection and keep the session.
