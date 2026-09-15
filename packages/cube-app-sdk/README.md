# Cube App SDK

SDK major 2 requires Rust controller major 6. `bootstrapController()` cleans the kiosk fragment synchronously before
router/application startup, exchanges its one-use grant, and returns an in-memory `ControllerSession`.
`connect({session, secondary?: boolean})` exposes mandatory occupancy, storage, identity and hardware APIs directly over
`/app`. `secondary` selects secondary locks; app and terminal authority remain server-resolved.

See the [root README](../../README.md) for workflows and the [wire contract](../../docs/controller-6.md) for protocol,
source provenance, limits and validation. There is no capability discovery or hardware-only feature fallback.

`cube.state` is `ready` only after authenticated initial state, complete storage and the `ready` barrier. Unknown occupancy data remains `undefined`, while an
authoritative empty snapshot is `[]`. Nullable contents are preserved. Storage reads are Center-write-only and preserve
JSON null, exact binary bytes and missing/deleted errors. `getToken()` returns only the current pushed installed-app backend JWT and rejects expired values.
Occupancy/storage read methods use the latest pushed cache; none sends a `get*` request.

A lost mutation result is `COMMAND_OUTCOME_UNKNOWN`; never blindly replay allocation, opening or ending. Read the
controller's authoritative state to reconcile the known UUID/reference. Caches are bounded and live only in memory.
Application shutdown calls `cube.close()` and `session.close()`; React provider unmount closes only its owned connection.
