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
Call `bootstrapController` before importing the router, analytics or application modules. It synchronously restores
clean history, exchanges the grant, and keeps the local API credential in memory.

```typescript
import {bootstrapController} from "@variocube/cube-app-sdk";

void bootstrapController({endpoint: "http://localhost:9000"}).then(async session => {
	const {renderApp} = await import("./app");
	renderApp(session);
});
```

App code calls `connect({session})`; React renders `<CubeProvider session={session}>`. Configure the controller endpoint
in app code. HTTP is restricted to loopback; remote endpoints require HTTPS. URL parameters cannot select controller
identity, app ID, audience or terminal. `secondary: true` selects secondary locks on the authenticated cube.

The first `/app` WebSocket message authenticates protocol major 6. No hardware command or subscription is usable until
an authoritative initial snapshot arrives. `cube.state` / `useConnectionState()` expose `disconnected`, `initializing`,
`ready`, `unavailable`, and `error`. Occupancy/storage hooks separately retain loaded/unknown distinctions.

Local API credentials renew 30 seconds before expiry. Backend app JWTs come from `cube.getToken()` and have the exact
installed app audience. They are separate from local API credentials, Center identity proofs and technician sessions.
Never persist or log credentials or business state. Reload loses memory credentials; kiosk's trusted launch monitor
obtains a fresh launch when the old session is lost. A consumed URL cannot authenticate again.

## Domain APIs

```typescript
const reservation = await cube.occupancies.occupyBox({boxNumber: "1", content: {handover: "reference"}});
await cube.occupancies.confirm(reservation.uuid, {confirmed: true}, true);
await cube.occupancies.changeAccess(reservation.uuid, {accessKeys: ["access-reference"]});
await cube.occupancies.update(reservation.uuid, {content: null});
await cube.openCompartment(reservation.boxNumber, {actor: "customer", action: "collect"});
await cube.occupancies.end(reservation.uuid, {gracePeriod: 30});
```

Allocation and physical opening are separate. Opening acceptance does not establish observed door state; use lock
events. `occupyType`, `cancel`, `setBoxMaintenance`, reader configuration, device events and retained restart commands use the
same authenticated connection. `list` and `get` read the latest pushed occupancy snapshot locally. Authorization is enforced by the controller.

Lost mutation replies produce `COMMAND_OUTCOME_UNKNOWN`. Reconcile a known UUID or handover reference with fresh
controller publications; the SDK never replays mutations after disconnect, timeout or cancellation. Generation changes clear
identity, snapshots and caches. Per-session contiguous publication revisions detect gaps and trigger a fresh snapshot;
these revisions do not promise global equality across sessions.

Storage is Center-write-only. `cube.storage.get<T>(key)` preserves JSON `null`; missing/deleted values reject with
`NOT_FOUND`. `getBlob(key)` preserves binary bytes and content type; `keys()` lists keys. The SDK retains the complete bounded app snapshot in memory and applies pushed values/deletions; initialization
finishes only at the controller's `ready` barrier. No read method sends a `get*` request. `getToken()` reads the current
pushed JWT and rejects a wrong or expired audience without exposing a Center token. The controller pushes token rotations.

## Native development and checks

Download the matching native controller candidate and start an isolated instance:

```shell
controller dev --fixture single --listen 127.0.0.1:9000 --state /tmp/my-controller
npm ci
npm run dev --workspace packages/cube-app-demo
CONTROLLER_URL=http://localhost:9000 CONTROLLER_KIOSK_SOCKET=/tmp/my-controller/kiosk.sock npm run test:controller
```

The trusted development launcher or kiosk must deliver the issued app URL; opening the clean app URL alone cannot
mint credentials. The native runtime owns domain state and hardware simulation. See [test instructions](test/README.md)
for local checks and evidence limits. No Java or production `cube-app-service` is used by the new SDK workflow.
