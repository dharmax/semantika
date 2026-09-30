---
kanban-plugin: board
---

# Kanban Board

## Backlog

- [ ] **TKT-007**: TagTaxonomy semantic search + automatic vector lifecycle
  - Summary: Implement Gate 2 of docs/tags/PLAN.md. Search arbitrary text without creating tags; make vector indexing a derived TagTaxonomy lifecycle concern.

## Todo

- [ ] **TKT-006**: Durable semantic tag registry
  - Summary: Implement Gate 1 of docs/tags/PLAN.md: persistent TagRecords, hydration/ready boundary, exact alias index, honest awaitable mutation, safe deletion, and doc.tag(..., { replace: true }) for exclusive groups.
- [ ] **TKT-001**: Explore codebase and run diagnostics
  - Summary: Review initial AST+ graph index and verify project health with `aiwf doctor`.

## In Progress

- No items

## Done

- [x] **TKT-002**: Tag class, Taxonomy DAG, and SemanticArtifact tagging
  - Summary: Implement Tag class representing tags, exposition methods (getEntities, getPredicates, getAncestors, getDescendants), multi-parent directed acyclic graph (DAG) taxonomy, and tag/untag/hasTag methods on SemanticArtifact (Entities and Predicates).
- [x] **TKT-003**: Boolean Tag Query Engine (Existence, Absence, AND/OR/XOR)
  - Summary: Implement Boolean Tag Query Engine supporting existence, absence, AND, OR, XOR, nested expressions, and integration with SemanticPackage/collection queries.
- [x] **TKT-004**: Pluggable VectorStore interface and adapter
  - Summary: Define IVectorStore interface (Service Adapter Pattern) for pluggable vector databases, implement InMemoryVectorStore default, and integrate with Tag search/embeddings.
- [x] **TKT-005**: Tag options: abstract, exclusive, default subsumption, synonyms & antonyms
  - Summary: Implement tag options: abstract (cannot be directly placed on artifacts, only descendants), exclusive (at most one descendant can be placed on an artifact), default taxonomy subsumption on hasTag, multi-language synonyms with default English display name, and antonyms.

## Blocked

- No items

%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%
