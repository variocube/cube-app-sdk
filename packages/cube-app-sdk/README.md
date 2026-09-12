# Cube App SDK

`connect()` returns a `Cube` with hardware commands/events, `occupancies`, controller-backed `storage`, and signed
`identity`/`getToken()`. Occupancy and storage APIs require a real controller and exactly one installed Center app;
requests cannot choose an app ID. The service/mock still supports hardware UI development.

See the [root README](../../README.md) for API examples, availability and typed errors, storage null/missing semantics,
token use before fetch/OpenAPI requests, and unknown-outcome recovery. React consumers should use
[`@variocube/cube-app-react-sdk`](../cube-app-react-sdk/README.md) and its shared `CubeProvider`.

Caches and credentials live only in memory and clear on disconnect/app change. The SDK never automatically replays
mutations after timeouts or reconnects. Use an authoritative occupancy read and a known UUID/handover reference to
reconcile an uncertain operation. Browser storage is not an authority for business state.

Run `npm test`, `npm run typecheck`, and `npm run build` from the repository root. Shared wire fixtures and opt-in
real-controller checks are documented in [test/README.md](../../test/README.md). Core SDK, React SDK, and service are
released together through `../../release.sh <version>` after merge.
