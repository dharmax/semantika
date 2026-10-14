# Semantika — Storage Sessions and Transactions
## Design and implementation plan (not yet implemented)

**Baseline inspected:** `master` at `a8a9e06bc694d1d35edf17b2a30346e40bdea2a7`. Revalidate HEAD, callers and tests before coding. **Goal:** finish the existing storage-session contract so consumers such as AIWF can request an atomic operation without knowing the database engine. Keep the API small and backend-owned. No generic transaction framework or AIWF-specific SQL.

## 1. Existing facts and actual problem

- `src/storage/storage.ts`: `StorageSession = any`; `AbstractStorage.startSession()` exists, but there is no unified typed contract for transaction capabilities, ownership or session-bound entity calls.
- `src/storage/sqlite-store/sqlite-store.ts`: `startSession().withTransaction(fn)` simply invokes `fn()`; it provides **no transaction guarantee**. Its collection methods use a shared synchronous SQLite connection behind asynchronous APIs.
- `src/storage/postgres-store/postgres-store.ts`: `startSession()` returns a pooled client, but collections currently use `pool`, not necessarily the session client.
- `src/storage/mongo-store/mongo-store.ts`: `startSession()` returns the native session, but collection operations must actually receive/use that session.
- `src/abstract-entity.ts`: `update()` mutates the entity instance and `_version` after a successful physical write. SQL rollback alone does not restore retained JS instances.
- `src/semantic-package.ts`: collection wrappers are cached and package discovery uses a global name registry. Do not construct a second same-named SemanticPackage as a transaction shortcut.
- Demonstrated failure in AIWF: passing an `async` callback to Bun's synchronous `db.transaction(fn)` commits before awaited Semantika operations settle; a subsequent exception leaves a partial write.

## 2. Desired small public contract

Prefer one ergonomic entry point on `SemanticPackage`, backed by the **existing** storage/session abstraction:

```ts
await sp.withTransaction(async tx => {
  const rule = await tx.createEntity(Rule.dcr, fields)
  // Other supported Semantika entity/collection operations through tx,
  // including updates on entities obtained from this tx context.
}, { requireAtomic: true })
```

This is illustrative, not a demand to duplicate the whole SemanticPackage API. Define the narrowest typed session-bound facade that allows the real participating reads/writes and existing entity validation/version checks. Ordinary methods remain unchanged outside a transaction. A transaction-bound entity must route its persistence through the corresponding context; it must not silently fall back to the global/default collection. Do not rely on ambient mutable package state or implicit async context.

A typed storage session owns `withTransaction` (or begin/commit/rollback underneath, if useful), `endSession`, and capability information. The caller does not manually manage `BEGIN`/`COMMIT`. Ensure cleanup in `finally`.

**Capability semantics:**
- `requireAtomic: true`: if the adapter cannot guarantee the requested atomic scope, reject **before invoking the callback or mutating data**. AIWF will use this for governed pack import.
- Default / `requireAtomic: false`: on a nontransactional adapter, the session may execute the callback normally, explicitly without atomicity. An exception does not claim rollback. Report capability truthfully, including in return type/metadata or explicit session property; never silently promise ACID.
- Existing adapters may differ in capability; do not fake parity or add cross-backend compensating rollback.
- Nested transactions: explicitly reject initially, unless a tested native nesting contract already exists. No generic savepoint engine.

## 3. Ownership and engine behavior

| Owner | Contract |
| --- | --- |
| SemanticPackage | Thin `withTransaction` convenience: acquire session, invoke callback with bound operations, release session; preserve validation and entity contracts |
| AbstractStorage / StorageSession | Typed capability and lifecycle contract; session-bound collection acquisition/operations; explicit unsupported-atomic failure |
| SQLite adapter | Adapter-owned BEGIN / await entire callback / COMMIT or ROLLBACK; **exclusive ownership of its connection for the session duration**. Unrelated operations must queue or use an isolated connection, never inadvertently join the transaction. Work with in-memory SQLite too |
| PostgreSQL adapter | One dedicated checked-out client for all participating operations; transaction commands and release in finally; no accidental pool operations inside tx |
| MongoDB adapter | Native session/transaction, and pass the session through actual collection reads/writes; release in finally |
| Nontransactional adapters | No-op session for best-effort callback; reject `requireAtomic` before callback |

Avoid creating another persistence API, replacing entity descriptors, adding a shadow cache, or putting transaction SQL in AIWF. Use the backend's real transaction support; don't assume that an asynchronous JavaScript signature implies asynchronous physical I/O.

**In-memory coherence:** transaction-bound mutable entities are not published/reused as committed state before success. On rollback, invalidate or refresh transaction-bound instances rather than leaving stale `_version`/fields available as valid live entities. Verify whether tag taxonomy or any other in-memory projection also needs commit-time publication. Minimize scope: no universal object-snapshot/rollback machinery without a demonstrated need.

**Concurrency:** the adapter must guarantee that unrelated operations on its underlying connection are isolated from the transaction, including operations that occur while the callback is suspended at `await`. Test ordinary reads/writes overlapping an open transaction. Define behavior on concurrent sessions and on using a session after close.

## 4. Gated implementation plan

**Gate S0 — design and baseline:** Revalidate current source and actual storage usage. Identify the minimal session-bound call path through `SemanticPackage`, `EntityCollection`, `AbstractEntity`, and the physical collection adapters. Record current tests and compatibility. Show how an entity update remains bound to the transaction. Do not code before this is clear.

**Gate S1 — contract and SQLite:** Replace `StorageSession = any` with a tight contract. Implement thin public `withTransaction` and actual SQLite transaction ownership. Preserve ordinary nontransactional CRUD and validation. Add tests with **actual Semantika entity operations**, not direct SQL/mocks: commit; injected failure after successful insert; update rollback and retained entity version; unrelated overlapping write; nested attempt; in-memory SQLite; release/cleanup.

**Gate S2 — backend fidelity:** Bind Postgres and Mongo collection operations to their real sessions, or explicitly report atomic support unavailable until properly tested. Add a minimal fake nontransactional adapter test verifying callback execution without rollback promises and pre-callback rejection under `requireAtomic`. Do not claim live DB coverage if unavailable.

**Gate S3 — integration/quality:** Confirm persistence after restart, optimistic versions, tags/indexes/predicates where included in scope, no partial writes, no connection leaks and full existing suite/typecheck/build. Whole-touched-method review. Document the API with realistic examples. Update dependent AIWF only after a stable Semantika release; AIWF Gate 1 individual Rule CRUD is independent, while Gate 4 atomic pack import consumes `requireAtomic: true`.

## 5. Acceptance, non-goals and rollout

**Required adversarial acceptance:** async failure after first write leaves no write; failed update preserves DB state and future legitimate updates work; unrelated concurrent write does not join/rollback with the transaction; unsupported adapter refuses atomic execution before side effects; best-effort no-op session reports non-atomicity; operations cannot use a closed session; no native SQL bypass from AIWF.

Keep this change small. Not in scope: distributed transactions, multi-database atomicity, retry scheduler, general async-local session propagation, automatic recovery of arbitrary external references to mutated JS objects, automatic savepoint nesting, backend-emulating rollback or a new unit-of-work framework.

**Deliverable:** a stable, documented Semantika capability with evidence; not a new persistence architecture. Do not mutate AIWF during Semantika design work.
