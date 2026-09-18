# cube-app-sdk

SDK for developing apps that run on Variocube lockers.

## What is a cube app?

A cube app is a web application that runs in a browser on a Variocube locker and uses its features.

The web application must be hosted on a public URL (like https://yourapp.com/variocube).

Service workers can cache the application shell for offline loading. Business state belongs in the controller:
occupancies and the app's Center-written store remain accessible when the Internet connection is unavailable.
The SDK and service keep only in-memory caches; do not persist handovers, access codes, or tokens in browser storage.

It can access the hardware features of the locker it runs on, like opening locks or receiving codes
from a QR-code reader.

Check out our [⭐⭐⭐ Demo App ⭐⭐⭐](https://variocube.github.io/cube-app-sdk/) for a quick overview of what is possible.

## How does it work?

When running on a Variocube, your web application will be able to communicate with a local service,
the `cube-app-service`, which provides access to the hardware features on the locker. This SDK encapsulates
the communication with this service and provides a simple API for interacting with the locker.

## Using the SDK

Add the package `@variocube/cube-app-sdk` to your web application and use it to interface with the Variocube locker.

If you are using React in your app, we advise using the `@variocube/cube-app-react-sdk` instead. It is a simple
React wrapper (context provider + hooks) around the SDK.

```shell
npm install @variocube/cube-app-sdk

# Or, in a React app:
npm install @variocube/cube-app-react-sdk
```

For hardware UI development, start the virtual cube with:

```shell
npx @variocube/cube-app-service
```

The virtual cube will be available at [http://localhost:4000/](http://localhost:4000/).

Occupancies, storage, and signed identity require a real controller. The mock does not implement these features.
See the [real-controller harness](test/README.md) for memory-mode development and repeatable acceptance checks.

You might want to take a look at the [source code of the demo app](packages/cube-app-demo) that is included in this repository.

### Connecting to the Variocube locker

A single call to the `connect` function provides access to all platform features:

```typescript
import {connect} from "@variocube/cube-app-sdk";

// Connect to the cube
const cube = connect();
```

### Opening a compartment

```typescript
await cube.openCompartment("1");
```

### Receiving code events

```typescript
// Add a listener for code events
cube.addEventListener("code", async ({code}) => {
	// Open box 1 on the correct code
	if (code == "12345") {
		await cube.openCompartment("1");
	}
});
```

### Receiving lock events

```typescript
// Add a listener for code events
cube.addEventListener("lock", async ({compartmentNumber, status}) => {
	console.log(`Compartment ${compartmentNumber} is now ${status}`);
});
```

### Retrieving compartments

```typescript
// Retrieve compartments of the cube
const compartments = cube.compartments;
for (const compartment of compartments) {
	await cube.openCompartment(compartment.number);
}
```

### Retrieving devices

```typescript
const devices = cube.devices;
for (const device of devices) {
	console.log(`Device ${device.id} is a ${device.types.join(", ")}`);
}
```

### Restarting

```typescript
// Restart the operating system
await cube.restartOperatingSystem();

// Restart the user interface
await cube.restartUserInterface();
```

### Configuring the code reader

Push a standardized configuration to the connected code reader(s) — symbologies, indicators,
trigger & timing, and output formatting. The config may be partial: the driver overlays it on its
default profile and applies what the reader supports, silently skipping unsupported properties.

```typescript
import {Symbology} from "@variocube/cube-app-sdk";

await cube.configureCodeReader({
	symbologies: {
		[Symbology.QR]: true,
		[Symbology.Code128]: true,
		[Symbology.EAN13]: false,
	},
	indicators: {
		beeper: {enabled: true, volume: 80}, // volume/brightness are percentages, 0–100
		led: {enabled: true, brightness: 50},
	},
	outputFormatting: {
		terminator: "CRLF",
	},
});
```

The config is validated before it is sent. If it is invalid, `configureCodeReader` rejects
and nothing is sent:

```typescript
try {
	await cube.configureCodeReader({indicators: {beeper: {volume: 150}}});
}
catch (error) {
	// CubeError INVALID_REQUEST: Invalid code reader configuration: indicators.beeper.volume must be between 0 and 100
}
```

You can run the same validation yourself, e.g. to give feedback in a settings UI before sending:

```typescript
import {validateCodeReaderConfig} from "@variocube/cube-app-sdk";

const {valid, errors} = validateCodeReaderConfig(config);
```

> The config is applied to all connected code readers; there is no per-device targeting. In v1 the
> driver only logs which properties it applied, skipped, or failed — no structured success/failure
> result is returned to the app yet.

## Handling error conditions

### No connection to cube app service

In case the cube app service is not available or the connection is lost, you cannot use any data or commands.

```typescript
// You can check the `connected` property
if (!cube.connected) {
	console.error("Not connected to cube app service.");
}
// You can attach an event listener to get notified when the connection is lost
cube.addEventListener("close", () => console.error("Connection to cube app service lost."));
```

### No compartments

If a cube does not have compartments, it is either unconfigured, or the connection to the service that is managing compartments
could not be established or was lost.

```typescript
// You can check the length of the `compartments` property
if (cube.compartments.length == 0) {
	console.error("No compartments.");
}
// You can attach an event listener to get notified when the compartments change
cube.addEventListener("compartments", ({compartments}) => {
	if (compartments.length == 0) {
		console.error("There are no longer any compartments.");
	}
});
```

### Device not available

If an attached device stops working, it is removed from the list of devices. You can check whether a device
that is necessary for your application is present:

```typescript
// Find a specific device in the list of devices
const reader = cube.devices.find(device => device.types.includes("BarcodeReader"));
if (!reader) {
	console.error("No reader present.");
}
// Attach an event to get notified when the devices change
cube.addEventListener("devices", ({devices}) => {
	const reader = devices.find(device => device.types.includes("BarcodeReader"));
	if (!reader) {
		console.error("Reader no longer present.");
	}
});
```

### Lock status `BLOCKED`

If a lock does not open, even though an open command was sent to it, it can be marked as `BLOCKED`. This typically happens
when the compartment door is mechanically blocked from opening.

```typescript
// Handle the `BLOCKED` status in a lock event handler
cube.addEventListener("lock", ({lock, status}) => {
	if (status == "BLOCKED") {
		console.error(`Lock ${lock} is blocked. Are you leaning against the door?`);
	}
});
```

### Lock status `BREAKIN`

If a lock is opened without a prior open command, it can be marked as `BREAKIN`.

```typescript
// Handle the `BLOCKED` status in a lock event handler
cube.addEventListener("lock", ({lock, status}) => {
	if (status == "BREAKIN") {
		console.error(`Break-in alert at lock ${lock}!`);
	}
});
```

## Limitations

When using this SDK and the underlying services, the following limitations apply compared to other Variocube applications.

### Single app only

Only a single app is supported. It is not possible to run multiple apps on the Variocube locker
or use existing Variocube apps alongside your app. However, you can implement a variety of use-cases
within your app.

### Bring Your Own (Basic) Features

Location codes, maintenance codes, and a settings menu remain app responsibilities. Compartment maintenance state
can be changed with `cube.setCompartmentMaintenance(number, required)`.

## Occupancies

The controller resolves exactly one installed Center app. Requests never select an app ID. Occupancy UUID reads
and mutations are scoped to that app; unknown and foreign UUIDs both return `NOT_FOUND`.

```typescript
const occupancy = await cube.occupancies.occupyCompartment({
	boxNumber: "1",
	accessCode: "12345",
	content: {handoverId: "handover-123"},
	actor: "courier",
	action: "delivery",
});
await cube.openCompartment(occupancy.boxNumber);
// Confirm after your workflow observes the required controller door cycle.
await cube.occupancies.confirm(occupancy.uuid);
const matches = await cube.occupancies.list("12345"); // Access code OR access key.
await cube.occupancies.end(occupancy.uuid, {content: {pickedUp: true}, merge: true});
```

`occupyCompartment({boxNumber, ...})` allocates one specific compartment; `occupyType({type, group?, features?, ...})`
lets the controller choose one, where `features` takes the same `CompartmentFeature` values as `Compartment.features`.
The controller calls compartments boxes: `boxNumber` is a `Compartment.number`. Both allocation methods retain access
code/shape/keys, content, actor, and action. `update(uuid, options)` changes content with optional merge and
actor/action; `changeAccess(uuid, options)` changes code/shape/keys and actor/action. `confirm(uuid, {content?, merge?})`
confirms a reservation; `cancel(uuid)` removes a pending reservation and leaves a confirmed occupancy unchanged.
`end(uuid, options?)` also accepts the controller's grace period and actor/action options.

Records preserve the controller fields, including nullable values, creation timestamp, and
`state: "pending" | "confirmed" | "ended"`. Grace-period records are excluded from snapshots/lists but may remain
readable by `get(uuid)` until cleanup. Allocation replies contain the created record; other mutations ACK after
the controller commits. An ACK for `openLock` acknowledges the command; observe lock events for the door cycle.

`cube.occupancies.state` exposes availability separately from data. A `ready` snapshot with `data: []` means loaded
and empty. `loading`, `unavailable`, and `error` never establish absence. The `occupancies` event carries
`{occupancies: state}` on every change; creation, confirmation, updates, and access changes upsert complete records, while ending/canceling removes
them. Snapshots replace the array. Data is cleared on disconnect and direct app changes. The lifecycle events follow
the controller's names: a confirmation arrives as `occupancyCreated` and a cancellation as `occupancyEnded`.

`addEventListener` returns a function that removes the listener; `CubeEventMap` types every event name and payload.

The landed controller does not globally serialize concurrent snapshots and lifecycle notifications. The service
preserves received order; when reconciling uncertain operations, read the controller again with `list()`/`get()`.
Neither transport supplies exactly-once execution.

## Controller-backed storage

```typescript
const plan = await cube.storage.get<{ handoverIds: string[] }>("plan");
const keys = await cube.storage.keys();
const attachment = await cube.storage.getBlob("label.pdf");
cube.addEventListener("storage", ({key}) => {
	// The key was created, replaced, or deleted. Re-read it before using its value.
});
```

`get<T>` reads parsed JSON, including JSON null. Missing/deleted documents reject with `NOT_FOUND`; null is a
successfully stored value. `getBlob` returns bytes with the original content type for either JSON or binary storage.
The Center is the only writer. Key invalidations clear cached documents; disconnects and app changes clear all
cached documents and invalidate pending reads. Hooks re-read automatically.

## Cube identity and authenticated requests

```typescript
const token = await cube.getToken();
const response = await fetch(`${backendUrl}/cubes/${cube.identity!.cubeId}/handovers`, {
	headers: {Authorization: `Bearer ${token}`},
});
```

Call `getToken()` immediately before fetch or in an OpenAPI client's asynchronous authorization interceptor.
The controller chooses the exact installed Center app ID as audience; `getToken()` takes no audience argument.
It reuses a cached token only with more than 300 seconds remaining, shares concurrent refreshes, and rejects
failed refreshes. The controller broadcasts proactive renewals. Tokens and pending results are cleared across
controller/app changes; never log bearer tokens.

`cube.identity` is undefined while disconnected or awaiting a supported controller's identity. Once received, it
contains `cubeId`, `appId`, `token`, and `expiresAt`
(Unix epoch seconds). Unresolved app configuration leaves the last three fields null. Subscribe to `identity`
or use `useIdentity()` to follow changes and renewal. There is no separate `cube.app` or `app` event.

Backends verify signatures with registered cube public keys and the configured app audience. A cube token proves
cube identity; the backend binds the subject to the request path and authorizes tenant/site through its own mapping.
The SDK does not act as a token verifier or infer tenant/user permissions.

## React hooks

Use one `CubeProvider` for the application. `useOccupancies()`, `useOccupancy(uuid)`, `useStorageItem<T>(key)`,
`useStorageValue<T>(key)`, and `useIdentity()` share its connection. See the
[React SDK README](packages/cube-app-react-sdk/README.md) for typed results and examples.

Storage reads refresh on mount, key changes, matching invalidations, reconnect, and installed-app changes.
An invalidated value is cleared while loading; old asynchronous results cannot replace current data.
The status-bearing hooks distinguish loaded-empty snapshots, missing documents, stored JSON null, and unavailable
data. The value-only `useStorageValue` returns the current successful value or undefined; it cannot establish
absence for business decisions. The [demo](packages/cube-app-demo) uses these hooks for occupancy and storage screens.

## Extension errors and recovery

Catch `CubeError` and inspect `code`:

| Code                      | Meaning / recovery                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `APP_NOT_CONFIGURED`      | No single installed app; the controller diagnostic lists installed IDs. Fix controller/Center configuration. |
| `NOT_FOUND`               | Unknown/foreign occupancy UUID or missing/deleted document.                                                  |
| `NO_BOX_AVAILABLE`        | Allocation could not select a box.                                                                           |
| `DISCONNECTED`            | The required connection is unavailable; wait for reconnection and fresh data.                                |
| `UNSUPPORTED`             | The controller/service does not support the requested extension.                                             |
| `COMMAND_OUTCOME_UNKNOWN` | A sent mutation lost its reply. Reconcile before continuing.                                                 |
| `TIMEOUT`                 | A query did not reply in time; a new read can be issued.                                                     |
| `STALE_RESPONSE`          | A document changed during its read; discard that result and read its current value.                          |
| `INVALID_CONTENT_TYPE`    | `get<T>` was used for binary content; use `getBlob`.                                                         |
| `INVALID_REQUEST`         | The request was rejected locally, e.g. an invalid code reader configuration.                                 |
| `INVALID_RESPONSE`        | The controller returned a malformed value or an invalid/expired refreshed token.                             |
| `COMMAND_FAILED`          | A legacy/generic rejection without a stable controller error code.                                           |

New features wait at most five seconds for capabilities; late capability messages enable them. Existing hardware
operations remain usable with older controllers. Query and mutation replies time out after ten seconds.
Never automatically retry allocate/open/end after a disconnect or timeout: a committed operation may have lost
its reply. Re-read authoritative occupancies and reconcile by known UUID or a unique handover reference in content.
Keep an unresolved allocation in an explicit recovery state; do not offer a blind allocation retry.

## Development and release

```shell
npm ci
npm test
npm run typecheck
npm run build
```

The [shared fixtures](test/fixtures) and runtime/component tests cover the wire contract, availability, cache
invalidation, stale responses, token refresh, and recovery. Run `npm run test:controller` with the
[real-controller harness](test/README.md) for lifecycle and Center-write storage checks.

After merge, `./release.sh <version>` creates the release that publishes core SDK, React SDK, and service together,
builds the existing Debian package, and deploys the demo. Keep committed package versions at `0.0.0`.
The Debian runtime selection is unchanged; app-host co-installation is outside this change.
