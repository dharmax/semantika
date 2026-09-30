# Durable Semantic Tags — Design

**Status:** implementation pending  
**Scope:** `@dharmax/semantika`  
**Core rule:** tag semantics are durable package data; vector search is a derived index.

## 1. Diagnosis

The current tag subsystem is good **inside one process**:

- first-class `Tag`;
- multi-parent DAG taxonomy;
- synonyms/display names;
- abstract/exclusive/antonym constraints;
- taxonomy-aware boolean matching;
- tag exposition;
- pluggable vector similarity.

The defect is lifecycle.

Artifacts persist only canonical strings in `_tags`. The metadata that gives those strings meaning is held in `TagTaxonomy.tagMap`:

- parents;
- synonyms;
- display names;
- antonyms;
- abstract/exclusive constraints;
- descriptions/metadata;
- embeddings.

After restart, that semantic registry must be reconstructed manually. Vector indexing is also manual and separate from tag mutation.

Two additional API defects follow from this:

1. `findSimilarTags("unknown")` currently calls `tags.tag(...)`, so **a read/search can create a tag**.
2. `TagTaxonomy.get()` linearly scans all tags for aliases and silently returns the first collision.

The repair should strengthen the existing model, not replace it.

## 2. Invariants

1. **One canonical registry.** A tag's identity and semantic metadata have one durable source.
2. **Canonical names are immutable IDs.** Alternative wording is a synonym/display name, not a rename operation.
3. **Reads never mutate.** Search/resolution cannot create tags.
4. **Alias resolution is exact and unambiguous.** No fuzzy/string-distance synonym logic.
5. **Taxonomy remains a DAG, not graph-entity ceremony.**
6. **Vector data is derived.** The semantic registry remains correct with no vector store attached.
7. **Vector lifecycle follows tag lifecycle.** Callers should not manually remember to re-index after every mutation.
8. **No raw-SQL special case.** Use Semantika storage abstractions.
9. **Durability requires awaitable mutation.** Do not pretend synchronous setters persisted remote/async storage.
10. **Keep it small.** No event bus, migrations framework, background daemon, or second ontology.

## 3. Durable TagRecord

Persist one compact record per canonical tag in a reserved internal basic collection owned solely by `TagTaxonomy`.

Conceptually:

```ts
type TagRecord = {
  name: string                    // immutable canonical identity
  description?: string
  metadata?: Record<string, unknown>

  abstract?: boolean
  exclusive?: boolean

  displayNames?: Record<string, string>
  synonyms?: Record<string, string[]>

  parents?: string[]              // canonical names
  antonyms?: string[]             // canonical names

  embedding?: number[]            // optional cache/manual vector, never semantic truth
}
```

Do **not** store `children`; derive them from parents when hydrating.

Do **not** store bidirectional antonyms twice as independent truth. Persist a normalized representation and rebuild the reverse links in memory.

The collection is an implementation detail. Applications interact only through `TagTaxonomy`.

## 4. Hydration / package lifecycle

A durable semantic registry must be fully loaded before synchronous operations such as `hasTag()` can rely on taxonomy/synonyms.

Therefore Semantika needs an explicit ready boundary.

Preferred public shape:

```ts
const sp = await SemanticPackage.open(name, ontology, storage)
```

or equivalently a clearly documented `await sp.ready()`.

The canonical lifecycle must guarantee:

```text
storage available
→ persisted TagRecords loaded
→ alias index rebuilt
→ DAG/antonyms validated and linked
→ package becomes ready
```

Normal async package operations should not be able to race hydration.

Do not hide asynchronous persistence behind synchronous property setters.

## 5. Clean mutation API

The existing fluent runtime API conflates lookup and mutation. Durable semantics need an awaitable write path.

Canonical API should be close to:

```ts
const tag = await sp.tags.define('published', {
  displayName: 'Published',
  parents: ['status']
})

await sp.tags.update('published', {
  synonyms: { en: ['released'] }
})

await sp.tags.remove('obsolete-tag')
```

And convenient object methods may delegate to the same authority:

```ts
await tag.addParent('status')
await tag.addSynonym('released')
await tag.setDisplayName('Published')
```

Every mutation:

1. validates the full proposed registry state;
2. persists the TagRecord;
3. updates the in-memory indexes/DAG;
4. refreshes/removes its vector entry if semantic search is configured.

No duplicate mutation path.

### Existing synchronous setters

APIs such as:

```ts
tag.parent = ...
tag.synonym = ...
```

cannot honestly guarantee persistence across SQLite/Postgres/Mongo.

They should be removed/deprecated rather than implemented with fire-and-forget writes.

## 6. Alias index

Build a direct index during hydration/mutation:

```ts
Map<normalizedAlias, canonicalName>
```

Aliases include:

- canonical name;
- display names;
- synonyms.

Normalization is mechanical only: trim + case-fold + Unicode normalization.

A proposed alias already owned by another tag is an error.

This turns `get(nameOrAlias)` into deterministic O(1) resolution and prevents the current “first matching tag wins” behavior.

No fuzzy matching here; semantic similarity belongs to vector search.

## 7. Taxonomy integrity

Keep the current useful semantics:

- multi-parent DAG;
- abstract tags;
- exclusive ancestors;
- antonyms;
- descendant subsumption;
- boolean tag expressions.

Validate mutations **before persistence**:

- no cycles;
- all referenced parents/antonyms exist;
- no alias collision;
- no self-parent/self-antonym.

Hydration should reject/diagnose corrupt persisted registry data rather than silently constructing a partial graph.

## 8. Artifact tagging + `replace`

Artifact `_tags` remain persisted canonical tag names.

Keep strict behavior by default:

```ts
await doc.tag('Draft')
await doc.tag('Published')
// throws: both are descendants of exclusive Status
```

Add the requested option:

```ts
await doc.tag('Published', { replace: true })
```

Semantics:

- resolve all input tags to canonical names;
- validate abstract/antonym rules as usual;
- if a **new** tag belongs to an exclusive ancestor, remove existing assigned descendants of that same exclusive ancestor;
- add the new tag;
- write the final `_tags` array in **one artifact update/version increment**.

Example:

```text
before: [Draft, Security]
add: Published + replace
after: [Published, Security]
```

Important boundaries:

- `replace` applies to declared **exclusive-group conflicts**;
- antonym conflicts still throw;
- if two tags supplied in the same call conflict with each other, throw rather than using argument order as hidden policy;
- abstract tags still cannot be assigned;
- without `replace`, existing strict/error behavior remains.

Ergonomic forms may support:

```ts
await doc.tag('Published', { replace: true })
await doc.tag('Published', 'Featured', { replace: true })
```

There must still be one underlying implementation.

## 9. Deletion semantics

Deleting semantic metadata while artifacts still reference the canonical tag would create dangling meaning.

Therefore default removal is safe:

```ts
await sp.tags.remove('foo')
// rejects if artifacts still use foo
```

A destructive detach/migration operation may be added later if product evidence requires it. Do not silently leave orphaned `_tags`.

Removing a tag also removes its vector entry.

Canonical rename is deliberately absent. Add a synonym/new tag + explicit migration if that use case becomes real.

## 10. Semantic search belongs to TagTaxonomy

Move tag-search lifecycle behind the tag registry.

Target API:

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

A hit should identify why it matched:

```ts
type TagSearchHit = {
  tag: Tag
  match: 'exact' | 'semantic'
  score?: number
}
```

Rules:

- exact canonical/alias resolution is returned first;
- semantic search embeds arbitrary query **without creating a tag**;
- vector hits must correspond to existing canonical tags;
- deleted/stale unknown vector IDs are ignored and may be cleaned;
- no vector store => exact/alias search still works perfectly.

Existing `tag.similar()` can become a convenience wrapper over the same engine.

## 11. Vector lifecycle

The vector store is an index, not truth.

A semantic representation can be derived from:

```text
canonical name
display names
synonyms
description
```

Do not invent weighting/ranking policy in host code beyond what the configured vector store returns.

When search is configured:

- define/update tag → upsert vector;
- remove tag → delete vector;
- startup/configuration → idempotently index known tags as needed.

A simple first implementation may re-index all tags when semantic search is configured. Tag registries are expected to be small compared with artifact collections, and correctness is more important than premature incremental-index machinery.

If later scale proves this expensive, add revision/hash optimization then.

## 12. Embeddings

`embedding` may remain as an optional explicit/cache field for callers that supply vectors directly.

Generated embeddings are not the semantic source of truth.

If an embedding provider exists, Semantika can regenerate derived vectors from tag text after restart. No separate ai-cli/context-manager vector persistence is required.

## 13. Static taxonomy + learned taxonomy

Applications may still ship a base taxonomy declaratively.

Loading it must go through the same durable registry authority:

```ts
await sp.tags.defineTaxonomy({...})
```

It is an idempotent upsert/validation operation, not an unrelated in-memory overlay.

Dynamically learned synonyms/parents use the same API and therefore naturally survive restart.

There is no “static taxonomy system” plus “dynamic taxonomy system.”

## 14. Cross-backend behavior

The behavior must be backend-independent:

- SQLite;
- Postgres;
- Mongo.

Tag metadata persistence uses ordinary Semantika collection APIs.

Tests must prove restart/re-hydration against SQLite at minimum; generic storage tests should cover the same record contract for other available backends.

## 15. What not to build

Do not add:

- Tag entities/predicates just to persist the taxonomy;
- raw SQL tables;
- a second tag store;
- a separate synonym index database;
- fuzzy synonym heuristics;
- a taxonomy daemon;
- event sourcing;
- distributed transactions with the vector store;
- silent async writes from property setters;
- application-specific AI policy.

Semantika supplies durable semantic primitives. AI/application layers decide what tags/relations mean for their domain.

## 16. Acceptance

The repair is complete only when all of these hold:

1. Define tag + synonym + parent, restart package, and all semantics still work.
2. `hasTag(parent)` continues to subsume after restart.
3. Synonym lookup continues to canonicalize after restart.
4. Duplicate aliases are rejected deterministically.
5. A search for unknown text does not create a tag.
6. Semantic search works after restart/configuration without application-maintained vector bookkeeping.
7. Updating semantic metadata refreshes its vector entry.
8. Removing a tag removes its vector entry.
9. Default tag deletion refuses to orphan artifact assignments.
10. `doc.tag('Published', {replace:true})` atomically replaces existing exclusive-group tags.
11. `replace` does not suppress antonym/abstract errors or resolve conflicts among the new tags themselves.
12. SQLite/Postgres/Mongo share the same public behavior.
13. Existing artifact `_tags` remain canonical strings; no migration to graph nodes is required.
14. The final implementation is smaller conceptually than the current split-brain lifecycle.

## 17. Resulting model

```text
                 durable TagRecord registry
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
        alias index     taxonomy DAG   constraints
            │              │              │
            └──────────────┴──────────────┘
                           │
                    TagTaxonomy API
                      │          │
               artifact tags   semantic search
                      │          │
                  persisted    derived vector index
                    _tags
```

One registry. One mutation path. Derived indexes. No semantic state hidden in process memory.
