# Architectural Decision Records (ADRs)

## ADR-001: Hybrid Tag Taxonomy DAG & Pluggable VectorStore for Semantic Artifacts
- **Status**: accepted
- **Date**: 2026-09-23

### Context

Semantika needs native tags on entities/predicates, deterministic boolean/taxonomy semantics, and optional continuous semantic similarity without requiring a graph database.

### Decision

Use a multi-parent tag taxonomy DAG on `SemanticArtifact`, with canonical tag strings persisted on artifacts and a pluggable vector-store interface for semantic discovery.

### Consequences

- Entities and predicates share one tagging mechanism.
- Taxonomy subsumption and Boolean tag queries are deterministic.
- Vector search remains optional and pluggable.
- Storage backends can index `_tags` directly.

---

## ADR-002: Tag semantics are durable registry data; vectors are derived
- **Status**: accepted
- **Date**: 2026-09-30

### Context

The first tagging implementation persisted artifact tag names but kept taxonomy, aliases, constraints and vector lifecycle only in process memory. This creates split-brain semantics across restart and forces applications to maintain vector indexes manually.

### Decision

Persist one compact TagRecord per canonical tag through Semantika storage abstractions. Hydrate TagTaxonomy from that registry, maintain an exact alias index and DAG in memory, and route all semantic tag mutations through an awaitable persistence authority.

Canonical tag names are immutable identities. Synonyms/display names are aliases. Vector search is a derived TagTaxonomy index and reads never create tags.

Artifact tagging remains canonical strings. Add `{ replace: true }` to atomically replace existing descendants of the same exclusive ancestor; antonym/abstract/new-vs-new conflicts remain errors.

### Consequences

- Taxonomy/synonym semantics survive restart.
- No application-side taxonomy table or re-index loop is needed.
- Synchronous mutation setters become obsolete because they cannot honestly persist async backends.
- Search becomes non-mutating.
- Tag deletion must not leave assigned canonical tags orphaned.
- Design/implementation gates live in `docs/tags/DESIGN.md` and `docs/tags/PLAN.md`.
