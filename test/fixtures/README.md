# Controller wire fixtures

`controller-wire.json` is copied byte-for-byte from
`variocube/controller` commit `65975af`, `src/test/resources/app/wire.json`.
It pins VCMP request correlation, the missing-document NAK, JSON (including null), binary storage,
capabilities, an empty authoritative snapshot, and a storage invalidation.

The SDK and service tests consume this fixture. Update it alongside the controller fixture when
the shared contract changes; do not reformat the JSON independently.

The controller's current lifecycle records use `pending`, `confirmed`, and `ended` states.
Cancellation is delivered as `occupancyEnded {uuid}`; confirmation upserts via `occupancyCreated`.
The controller README explicitly relaxes the original issues' global snapshot/event ordering
guarantee. The relay preserves received order, but cannot establish controller commit order.
