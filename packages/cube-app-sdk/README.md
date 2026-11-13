# Cube App SDK

SDK major 2 requires Rust controller major 6. `bootstrapSession()` cleans the kiosk fragment synchronously before
router/application startup, exchanges its one-use grant, and returns an in-memory `ControllerSession`.
`connect({session})` exposes mandatory occupancy, storage, identity and hardware APIs directly over `/app`. App,
terminal authority and the terminal's side of the cube remain server-resolved: `openCompartment` sends `openBox` and the
controller opens the lock on the terminal's side, and the read-only `cube.secondary` reports that side. Apps do not
choose the side.

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

`cube.preventCloseAfterOpenSeconds` is the time in seconds after an open within which the door may be closed before
the controller opens it again; it is `undefined` while that rule is off, before the initial state of a connection, and
on a controller that does not report the setting. Every open command starts the time, there is no call to arm a close,
and a changed setting arrives only with the next connection. `lock` events the controller causes itself carry actor
`LOCK_EVENT_ACTOR_CONTROLLER` and action `LOCK_EVENT_ACTION_REOPEN`, `LOCK_EVENT_ACTION_ALLOW_CLOSE` or
`LOCK_EVENT_ACTION_KEEP_CLOSE`. `isReopenedLockEvent(event)` recognizes the controller's own reopen (on
`OPEN`/`BLOCKED`: no opening by anyone, so no audit entry, count or notification), `isAllowedCloseLockEvent(event)` a
close an open allowed, and `isKeptCloseLockEvent(event)` a close kept without one because the compartment is out of
service or the controller gave up reopening (both on `CLOSED`). A `CLOSED` of a compartment's lock with one of the
two close tags normally stands; one with neither is normally followed by a reopen, for which an app waits only a
bounded time before going by the lock status. A controller before controller-rs#217 sends no `keep close` and leaves
those closes untagged, without a reopen. A reopen does not start the time: send a new
`openCompartment`/`openLock` before the door can be closed. See the
[root README](../../README.md#close-only-after-opening).

A lost mutation result is `COMMAND_OUTCOME_UNKNOWN`; never blindly replay allocation, opening or ending. Read the
controller's authoritative state to reconcile the known UUID/reference. Caches are bounded and live only in memory.
`session.close()` discards the credential and ends every connection made from that session, so application shutdown
needs only that call; `cube.close()` and a React provider unmount close one connection and keep the session.

## Retained allocations and merge patches

Pass `idempotencyKey` (an opaque string of at most 128 Unicode characters) to `occupyType` or
`occupyCompartment`. A repeated key returns the retained occupancy in any state, even if other request
fields differ. Keys are scoped to the installed app. The controller persists keyed ended records and
retains them for at least seven days after Center acknowledges the end; full history rejects new work.

`occupancies.list()` / `useOccupancies()` return only active records, as does the `occupancies` event.
`get(uuid)` / `useOccupancy(uuid)` and `getByIdempotencyKey(key)` / `useOccupancyByIdempotencyKey(key)` also
return retained ended records, so an ended occupancy keeps resolving instead of becoming absent; an empty key
never matches. The hooks return `CubeResult`: `ready` with `undefined` means absence; other statuses mean data
is unknown. All reads clear on disconnect/app generation change and throw before readiness. Keyed
`occupancyEnded` events contain `{uuid, occupancy}` with `occupancy.state: "ended"`; unkeyed events still
remove by UUID, as does an end carrying a record the SDK cannot retain. `occupancies.ended()` /
`useEndedOccupancies()` return every retained ended record of the app (the snapshot's plus the keyed ends received
since; order unspecified), so a consumer can find evidence without knowing a key. The SDK does not cap them, because a cap
would drop records the controller still retains. The bound is the controller's: it keeps a keyed ended record for at
least seven days after Center acknowledged the end and until its plan's retirement is applied (full history refuses
new work), and when it finally removes one it bumps its publication revision and clears its event backlog. The
SDK's next event then shows a revision gap and it resynchronizes, so a fresh snapshot replaces the set. Between
removal and that next event, or a reconnect, the SDK may still hold a record the controller has already removed. Initial snapshots include retained keyed ended records. Controller expiry triggers
an authoritative refresh.

`occupancies.patch(uuid, contentPatch, openContext?)` sends `patchOccupancy` and applies an RFC 7396
object patch: objects merge recursively, null members delete, and arrays/scalars replace. An empty
result stays `{}`; an unchanged result writes and publishes nothing. `OccupancyPatch<T>` models recursive
partials with null deletion. `update(..., {merge: true})` stays shallow and stores null members.
The 10-second deadline, 64 KiB request limit, and `COMMAND_OUTCOME_UNKNOWN` behavior apply to patches too.
Mutations are never replayed automatically, including keyed allocations. Read caches may trail the ACK;
resulting content arrives in normal publications. Shared fixtures live under `test/fixtures` at the repo root.
