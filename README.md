# Cube App SDK

The next SDK major (2) connects browser and React applications directly to Rust controller major 6. Identity,
occupancies, read-only app storage and hardware operations are mandatory. The controller replaces production
`cube-app-service`; the Node service and Java-era mock remain historical compatibility tools for SDK 1.

This branch implements the browser part of [controller-rs stage 3](https://github.com/variocube/controller-rs/issues/5).
It is unreleased and depends on the coordinated controller and kiosk changes. Package versions stay `0.0.0` until
release stamping. See [provenance and validation](docs/controller-6.md).

## Authentication before application startup

Kiosk obtains a short-lived, single-use grant through the controller's Unix socket. The server resolves the installed
app and configured app URL. The grant wraps the original fragment; reusable credentials never enter query parameters.
Call `bootstrapSession` before importing the router, analytics or application modules. It synchronously restores
clean history, exchanges the grant, and keeps the local API credential in memory.

```typescript
import {bootstrapSession} from "@variocube/cube-app-sdk";

void bootstrapSession({endpoint: "http://localhost:9000"}).then(async session => {
	const {renderApp} = await import("./app");
	renderApp(session);
});
```

App code calls `connect({session})`; React renders `<CubeProvider session={session}>`. Configure the controller endpoint
in app code. HTTP is restricted to loopback; remote endpoints require HTTPS. URL parameters cannot select controller
identity, app ID, audience or terminal. `secondary: true` selects secondary locks on the authenticated cube.

The first `/app` WebSocket message authenticates protocol major 6. No hardware command or subscription is usable until
an authoritative initial snapshot arrives. `cube.connection` / `useConnectionState()` expose `disconnected`,
`initializing`, `ready`, `unavailable` (a fresh kiosk launch is required), and `error`. This is the only readiness model:
`cube.connected`, the `open`/`close` events, local reads and every React hook follow it.

`error` is not terminal. A failure a reconnect can resolve — a timed-out or malformed snapshot, a controller domain that
dropped away — holds the reason on `connection.error` and rebuilds the connection from a fresh socket ten seconds later,
so one bad moment does not strand the app until the kiosk relaunches it. Only `AUTHENTICATION_REQUIRED` (`unavailable`)
and `PROTOCOL_MISMATCH` (`error`) stay put, because a fresh kiosk launch or new software is required. Values a newer
controller adds to a closed list are dropped rather than failing: an unknown compartment feature or device type is
omitted from that compartment or device, and an unknown lock status or code source drops its own event.

Local API credentials renew 30 seconds before expiry. Backend app JWTs come from `cube.getToken()` and have the exact
installed app audience. They are separate from local API credentials, Center identity proofs and technician sessions.
Never persist or log credentials or business state. Reload loses memory credentials; kiosk's trusted launch monitor
obtains a fresh launch when the old session is lost. A consumed URL cannot authenticate again.

## Domain APIs

```typescript
const reservation = await cube.occupancies.occupyCompartment({boxNumber: "1", content: {handover: "reference"}});
await cube.occupancies.confirm(reservation.uuid, {content: {confirmed: true}, merge: true});
await cube.occupancies.changeAccess(reservation.uuid, {accessKeys: ["access-reference"]});
await cube.occupancies.update(reservation.uuid, {content: null});
await cube.openCompartment(reservation.boxNumber, {actor: "customer", action: "collect"});
await cube.occupancies.end(reservation.uuid, {gracePeriod: 30});
```

Allocation and physical opening are separate. Opening acceptance does not establish observed door state; use lock
events. `occupyType`, `cancel`, `setCompartmentMaintenance`, reader configuration, device events and retained restart commands use the
same authenticated connection. `occupyCompartment` allocates one specific compartment, `occupyType({type, features?})`
lets the controller choose one with the same `CompartmentFeature` values as `Compartment.features`. The controller calls
compartments boxes: `boxNumber` is a `Compartment.number`. Authorization is enforced by the controller.

`occupancies.list(access?)` and `occupancies.get(uuid)` are synchronous reads of the latest pushed snapshot; `get`
returns `undefined` for an unknown UUID. Reads throw a `CubeError` unless the connection is ready, so an unknown
snapshot is never mistaken for an empty one. A local read can trail a just-acknowledged mutation until its publication
arrives. Lifecycle events follow the controller's names: a confirmation arrives as `occupancyCreated`, a cancellation
as `occupancyEnded`. `addEventListener` returns a function that removes the listener. An end carries only a `uuid`,
so the snapshot is what scopes it to the installed app: an end for a UUID this app does not hold is not dispatched,
while one that cannot be attributed at all — no snapshot yet — is dispatched rather than swallowing a real end.

Lost mutation replies produce `COMMAND_OUTCOME_UNKNOWN`. Reconcile a known UUID or handover reference with fresh
controller publications; the SDK never replays mutations after disconnect, timeout or cancellation. Generation changes clear
identity, snapshots and caches. Per-session contiguous publication revisions detect gaps and trigger a fresh snapshot;
these revisions do not promise global equality across sessions.

Storage is Center-write-only and read synchronously. `cube.storage.get<T>(key)` preserves JSON `null` and returns
`undefined` for missing/deleted keys; pass a validator as `get(key, schema.parse)` instead of asserting `T`.
`getBlob(key)` preserves binary bytes and content type; `keys()` lists keys. The SDK retains the complete bounded app
snapshot in memory and applies pushed values/deletions; initialization finishes only at the controller's `ready`
barrier. No read method sends a `get*` request.

`cube.identity` is `{cubeId, appId}`. The backend JWT is deliberately not part of it, of any event or of any hook
result: `await cube.getToken()` immediately before each backend request is the only way to obtain it. It reads the
current pushed JWT and rejects a wrong or expired audience without exposing a Center token. The controller pushes token
rotations; they are not identity changes.

## Native development and checks

Download the matching native controller candidate and start an isolated instance:

```shell
variocube-controller dev --fixture single --listen 127.0.0.1:9000 --state /tmp/my-controller
npm ci
npm run dev --workspace packages/cube-app-demo
CONTROLLER_URL=http://localhost:9000 npm run test:controller
```

The trusted development launcher or kiosk must deliver the issued app URL; opening the clean app URL alone cannot
mint credentials. The native runtime owns domain state and hardware simulation. See [test instructions](test/README.md)
for local checks and evidence limits. No Java or production `cube-app-service` is used by the new SDK workflow.
