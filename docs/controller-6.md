# Controller 6 browser contract and provenance

Stage: [controller-rs #5](https://github.com/variocube/controller-rs/issues/5).

## Reviewed source

- Released SDK baseline: tag `1.3.1`, commit `ccdeb6138974f0bfaa01b18dabeabca221e40a3e`.
- Committed unreleased occupancy/storage/identity baseline: `960ac1e38c1b52653dc1addcef2484350aeb8be6`,
  [SDK PR #57](https://github.com/variocube/cube-app-sdk/pull/57), branch `feat/55-occupancy-storage`.
- The original SDK worktree was clean and remains unchanged. This branch was developed in an isolated worktree on
  that committed baseline. The new protocol must not be attributed to released SDK 1.3.1 or Java controller HEAD.
- `test/fixtures/controller-wire.json` remains byte-identical to its reviewed Java wire source. Its legacy capabilities
  example belongs only to the retired Node service tests; the new SDK has no capability APIs or feature negotiation.

## Wire and lifecycle

`POST /app/bootstrap` takes JSON `{grant}` and returns `{credential,expiresAt,generation}`. Renewal uses
`POST /app/renew` and `Authorization: Bearer <local credential>`. Times are Unix seconds. Credentials remain in memory,
renew 30 seconds before expiry and are never sent as URL parameters. Fetch omits cookies, disables caching/referrers,
and rejects redirects. A grant is delivered as `#vc-bootstrap=<percent-encoded JSON {grant,fragment}>`; fragment includes
its original leading `#` or is empty. Cleanup happens synchronously, including malformed envelopes.

WebSocket `/app` uses VCMP. First request: `{ "@type":"authenticate", "protocolMajor":6, "credential":"..." }`.
Its ACK is `{protocolMajor:6,generation}`. Until the ACK validates, the SDK buffers at most one initial snapshot plus
64 events within 256 KiB; rejected/disconnected authentication discards that buffer without publishing protected data. The initial event is:

```json
{
  "@type": "initialState",
  "generation": 1,
  "revision": 0,
  "identity": { "cubeId": "cube-1", "appId": "dev-app", "token": null, "expiresAt": null },
  "compartments": [],
  "devices": [],
  "occupancies": [],
  "storageReady": true
}
```

Subsequent events carry the same generation and a contiguous per-session publication revision, increasing once per
event. ACK results use `{generation,revision,result}` without advancing publication revision. Revisions describe the
session's stream, including local device/identity events; they are not a global domain transaction sequence. Gaps close
and reopen the socket to resnapshot. Changed app generations require a fresh kiosk launch and never inherit authority.

The mandatory request payloads retain the reviewed occupancy/storage/hardware names. Server ownership, nullable
occupancy content and actor/action fields, `occupancyCreated` confirmation upserts and `occupancyEnded` cancellation
removals remain intact. Zod validates event and response boundaries. At most 64 requests and 64 KiB per request are
admitted, each with its original 10-second deadline. Timeouts close the underlying VCMP session to reclaim correlation
callbacks. Sent mutations become uncertain; reads return a timeout/disconnect. No automatic mutation replay occurs.
Storage caches hold at most 128 values of at most 64 KiB each; invalidation bookkeeping is bounded at 256 keys.

## Validation and remaining evidence

`npm test`: SDK wire/session tests and React tests, plus retained legacy Node-service regression tests.
`npm run typecheck` and `npm run build`: source, demo and test compilation and production bundles.
`npm run test:browser`: real headless Chromium tests of early cleanup, arbitrary query/hash routing, empty browser
credential storage, referrer suppression and reload requiring fresh bootstrap. HTTP exchange is a controlled test
boundary in this suite; it does not stand in for native controller or physical kiosk evidence.
`npm run test:controller`: opt-in real native Rust lifecycle/storage/token tests using the trusted Unix launcher.

Physical Cog/Chromium touch, VT, driver feedback and full upgrade/fleet evidence are recorded by the coordinated
controller/kiosk stages. This SDK branch alone does not establish their acceptance or publish a release.
