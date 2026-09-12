# Cube App Service

The service bridges browser SDK clients on port 4000 to the controller's `/app` VCMP endpoint on port 9000.
It relays hardware commands plus occupancy, storage-read, maintenance and token requests. Replies retain their
typed value or controller NAK code/message and return only to the requesting browser session.

```sh
npx @variocube/cube-app-service
```

The service keeps identity, capabilities, occupancies and hardware state in memory. It sends cached state when a
browser joins, clears app data on controller disconnect/app change, rejects pending requests, and ignores their
late replies. Storage invalidations are forwarded as changed keys; storage content remains in the controller.

Additive `availability {connected}` messages tell SDK clients when the upstream controller disappears while the
browser/service socket remains open. Capabilities are forwarded from the controller; after five seconds without
them the extensions become unsupported. Late capabilities upgrade support. Requests time out after ten seconds;
a sent mutation with a lost reply is `COMMAND_OUTCOME_UNKNOWN` and is never replayed. Controller receive order is
preserved, subject to the controller's documented lack of global snapshot/event ordering.

The hardware mock has no occupancy/storage state or signed identity. Real controller hardware state takes precedence
over mock configuration, while `/mock` scans can still drive UI tests. Occupancy/storage/token operations never fall
back to the mock. Raw VCMP logging is disabled so identity and token reply payloads cannot leak at verbose log levels.

See the [root API documentation](../../README.md) and [real-controller harness](../../test/README.md). `npm test`
from the repository root runs relay state-machine and real WebSocket runtime tests. `npm run test:controller`
exercises this service against the controller's memory-mode test runtime.

Core SDK, React SDK, and service are released together with `../../release.sh <version>` after merge. CI stamps the
version and publishes npm packages and the existing Debian package; committed versions stay at `0.0.0`.
