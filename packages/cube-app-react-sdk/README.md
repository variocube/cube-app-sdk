# Cube App React SDK

`CubeProvider` owns a single SDK connection. Its hooks subscribe to that connection and remove subscriptions on unmount;
changing the authenticated session, endpoint, generation or `secondary` replaces the connection. No browser persistence is used.

```tsx
import {CubeProvider, useOccupancies, useStorageItem, useStorageValue} from "@variocube/cube-app-react-sdk";

function PlannedHandovers() {
	const document = useStorageItem<{ references: string[] } | null>("planned-handovers");
	if (document.status === "loading") return <p>Loading…</p>;
	if (document.status === "unavailable") return <p>Controller storage unavailable.</p>;
	if (document.status === "not-found") return <p>No handover document exists.</p>;
	if (document.status === "error") return <p>{document.error?.message}</p>;
	return <pre>{JSON.stringify(document.data)}</pre>;
}

function Welcome() {
	const title = useStorageValue<string>("welcome-title");
	return <h1>{title ?? "Welcome"}</h1>;
}

function OccupancyList() {
	const occupancies = useOccupancies();
	if (occupancies.status !== "ready") return <p>Occupancies: {occupancies.status}</p>;
	if (!occupancies.data?.length) return <p>No active occupancies.</p>;
	return <ul>{occupancies.data.map(item => <li key={item.uuid}>Box {item.boxNumber}: {item.state}</li>)}</ul>;
}

function App({session}: { session: import("@variocube/cube-app-sdk").ControllerSession }) {
	return (
		<CubeProvider session={session}>
			<Welcome />
			<PlannedHandovers />
			<OccupancyList />
		</CubeProvider>
	);
}
```

`useStorageItem<T>(key)` returns the exported `StorageItemResult<T>` union: `status`, `data` when ready, and `error` when a
read fails. Status is `loading`, `ready`, `unavailable`, `error`, or `not-found`. A stored JSON `null` is a successfully
loaded value. Missing/deleted documents produce `not-found` with `error.code === "NOT_FOUND"`.

Storage hooks subscribe before reading, refresh on matching invalidations (including deletion), key changes, reconnect,
and installed-app changes. Invalidated values clear while loading; responses from an older key, app, connection, or
invalidation are discarded. Token renewal alone does not invalidate a document.

`useStorageValue<T>(key)` returns the current successfully loaded value or `undefined`; stored JSON `null` stays `null`.
This convenience hook alone cannot establish absence for business decisions. Use the status-bearing hook when absence
affects an operation. Storage is Center-write-only and controller-backed; binary content is available through
`useCube().storage.getBlob(key)`.

`useOccupancies()` returns the exported core `OccupancyState`: `status`, `data?: Occupancy[]`, and `error?`. `ready` with an
empty array is an authoritative empty snapshot. Loading, unavailable, and error states must not be interpreted as empty.
Snapshots replace the list; creation, updates, access changes, ending, and cancellation update it automatically.

`useOccupancy(uuid)` returns the exported `OccupancyResult` with the same availability states and `data?: Occupancy`.
`data === undefined` establishes an absent entry only when `status === "ready"`. Changing the UUID selects the new entry
without retaining the previous result. Disconnect and app changes clear both occupancy hooks until an authoritative
snapshot arrives.

`useCubeIdentity()` returns `CubeIdentity | undefined`, follows identity and token renewal events, and clears on disconnect.
An unresolved or replaced app invalidates its session and clears identity. Display cube/app IDs and expiry metadata;
never log or render bearer tokens. Obtain a current token immediately before a backend request:

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

`getToken()` chooses the installed app's exact audience on the controller. It deduplicates refresh requests and only uses
a cached token with more than 300 seconds remaining. For generated OpenAPI clients, call it from the client's asynchronous
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

Before loading React or router modules, call the core `bootstrapController()` as described in the [root README](../../README.md).
`useConnectionState()` distinguishes disconnected/initializing/ready/unavailable/error; socket opening alone is not ready.
Provider caches and hooks retain no authority across an app generation change. Reload requires a fresh trusted kiosk launch.
