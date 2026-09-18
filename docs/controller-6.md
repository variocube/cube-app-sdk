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
  "occupancies": []
}
```

Subsequent events carry the same generation and a contiguous per-session publication revision, increasing once per
event. ACK results use `{generation,revision,result}` without advancing publication revision. Revisions describe the
session's stream, including local device/identity events; they are not a global domain transaction sequence. Gaps close
and reopen the socket to resnapshot. Changed app generations require a fresh kiosk launch and never inherit authority.

The SDK sends authentication and mutations only. `getOccupancy`, `getOccupancies`, `getStorageItem`, `getStorageKeys`
and `getToken` are removed from the wire. The public read methods are synchronous and read the latest complete pushed cache without
network requests. Local reads can trail a just-acknowledged mutation until its publication arrives; use events or wait
for the expected UUID/state when reconciling. No mutation is replayed automatically.

Initial storage follows `initialState`, then `ready {generation,revision}` commits authenticated readiness. Every
publication uses the contiguous per-session revision, including storage chunks and the ready barrier:

- `storageItem {generation,revision,key,contentType,encoding,content}` contains the complete value; encoding is `json`
  or `base64`. Explicit JSON null is a value, not deletion.
- `storageItemRemoved {generation,revision,key}` explicitly deletes a key.
- `storageChunk {generation,revision,key,index,total,content}` carries standard base64 of at most 48 KiB of raw bytes.
  The zero-based chunks arrive sequentially. Concatenated bytes are UTF-8 JSON for the complete StorageItem object
  `{key,contentType,encoding,content}`. The replacement becomes visible only after all chunks validate.
- `cube` pushes current identity and renewed backend JWTs. The SDK keeps the JWT out of `cube.identity` and the
  `identity` event, so a rotation is not a public identity change. `getToken()` validates the current cached audience and
  expiry; it never requests a replacement token. Controller renewal must arrive before expiry.

Storage holds the complete app snapshot without eviction: at most 16384 keys, 1 MiB + 4096 bytes per serialized item,
68 MiB total serialized content, and one incomplete transfer. This covers the supported 64 MiB persisted store plus
wire metadata. Overflow, malformed chunks and incomplete transfers fail closed. Disconnect or a changed app generation
clears all caches; an incomplete snapshot never becomes ready or reports missing data as an empty store. A complete
same-generation resnapshot can replace data at its ready barrier; it does not retry pending mutations.

Zod validates event and response boundaries. At most 64 mutation requests and 64 KiB per request are admitted, with a
10-second deadline. Timeouts close the underlying VCMP session to reclaim correlations and report
`COMMAND_OUTCOME_UNKNOWN`. Authentication/initial storage and each chunked item also have bounded deadlines.

`session.openMaintenance()` navigates normally to the trusted controller's `/maintenance?returnUrl=...`, carrying only
the clean current app URL. It requests no maintenance context and passes no credential in that URL. Technician login
belongs to the maintenance UI. When a page has no bootstrap envelope, `bootstrapSession()` makes at most one bounded
`POST /app/relaunch` request per page, then reports authentication required while waiting for the trusted kiosk to reload
a fresh launch. The controller authorizes that unauthenticated retry only for an actual loopback peer and the configured
app Origin. The response cannot issue a grant to this helper, choose navigation or trigger automatic retries.

## Validation and remaining evidence

`npm test`: SDK wire/session tests and React tests, plus retained legacy Node-service regression tests.
`npm run typecheck` and `npm run build`: source, demo and test compilation and production bundles.
`npm run test:browser`: real headless Chromium tests of early cleanup, arbitrary query/hash routing, empty browser
credential storage, referrer suppression and reload requiring fresh bootstrap. HTTP exchange is a controlled test
boundary in this suite; it does not stand in for native controller or physical kiosk evidence.
`npm run test:controller`: opt-in real native Rust lifecycle/storage/token tests using a retained VCMP kiosk driver,
plus real SDK restart dispatch to mock local kiosk/ComputeUnit drivers.

Physical Cog/Chromium touch, VT, driver feedback and full upgrade/fleet evidence are recorded by the coordinated
controller/kiosk stages. This SDK branch alone does not establish their acceptance or publish a release.
