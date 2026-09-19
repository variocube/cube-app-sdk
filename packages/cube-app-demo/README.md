# Controller 6 demo

Run the native controller fixture as described in `../../test/README.md`, then `npm run dev` here.
The occupancy card accepts an allocation key: reserve twice with the same key to retrieve the same record,
including after ending it. Change the key for a new allocation. The key lookup displays retained ended
records separately from the active list.

**Concurrent patch** appends two separate entries to the occupancy's ledger concurrently. The published
ledger retains both entries. Unknown outcomes are never retried automatically; use **Refresh and reconcile**
to inspect the pushed record. No business state is persisted in browser storage.
