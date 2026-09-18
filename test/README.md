# SDK validation

Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` from the repository root.
Core/React tests exercise authenticated readiness, nullable occupancy/storage contracts, generation and revision changes,
uncertain mutation outcomes, stale cache rejection, bounded requests and renewal failures.

## Real Chromium

```shell
npx playwright install --with-deps chromium
npm run test:browser
```

The real Chromium suite verifies query/hash restoration before grant exchange, no credential in HTTP URLs/referrers,
empty local/session storage and clean reload requiring a fresh launch. It uses a controlled HTTP exchange boundary.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an installed Chromium. Cog physical/VT evidence belongs in the coordinated
kiosk/controller acceptance record; headless Chromium does not establish it.

## Real native controller

Download the matching controller 6 candidate, or build it in `controller-rs` with
`cargo build --bin variocube-controller` (the binary is then `target/debug/variocube-controller`), and run:

```shell
variocube-controller dev --fixture single --listen 127.0.0.1:9000 --state /tmp/sdk-controller
CONTROLLER_URL=http://localhost:9000 npm run test:controller
```

The test registers a retained local `Kiosk` driver, requests `kiosk:Launch`, cleans and exchanges the fragment, and connects
the actual SDK with browser-origin headers. It exercises reserve/confirm/access/update/end, nullable and binary storage, app JWT audience
and raw unauthorized renewal. A local `ComputeUnit` driver and the kiosk acknowledge real SDK UI, OS and controller restart
requests without executing physical actions. Use an isolated fixture instance: the test accepts real domain mutations.

Expected fixture: installed `dev-app` at `http://localhost:5173/?mode=dev#/home`, allowed local drivers `kiosk` and `unit`,
available boxes, `configuration` JSON `{theme:"light"}`, `nullable` JSON null,
`binary` bytes `[0,1,255]`. Production services, Java and physical drivers are not prerequisites.
The developer chooses persistent state explicitly; remove/reset only that selected instance when repeating tests.
