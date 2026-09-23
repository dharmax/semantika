# Architectural Decision Records (ADRs)

## ADR-001: Hybrid Tag Taxonomy DAG & Pluggable VectorStore for Semantic Artifacts
- **Status**: `accepted`
- **Date**: 2026-09-23T18:11:41.978Z

### Context
Adding a tagging mechanism to Semantika for entities and predicates, supporting boolean queries (AND/OR/XOR), Tag class with exposition methods, pluggable vector DB, and deciding whether a multi-parent tag taxonomy graph is viable alongside vector search.

### Decision
ADR-001: Hybrid Tag Taxonomy DAG & Pluggable VectorStore for Semantic Artifacts
- **Status**: `accepted`
- **Date**: 2026-09-23T18:11:41.978Z

### Context
Adding a tagging mechanism to Semantika for entities and predicates, supporting boolean queries (AND/OR/XOR), Tag class with exposition methods, pluggable vector DB, and deciding whether a multi-parent tag taxonomy graph is viable alongside vector search.

### Decision
ADR-001: Hybrid Tag Taxonomy DAG & Pluggable VectorStore for Semantic Artifacts
- **Status**: `accepted`
- **Date**: 2026-09-23T18:11:41.978Z

### Context
Adding a tagging mechanism to Semantika for entities and predicates, supporting boolean queries (AND/OR/XOR), Tag class with exposition methods, pluggable vector DB, and deciding whether a multi-parent tag taxonomy graph is viable alongside vector search.

### Decision
ADR-001: Hybrid Tag Taxonomy DAG & Pluggable VectorStore for Semantic Artifacts
- **Status**: `accepted`
- **Date**: 2026-09-23T18:11:41.978Z

### Context
Adding a tagging mechanism to Semantika for entities and predicates, supporting boolean queries (AND/OR/XOR), Tag class with exposition methods, pluggable vector DB, and deciding whether a multi-parent tag taxonomy graph is viable alongside vector search.

### Decision
Adopt a Neuro-Symbolic Hybrid Tagging Architecture: Implement Tag Taxonomy DAG for deterministic subsumption and boolean operations, coupled with a pluggable IVectorStore adapter for continuous semantic similarity. Base tagging functionality on SemanticArtifact so both entities and predicates inherit tagging natively.

### Consequences
1. Tags can be attached directly to SemanticArtifact (Entities and Predicates) with zero code duplication. 2. Boolean queries (AND, OR, XOR, NOT) execute deterministically with taxonomy roll-up. 3. Vector database is abstracted behind IVectorStore for semantic discovery without polluting core graph logic. 4. Existing storage backends (SQLite, Mongo, Postgres) can index `_tags` directly for high performance.

---



### Consequences
1. Tags can be attached directly to SemanticArtifact (Entities and Predicates) with zero code duplication. 2. Boolean queries (AND, OR, XOR, NOT) execute deterministically with taxonomy roll-up. 3. Vector database is abstracted behind IVectorStore for semantic discovery without polluting core graph logic. 4. Existing storage backends (SQLite, Mongo, Postgres) can index `_tags` directly for high performance.

---



### Consequences
1. Tags can be attached directly to SemanticArtifact (Entities and Predicates) with zero code duplication. 2. Boolean queries (AND, OR, XOR, NOT) execute deterministically with taxonomy roll-up. 3. Vector database is abstracted behind IVectorStore for semantic discovery without polluting core graph logic. 4. Existing storage backends (SQLite, Mongo, Postgres) can index `_tags` directly for high performance.

---



### Consequences
1. Tags can be attached directly to SemanticArtifact (Entities and Predicates) with zero code duplication. 2. Boolean queries (AND, OR, XOR, NOT) execute deterministically with taxonomy roll-up. 3. Vector database is abstracted behind IVectorStore for semantic discovery without polluting core graph logic. 4. Existing storage backends (SQLite, Mongo, Postgres) can index `_tags` directly for high performance.

---

