# Cube App SDK

The next SDK major (2) connects browser and React applications directly to Rust controller major 6. Identity,
occupancies, read-only app storage and hardware operations are mandatory. The controller absorbed the Node
`cube-app-service` gateway, which has been removed from this repo along with its mock UI; SDK 1 users keep the last
published `@variocube/cube-app-service` 1.x.

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
identity, app ID, audience or terminal.

The first `/app` WebSocket message authenticates protocol major 6. No hardware command or subscription is usable until
an authoritative initial snapshot arrives. `cube.connection` / `useConnectionState()` expose `disconnected`,
`initializing`, `ready`, `unavailable` (a fresh kiosk launch is required), and `error`. This is the only readiness model:
`cube.connected`, the `open`/`close` events, local reads and every React hook follow it.

The controller does not relaunch the kiosk when an app credential expires or is rejected. So whenever the SDK concludes
that a fresh launch is required — no or an invalid launch envelope, a rejected or expired grant, a failed renewal, a
socket credential the controller no longer accepts, or a changed installed app — it asks the controller once per page for
one (`POST /app/relaunch`, bounded to 10 seconds, without credential) and reports `AUTHENTICATION_REQUIRED`. Closing the
session, `openMaintenance()` and leaving the page are deliberate ends and ask for nothing (#87).

`error` is not terminal. A failure a reconnect can resolve — a timed-out or malformed snapshot, a controller domain that
dropped away — holds the reason on `connection.error` and rebuilds the connection from a fresh socket ten seconds later,
so one bad moment does not strand the app until the kiosk relaunches it. Only `AUTHENTICATION_REQUIRED` (`unavailable`)
and `PROTOCOL_MISMATCH` (`error`) stay put, because a fresh kiosk launch or new software is required. Values a newer
controller adds to a closed list are dropped rather than failing: an unknown compartment feature or device type is
omitted from that compartment or device, and an unknown lock status or code source drops its own event.

Local API credentials renew 30 seconds before expiry. Backend app JWTs come from `cube.getToken()` and have the exact
installed app audience. They are separate from local API credentials, Center identity proofs and technician sessions.
Never persist or log credentials or business state. Reload loses memory credentials; the reloaded page asks the
controller for a fresh launch as described above. A consumed URL cannot authenticate again.

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

`openCompartment(number)` sends `openBox`, and the controller opens the compartment's lock on the requesting terminal's
side of the cube: its `secondaryLock` on a secondary terminal, its `lock` otherwise; it never opens the other side.
`UNAVAILABLE` means the compartment has no lock on that side, or the lock or the terminal owning it cannot be reached
right now. It is not necessarily permanent, so do not hide or disable the compartment because of it. `cube.secondary` is
the side the controller reported when the connection authenticated (`false` before that), and
`getCompartmentLock(number)` returns the lock `openCompartment` opens. `openLock(lock)` still addresses one specific
lock. Both take an optional `{actor, action}` context; the controller records it on the opening and on the resulting
`lock` event, whose `actor` is the app's own attribution when the context names none.

### Close only after opening

A controller can be set to accept a close of a lock only within a time after an open of that lock; any other close is
opened again. `cube.preventCloseAfterOpenSeconds` / `usePreventCloseAfterOpenSeconds()` is that time in seconds while
the rule is on, and `undefined` while it is off, before the initial state of a connection, and on a controller that
does not report the setting. Use it for the prompt, for example "close the door within 120 seconds, otherwise it opens
again". Every open command for the lock starts the time, whoever sends it, and opening an already open lock starts it
anew; the SDK has no call to arm a close. The controller's own reopen does not start the time. A changed setting
arrives only with the next connection.

The controller tags the `lock` events it causes itself with actor `LOCK_EVENT_ACTOR_CONTROLLER` (`"controller"`) and
action `LOCK_EVENT_ACTION_REOPEN` (`"reopen"`), `LOCK_EVENT_ACTION_ALLOW_CLOSE` (`"allow close"`) or
`LOCK_EVENT_ACTION_KEEP_CLOSE` (`"keep close"`). `isReopenedLockEvent(event)`, `isAllowedCloseLockEvent(event)` and
`isKeptCloseLockEvent(event)` test for the three tags; they compare actor and action only, not the status:

| Helper                    | Action        | Status             | Meaning                                                           |
| ------------------------- | ------------- | ------------------ | ----------------------------------------------------------------- |
| `isReopenedLockEvent`     | `reopen`      | `OPEN` / `BLOCKED` | The controller opened the lock again by itself. Nobody opened it. |
| `isAllowedCloseLockEvent` | `allow close` | `CLOSED`           | The close was kept because an open shortly before allowed it.     |
| `isKeptCloseLockEvent`    | `keep close`  | `CLOSED`           | The close was kept although no open allowed it.                   |

```typescript
import {isAllowedCloseLockEvent, isKeptCloseLockEvent, isReopenedLockEvent} from "@variocube/cube-app-sdk";

cube.addEventListener("lock", event => {
	if (isReopenedLockEvent(event)) return offerOpenAgain();
	if (event.status === "OPEN") recordOpening(event.actor, event.action);
	if (event.status === "CLOSED" && isAllowedCloseLockEvent(event)) finishHandover();
	if (event.status === "CLOSED" && isKeptCloseLockEvent(event)) showDoorStaysClosed();
});
```

For a reopen, write no audit entry, count no opening and send no notification. A reopen does not allow a close: the
door is open, but closing it now is refused again, because only an open command starts the time. Show a hint that the
locker opened again, with opening as its action, and send `openCompartment` or `openLock` when the user takes it (this
also works on the already open lock); the door can then be closed within the time. Do not ask the user to just close
the door after a reopen.

The controller keeps a close no open allowed, and tags it `keep close`, when the compartment is out of service
(disabled or in maintenance) or when it gave up reopening on the third close of the lock within 3 seconds; the event
does not tell which. A close an open allowed stays `allow close` in those cases too. So while the setting is on, a
`CLOSED` of a compartment's lock tagged `allow close` or `keep close` normally stands, and one with neither tag is
normally followed by a reopen within moments. Such an untagged `CLOSED` can still carry the actor and action of an
app's open shortly before. A lock that belongs to no compartment keeps its close untagged.

Neither half is a guarantee, so do not let a screen depend on the event that normally follows. After an untagged
`CLOSED`, wait a short, bounded time for the reopen; if none arrives, treat the door as closed, going by the lock
status. No reopen follows when the lock or its driver refuses it or the door does not open, when the controller
restarts, when an open of the lock is still pending, or when the controller cannot read its configuration. A
controller that knows the rule but not `keep close` yet (before controller-rs#217) also sends nothing more: it leaves
the closes of a compartment out of service and the one it gave up on untagged and does not reopen them. In the other
direction, a tagged close can still be followed by a reopen when it is reported while the reopen of an earlier close
is already starting. [The wire contract](docs/controller-6.md) has the details.

The `reopen` tag also marks a reopen by the controller's rule for compartments that are not occupied; that rule tags
nothing else. `actor` and `action` stay plain strings, so other values keep arriving unchanged. A controller older
than the rule sends neither the setting nor the close tags.

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

## Logging

On a locker, the kiosk ([variocube/kiosk](https://github.com/variocube/kiosk)) forwards the app page's browser console
output (`console.log`, `console.info`, `console.warn`, `console.error`) to the device's systemd journal. Operators read it
there for diagnostics, and log-analysis jobs may pick it up, so `console` is the normal way for a cube app to log; no
special logger is needed.

`console.debug` is dropped by default. An operator can enable it on a device with `LOG_CONSOLE_DEBUG=true` in
`/etc/default/variocube-kiosk`, so use it for chatty development output. The setting applies to the Cog-based kiosk. The
legacy Chromium-based kiosk always forwards `console.debug`, so don't rely on it being dropped. Keep `console.debug`
messages on a single line: the kiosk recognizes one by its first line only, so continuation lines (such as
`JSON.stringify(x, null, 2)` output or `err.stack`) are forwarded even when debug is off.

- Never log secrets: access tokens, API credentials, bootstrap grants, PINs or codes for opening compartments, or
  personal data beyond what diagnosis needs. Log identifiers instead of the object, and never dump whole
  request/response objects or headers. Whatever is logged ends up in plain text on the device and in log collections.
- Keep the volume low. Devices often run on SD cards or eMMC, and the journal shares their limited space and write
  endurance. Don't log in loops, timers or polling paths at info level or above; log state changes and errors, not every
  poll.

## Upgrading from SDK 1

- Bootstrap a session before application startup and pass it to `connect({session})` / `<CubeProvider session>`.
- The terminal's side of the cube comes from the controller, which derives it from the kiosk launch. The `secondary`
  connect option, the `CubeProvider` prop and SDK 1's `?secondary=` URL parsing are gone; `cube.secondary` is read-only
  and reports the side the controller sent when the connection authenticated. `openCompartment` opens that side's lock
  and rejects a compartment without one with `UNAVAILABLE` instead of the former local `NOT_FOUND`. `UNAVAILABLE` also
  covers a lock or owning terminal that is unreachable for now, so it is no reason to hide or disable the compartment.

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
for local checks and evidence limits. No Java or Node gateway service takes part in the SDK workflow.
