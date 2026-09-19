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

## Retained allocations and merge patches

Pass `idempotencyKey` (an opaque string of at most 128 Unicode characters) to `occupyType` or
`occupyCompartment`. A repeated key returns the retained occupancy in any state, even if other request
fields differ. Keys are scoped to the installed app. The controller persists keyed ended records and
retains them for at least seven days after Center acknowledges the end; full history rejects new work.

`occupancies.list()` / `useOccupancies()` return only active records. `get(uuid)` / `useOccupancy(uuid)`
and `getByIdempotencyKey(key)` / `useOccupancyByIdempotencyKey(key)` also return retained ended records.
The hooks return `CubeResult`: `ready` with `undefined` means absence; other statuses mean data is unknown.
All reads clear on disconnect/app generation change and throw before readiness. Keyed `occupancyEnded`
events contain `{uuid, occupancy}` with `occupancy.state: "ended"`; unkeyed events still remove by UUID.
Initial snapshots include retained keyed ended records. Controller expiry triggers an authoritative refresh.

`occupancies.patch(uuid, contentPatch, openContext?)` sends `patchOccupancy` and applies an RFC 7396
object patch: objects merge recursively, null members delete, and arrays/scalars replace. An empty
result stays `{}`; an unchanged result writes and publishes nothing. `OccupancyPatch<T>` models recursive
partials with null deletion. `update(..., {merge: true})` stays shallow and stores null members.
The 10-second deadline, 64 KiB request limit, and `COMMAND_OUTCOME_UNKNOWN` behavior apply to patches too.
Mutations are never replayed automatically, including keyed allocations. Read caches may trail the ACK;
resulting content arrives in normal publications. Shared fixtures live under `test/fixtures` at the repo root.
