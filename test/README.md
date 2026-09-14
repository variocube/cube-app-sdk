# SDK validation

Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` from the repository root.
Core/React tests exercise authenticated readiness, nullable occupancy/storage contracts, generation and revision changes,
uncertain mutation outcomes, stale cache rejection, bounded requests and renewal failures. Retained Node-service tests
are SDK 1 compatibility regressions and do not run the new SDK through a Java relay.

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

Download/build the matching controller 6 candidate and run:

```shell
controller dev --fixture single --listen 127.0.0.1:9000 --state /tmp/sdk-controller
CONTROLLER_URL=http://localhost:9000 CONTROLLER_KIOSK_SOCKET=/tmp/sdk-controller/kiosk.sock npm run test:controller
```

The test obtains `/launch` over the trusted Unix socket, cleans and exchanges the fragment, and connects the actual SDK
with browser-origin headers. It exercises reserve/confirm/access/update/end, nullable and binary storage, app JWT audience
and raw unauthorized renewal. Use an isolated fixture instance: the test accepts real domain mutations.

Expected fixture: installed `dev-app`, available boxes, `configuration` JSON `{theme:"light"}`, `nullable` JSON null,
`binary` bytes `[0,1,255]`. Production services, Java, physical drivers and `cube-app-service` are not prerequisites.
The developer chooses persistent state explicitly; remove/reset only that selected instance when repeating tests.
