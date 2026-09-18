# Cube App React SDK

`CubeProvider` owns a single SDK connection. Its hooks subscribe to that connection and remove subscriptions on unmount;
changing the authenticated session, endpoint, generation or `secondary` replaces the connection. No browser persistence is used.

```tsx
import {
	bootstrapSession,
	ControllerSession,
	CubeProvider,
	useOccupancies,
	useStorageItem,
	useStorageValue,
} from "@variocube/cube-app-react-sdk";

function PlannedHandovers() {
	const document = useStorageItem<{ references: string[] } | null>("planned-handovers");
	if (document.status !== "ready") return <p>Controller: {document.status}. {document.error?.message}</p>;
	if (document.data === undefined) return <p>No handover document exists.</p>;
	return <pre>{JSON.stringify(document.data)}</pre>;
}

function Welcome() {
	const title = useStorageValue<string>("welcome-title");
	return <h1>{title ?? "Welcome"}</h1>;
}

function OccupancyList() {
	const occupancies = useOccupancies();
	if (occupancies.status !== "ready") return <p>Occupancies: {occupancies.status}</p>;
	if (!occupancies.data.length) return <p>No active occupancies.</p>;
	return <ul>{occupancies.data.map(item => <li key={item.uuid}>Box {item.boxNumber}: {item.state}</li>)}</ul>;
}

function App({session}: { session: ControllerSession }) {
	return (
		<CubeProvider session={session}>
			<Welcome />
			<PlannedHandovers />
			<OccupancyList />
		</CubeProvider>
	);
}
```

Every data hook returns a `CubeResult<T>`: `{status: "ready", data}` or, for any other connection status
(`disconnected`, `initializing`, `unavailable`, `error`), `{status, error?}` without data. There is one readiness model,
the connection's; `useConnectionState()` exposes it and `useConnected()` is the shorthand for `ready`. Only `ready`
establishes facts: within it, `undefined` data means authoritatively absent.

`useStorageItem<T>(key)` returns `CubeResult<T | undefined>`. A stored JSON `null` is `data: null`; a missing or deleted
document is `data: undefined`. A failed read (for example `INVALID_CONTENT_TYPE` for binary content) has status `error`.
The hook follows writes and deletions of its key, key changes, reconnects and installed-app changes, and never shows the
value of a previous key, app or connection. Token rotation does not re-render it.

`useStorageValue<T>(key)` returns the current value or `undefined`; stored JSON `null` stays `null`.
This convenience hook alone cannot establish absence for business decisions. Use the status-bearing hook when absence
affects an operation. Storage is Center-write-only and controller-backed; binary content is available through
`useCube().storage.getBlob(key)`.

`useOccupancies()` returns `CubeResult<Occupancy[]>`. `ready` with an empty array is an authoritative empty snapshot;
every other status must not be interpreted as empty. Snapshots replace the list; creation, updates, access changes,
ending, and cancellation update it automatically.

`useOccupancy(uuid)` returns `CubeResult<Occupancy | undefined>`. `data === undefined` establishes an absent entry only
when `status === "ready"`. Changing the UUID selects the new entry without retaining the previous result.

`useIdentity()` returns `CubeIdentity | undefined` (`cubeId`, `appId`) and clears on disconnect. An unresolved or
replaced app invalidates its session and clears identity. The bearer token is deliberately not part of identity or of
any hook result, so it cannot end up in rendered output or devtools. Obtain it immediately before a backend request:

```tsx
import {useCube} from "@variocube/cube-app-react-sdk";

function RefreshButton() {
	const cube = useCube();
	async function refresh() {
		const token = await cube.getToken();
		await fetch("/api/handovers", {headers: {Authorization: `Bearer ${token}`}});
	}
	return <button onClick={refresh}>Refresh</button>;
}
```

`getToken()` reads the current pushed token for the controller-selected installed app and rejects expired tokens.
The controller pushes rotations; this method never sends a refresh request. For generated OpenAPI clients, call it from the client's asynchronous
authorization callback before each request. Do not keep a token captured when constructing a client.

The demo includes reserve/confirm/cancel/end, the occupancy hooks, JSON and blob reads, and identity metadata. It requires
a real controller (memory mode is supported) for occupancy/storage; the hardware mock has no business state. A lost
mutation reply produces `COMMAND_OUTCOME_UNKNOWN`: refresh the authoritative list and reconcile a known UUID or a unique
reference in occupancy content. Never automatically replay the mutation. In particular, an allocation with no matching
entry stays in recovery and cannot offer a blind retry. Recovery remains tied to its original cube and app across identity
changes. A hardware command with an unknown outcome blocks the demo's hardware controls until an operator has inspected
the controller and door state and starts a new session; an occupancy snapshot cannot prove that a door opened.

Run component-visible hook tests with `npm test` from the repository root. The React package is versioned and released
together with core SDK and service through the repository's `release.sh` workflow.

Before loading React or router modules, call `bootstrapSession()` (re-exported from this package) as described in the
[root README](../../README.md).
`useConnectionState()` distinguishes disconnected/initializing/ready/unavailable/error; socket opening alone is not ready.
Provider caches and hooks retain no authority across an app generation change. Reload requires a fresh trusted kiosk launch.
