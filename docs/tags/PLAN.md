# Durable Semantic Tags — Implementation Plan

**Design:** `docs/tags/DESIGN.md`  
**Rule:** repair lifecycle and ownership; do not redesign Semantika around the ai-cli use case.

## Gate 1 — Durable registry and honest mutation API

1. Add internal persisted `TagRecord` collection owned by `TagTaxonomy`.
2. Add package/tag-registry hydration and an explicit ready boundary.
3. Rebuild in-memory DAG + alias index from persisted records.
4. Replace mutation-through-sync-properties with one awaitable mutation authority:
   - define/update;
   - parent/synonym/display/antonym changes;
   - removal.
5. Enforce canonical alias uniqueness.
6. Make declarative taxonomy loading idempotent and durable through the same path.
7. Add safe removal: reject deletion while canonical tag is still assigned to artifacts.
8. Add artifact tagging option:
   ```ts
   await doc.tag('Published', { replace: true })
   ```
   - replace existing descendants of the same exclusive ancestor;
   - one final artifact write;
   - antonyms/abstract tags/new-vs-new conflicts still throw.

### Gate-1 proof

Use file-backed SQLite, not only `:memory:`:

```text
define taxonomy + synonyms
→ tag artifacts
→ close storage
→ reopen package
→ taxonomy/subsumption/synonyms/constraints are identical
```

Also prove:

```text
Draft assigned
→ tag Published normally => error
→ tag Published with replace => [Published]
```

Do not proceed while any semantic metadata still depends on process-only reconstruction.

## Gate 2 — Semantic-search lifecycle

1. Move tag semantic-search ownership into `TagTaxonomy`.
2. Add non-mutating arbitrary-text `search(query)`.
3. Ensure exact alias/name lookup and vector search share canonical Tag objects.
4. Configure vector store/embedder through one tag-registry API.
5. Automatically:
   - index tags on search configuration/startup;
   - refresh on semantic metadata mutation;
   - delete vector on tag removal.
6. Keep vector index derived; registry correctness must not depend on vector availability.
7. Deprecate/redirect the manual split APIs:
   - `SemanticPackage.indexTagVector`;
   - `SemanticPackage.findSimilarTags`;
   - separate vector/embedder ownership.
8. Add tests proving unknown search never mutates the registry and restart requires no application-side indexing loop.

### Gate-2 proof

```text
persistent tag registry
+ fresh InMemoryVectorStore after restart
+ embedding provider
→ configureSearch()
→ semantic query finds the persisted tags
```

Then mutate synonym/description and verify search reflects the change without an explicit application re-index call.

## Final audit

Perform an am-i-allowed-style simplicity pass:

- no raw SQL;
- no duplicate tag registry;
- no Tag-as-graph-node ceremony;
- no fire-and-forget persistence;
- no linear alias scan;
- no read method that mutates;
- no manual vector lifecycle required by consumers;
- no backend-specific semantics;
- no hidden argument-order policy in `replace`;
- short methods with one owner for each invariant.

Only after these gates should ai-cli persistent-memory work depend on the new Semantika behavior.
