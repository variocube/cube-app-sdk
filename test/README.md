# Tests and the real-controller harness

`npm test` runs the SDK, service relay/runtime, and React component tests with Vitest.
`npm run typecheck` also checks test and demo code against workspace source, without relying on old build output.
The shared controller fixture is pinned in [fixtures](fixtures/README.md).

## Real controller acceptance

Use a controller checkout containing issue #151's landed implementation and test-only `e2eController` task
(tested against commit `65975af`). It requires the controller's Java/Gradle toolchain and dependencies.
Start this isolated memory-mode controller in another terminal:

```sh
cd ../controller
./gradlew e2eController --args='--server.port=19000 --controller.center=ws://127.0.0.1:17000/center'
```

Then run from this repository:

```sh
npm ci
npm run test:controller
```

The test opens a loopback Center VCMP fixture on port 17000 and cube-app-service on port 14000. It waits for the
controller's next Center reconnect (up to 55 seconds), seeds a box and a lock through `/test/fixtures`, then uses
the core SDK through the service. Ports 14000, 17000 and 19000 must be free before starting the harness.
Use only this fresh memory-mode test instance: the test replaces installed apps, storage, and occupancies.

Coverage includes reserve/cancel/confirm/update/access/end, controller lock open/close notifications, JSON/null/
binary reads, Center-driven deletion, maintenance updates, app A→B, zero/two installed apps, foreign UUID rejection,
and continued operation with Center disconnected. It checks the real token's ES256 signature against `/identity`,
cube subject, exact app audience, and expiry. The local Center fixture does not implement backend enrollment,
tenant authorization, or Logistics authentication; those remain the Center/app-common/Logistics integration tests.

Storage writes enter through actual controller Center listeners using `cube:AppStorageItemChanged` with
`{appId,key,value:{contentType,data:<base64>}}`; deletion uses `cube:AppStorageItemDeleted {appId,key}`.
This is a test Center peer, not an SDK write API. No bearer token or authorization header is printed.

## Interactive demo

For the browser demo, start the controller harness on its normal port:

```sh
cd ../controller
./gradlew e2eController --args='--server.port=9000'
```

It binds to loopback, uses memory storage, and resolves `e2e-app` on `e2e-cube`. For an existing Center app ID use
`--controller.app=<exact-app-id>` and `--controller.cube-id=<cube-id>`. The next real Center installed-app snapshot
replaces the development override. For storage data, connect to a development Center using the controller's
normal configuration and write through that Center, or use the isolated automated test above.

Seed the box/lock, then start the service and demo in separate terminals:

```sh
curl -X POST http://127.0.0.1:9000/test/fixtures -H 'Content-Type: application/json' \
  -d '[{"number":"1","types":["small"],"lock":"fixture-1"}]'
npm run dev --workspace=@variocube/cube-app-service
npm run dev --workspace=@variocube/cube-app-demo
```

Opening `fixture-1` changes the controller's LockManager state to Open. Feed the subsequent close through the
controller fixture, then confirm the reservation in the demo:

```sh
curl -X POST http://127.0.0.1:9000/test/locks -H 'Content-Type: application/json' \
  -d '{"lock":"fixture-1","status":"Closed"}'
```

`/mock` scans may drive UI tests. Service-only mock lock events do not demonstrate a controller door cycle.
The controller fixture endpoints are included only in its test runtime, never its shipped packages.

## Recovery and ordering

Tests exercise lost replies without mutation replay, pending-request rejection, late-result suppression,
capability negotiation, snapshot replacement and cache clearing. A sent allocation/open/end with no reply has
an unknown outcome; reconcile by known UUID or handover reference before continuing.

The landed controller explicitly relaxed global commit ordering between snapshots and concurrent notifications.
These tests establish relay receive order and generation isolation, not an upstream global ordering guarantee.
Fresh authoritative `list()`/`get()` calls support reconciliation; unresolved allocation remains a recovery state.

Full Logistics payload/cutover/rollback acceptance is owned by `logistics#1674` and `logistics#1675`.
Core SDK, React SDK, and service are released together via `./release.sh <version>` after merge; the existing
Debian package and runtime selection remain unchanged.
