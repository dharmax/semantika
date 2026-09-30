# Codex Execution Brief — Durable Semantic Tags

You are working directly in **dharmax/semantika**.

Your task is to implement the durable semantic-tag redesign already accepted on `master`.

Read first, in this order:

1. `docs/tags/DESIGN.md`
2. `docs/tags/PLAN.md`
3. `README.md`
4. `decisions.md`
5. current implementation:
   - `src/tag.ts`
   - `src/semantic-artifact.ts`
   - `src/semantic-package.ts`
   - `src/vector-store.ts`
   - storage abstractions/backends
   - tag tests

Do **not** spend another pass redesigning the feature before touching code. The design is the authority unless the current code exposes a direct contradiction or impossible assumption. If that happens, solve the smallest underlying generic Semantika issue and document the reason.

## Prime directive

This is Semantika itself. Fix generic Semantika capabilities **properly here**.

Do not work around weak Semantika behavior in ai-cli, context-manager, or an application-specific adapter.

At the same time, do not turn this into a framework rewrite.

The desired architecture is still tiny:

```text
durable TagRecord registry
        ↓
in-memory alias index + taxonomy DAG + constraints
        ↓
artifact tagging + tag discovery
        ↓
optional derived vector index
```

Everything else must justify itself.

---

# Non-negotiable philosophy

1. **KISS is a correctness requirement.**
2. One owner per concern.
3. No raw SQL.
4. No new persistence framework.
5. No Tag-as-graph-entity ceremony.
6. No event bus, daemon, workflow engine, migration framework, cache-coherency subsystem, or repository pattern.
7. No fuzzy/string-distance code pretending to understand semantic synonymy.
8. No read API may mutate semantic state.
9. No fire-and-forget persistence.
10. No duplicate registry/index.
11. Vector storage is derived; TagRecord is semantic truth.
12. Backend behavior must remain generic across SQLite/Postgres/Mongo.
13. Prefer a few short obvious methods over configurable machinery.
14. Existing public compatibility is secondary to a correct, simple API. Preserve compatibility where cheap; do not deform the design to save a bad API.

If the implementation becomes surprisingly large or abstract, stop and simplify before continuing.

---

# Before mutation

Run and record baseline:

```bash
npm test
npm run build
```

Inspect the current public exports and the tests that exercise tag behavior.

Do not touch unrelated graph/entity/predicate architecture.

---

# GATE 1 — Durable registry and honest mutation

Implement Gate 1 completely before beginning semantic/vector work.

## 1. Durable TagRecord

Create one internal persisted TagRecord per canonical tag using ordinary Semantika storage abstractions.

The stored information should be essentially:

```ts
{
  name,
  description?,
  metadata?,
  abstract?,
  exclusive?,
  displayNames?,
  synonyms?,
  parents?,
  antonyms?,
  embedding?
}
```

Rules:

- `name` is immutable canonical identity.
- Do not persist `children`; derive them from `parents`.
- Avoid duplicated bidirectional truth.
- The collection is internal to TagTaxonomy.
- No backend-specific schema code.

Do not invent extra fields unless current code proves they are mechanically required.

## 2. Hydration / readiness

Persisted tag semantics must be loaded before taxonomy-dependent behavior is trusted.

Implement the **smallest honest async readiness boundary** compatible with current Semantika construction.

Preferred direction:

```ts
const sp = new SemanticPackage(...)
await sp.ready()
```

If an `open()` factory is materially cleaner, that is acceptable, but do not build two lifecycle APIs.

Requirements:

- hydration is idempotent;
- async package operations cannot race unfinished hydration;
- synchronous taxonomy reads before readiness must not silently return incomplete semantics;
- reopening a file-backed store reconstructs synonyms, parents, antonyms, display names and constraints.

Do not hide persistence behind unawaited property setters.

## 3. One mutation authority

Create one awaitable path for semantic tag mutation.

API can be close to:

```ts
await sp.tags.define(name, options)
await sp.tags.update(name, changes)
await sp.tags.remove(name)
```

Tag object convenience methods may delegate to it:

```ts
await tag.addParent(...)
await tag.addSynonym(...)
await tag.setDisplayName(...)
```

But there must be one implementation underneath.

The old synchronous mutation setters such as `tag.parent = ...` / `tag.synonym = ...` are not allowed to pretend they are durable.

Deprecate/remove them rather than performing background writes.

## 4. Alias index

Replace the current linear “scan all tags and return first match” lookup.

Maintain:

```ts
Map<normalizedAlias, canonicalName>
```

Alias sources:

- canonical name;
- display names;
- synonyms.

Normalization must be only mechanical:

- trim;
- Unicode normalize;
- case fold.

No stemming, fuzzy distance, AI, or heuristic synonym inference.

Alias collision between two canonical tags must fail clearly and deterministically.

## 5. Taxonomy integrity

Mutation must validate the proposed final state before persistence:

- no cycles;
- no self-parent;
- referenced parents exist;
- no self-antonym;
- referenced antonyms exist;
- aliases remain unique.

Do not silently repair corrupt durable metadata.

## 6. Declarative taxonomy

Existing taxonomy-loading ergonomics remain valuable, but it must use the same durable mutation authority.

Implement an awaitable/idempotent durable taxonomy loader.

Do not maintain “runtime taxonomy” and “persistent taxonomy” as separate systems.

## 7. Safe tag deletion

Default durable tag removal must not leave artifacts containing an orphaned canonical `_tags` value.

So:

```ts
await sp.tags.remove('foo')
```

must reject if the tag is still assigned to any entity/predicate.

Do not invent cascade/migration behavior in this ticket.

Removing an unused tag must remove its semantic metadata cleanly.

## 8. Requested exclusive-group replacement

Implement:

```ts
await doc.tag('Published', { replace: true })
```

and, if the existing variadic API can support it cleanly:

```ts
await doc.tag('Published', 'Featured', { replace: true })
```

Required semantics:

- default behavior is unchanged: exclusive-group conflict throws;
- with `replace: true`, an incoming tag removes **existing assigned descendants of the same exclusive ancestor**;
- add/remove is persisted as **one final artifact update / one version increment**;
- unrelated tags remain untouched;
- abstract-tag assignment still throws;
- antonym conflicts still throw;
- two new tags supplied in the same call that conflict through an exclusive ancestor still throw;
- never use argument order as semantic policy.

Example:

```text
before = [Draft, Security]
incoming = Published
replace = true
after = [Published, Security]
```

Keep the implementation concentrated in one tag-set transition helper rather than scattering replacement behavior through entity/predicate classes.

## Gate-1 proof

Add real file-backed SQLite restart tests.

At minimum prove:

```text
define:
  status abstract+exclusive
  draft parent=status
  published parent=status
  published synonym=released

tag artifact with draft
close DB
reopen SemanticPackage + ready()

=> synonym "released" resolves to published
=> taxonomy/status ancestry is intact
=> abstract/exclusive rules are intact
=> hasTag(status) works by subsumption
```

And prove all `replace` boundaries above.

Run full tests/build.

Only continue if Gate 1 is clean.

Commit Gate 1 separately.

---

# GATE 2 — TagTaxonomy-owned semantic search

The current manual `SemanticPackage.indexTagVector()` / `findSimilarTags()` split is not the final API.

## 1. Search belongs to the registry

Provide a clean API close to:

```ts
await sp.tags.configureSearch({
  vectorStore,
  embeddingProvider
})

const hits = await sp.tags.search('gpu server', {
  limit: 10,
  minScore: 0.6
})
```

Exact canonical/alias resolution and semantic search must return the same canonical Tag objects.

A useful hit shape is:

```ts
{
  tag,
  match: 'exact' | 'semantic',
  score?
}
```

Do not over-model it.

## 2. Critical correctness: reads never create tags

Today `findSimilarTags("unknown")` can call `tags.tag("unknown")`.

That must disappear.

```ts
await sp.tags.search('totally unknown phrase')
```

must leave registry size/state unchanged.

Exact alias resolution may return an existing tag; otherwise arbitrary query text is embedded directly.

## 3. Derived vector lifecycle

Once search is configured:

- existing known tags are indexed idempotently;
- define/update of semantic text refreshes the tag's vector;
- removal deletes its vector entry.

Semantic vector text should be derived from useful tag semantics:

- canonical name;
- display names;
- synonyms;
- description.

Do not add arbitrary weighting machinery.

Generated vectors are derived/cache data. Semantika remains correct with no vector store.

A simple full reindex on `configureSearch()` is preferred over an elaborate revision/hash system unless measurements prove it necessary.

## 4. Compatibility cleanup

Redirect/deprecate the existing manual SemanticPackage-level vector/tag APIs if practical.

Do not keep two independent vector lifecycle authorities.

## Gate-2 proof

Prove:

```text
persist tags
close package
reopen with fresh InMemoryVectorStore + embedding provider
configureSearch()
semantic query finds persisted tags
```

Then:

- update synonym/description;
- query reflects update without caller invoking re-index;
- delete unused tag;
- vector hit disappears;
- arbitrary unknown searches create no Tag.

Run full tests/build.

Commit Gate 2 separately.

---

# README / docs

After implementation:

- update README examples to the actual durable API;
- show `await sp.ready()` (or the chosen single lifecycle API);
- show durable taxonomy definition;
- show semantic search without manual `indexTagVector()`;
- add the requested exclusive replacement example:

```ts
await doc.tag('Published', { replace: true })
```

Explain briefly that `replace` is only for exclusive groups; antonyms still throw.

Do not leave examples for deprecated behavior presented as canonical.

Update `docs/tags/DESIGN.md` / `PLAN.md` only if implementation evidence forced a genuine design correction.

Update `kanban.md` ticket state accurately.

---

# Final adversarial audit

Before declaring completion, inspect every changed method in am-i-allowed style.

Reject your own implementation if you find:

- duplicated persistence paths;
- hidden semantic state;
- backend branching outside storage abstractions;
- registry + cache both acting as truth;
- read methods with side effects;
- linear alias scans;
- manual application vector bookkeeping still required;
- semantic heuristics encoded as string rules;
- setters launching async writes;
- exclusive replacement requiring multiple artifact writes;
- broad refactors unrelated to tags.

Run:

```bash
npm test
npm run build
```

Then inspect git diff for unnecessary changes.

## Completion report

Return a compact report containing:

1. commits produced;
2. core API changes;
3. tests/build result;
4. any compatibility break;
5. any design assumption that turned out false;
6. explicit confirmation that no shadow persistence/vector/tag system was introduced.

Do not merely plan. Implement and verify.
