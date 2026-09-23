# 🌐 Semantika (`@dharmax/semantika`)
### *The Friendly, Multi-Model Semantic Graph Layer for Modern Apps & AI Agents*

[![npm version](https://img.shields.io/badge/npm-v0.8.0-blue.svg)](https://www.npmjs.com/package/@dharmax/semantika)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Zero Bloat](https://img.shields.io/badge/Architecture-Zero%20Bloat%20%2F%20KISS-brightgreen.svg)]()
[![Runtime](https://img.shields.io/badge/Runtime-Node.js%20%7C%20Bun-orange.svg)]()
[![Storage](https://img.shields.io/badge/Storage-SQLite%20%7C%20Postgres%20%7C%20MongoDB-green.svg)]()

**Semantika** is a lightweight, zero-bloat semantic graph abstraction layer in TypeScript. It bridges the gap between relational/document databases (SQLite, PostgreSQL JSONB, MongoDB) and knowledge graphs—giving you **typed graph nodes (`AbstractEntity`)**, **first-class semantic edges (`Predicate`)**, **hierarchical ontology inheritance**, **peer-key query optimization**, and **schema validation** without the operational complexity or cost of dedicated graph databases (Neo4j, ArangoDB).


## 📦 Installation & Driver Matrix

Semantika core is **ultra-lightweight** with zero runtime database dependencies. SQLite drivers are built directly into modern Node and Bun runtimes.

```bash
# Core (Includes embedded SQLite with zero external database dependencies)
npm install @dharmax/semantika

# Optional: Add PostgreSQL driver if using PostgresStore
npm install pg

# Optional: Add MongoDB driver if using MongoStore
npm install mongodb

# Optional: Add Joi if using Joi schema templates
npm install joi
```

---

## ⚡ 60-Second Quickstart (Zero-Config SQLite)

Run immediately with zero database installation or Docker configuration:

```ts
import { 
    SemanticPackage, 
    SqliteStore, 
    AbstractEntity, 
    EntityDcr, 
    PredicateDcr 
} from '@dharmax/semantika';
import * as joi from 'joi';

// 1. Define Entity Schemas
class Developer extends AbstractEntity {
    static template = {
        name: joi.string().required(),
        skill: joi.string().default('Fullstack')
    };
    static readonly dcr = new EntityDcr(Developer, Developer.template);
}

class Project extends AbstractEntity {
    static template = {
        title: joi.string().required()
    };
    static readonly dcr = new EntityDcr(Project, Project.template);
}

// 2. Define Predicates (Edges with mirrored target fields)
const maintains = new PredicateDcr('maintains', [], { target: ['title'] }, { role: joi.string() });

// 3. Initialize Package with In-Memory or File-Backed SQLite
const storage = new SqliteStore(':memory:'); // or new SqliteStore('./graph.db')
await storage.connect();

const sp = new SemanticPackage('main', {
    entityDcrs: [Developer.dcr, Project.dcr],
    predicateDcrs: [maintains]
}, storage);

// 4. Create Entities & Edges
const dev = await sp.createEntity<Developer>(Developer.dcr, { name: 'Alice', skill: 'AI & Systems' });
const proj = await sp.createEntity<Project>(Project.dcr, { title: 'AI Workflow' });

// Connect Alice -> maintains -> AI Workflow
const edge = await sp.createPredicate(dev, maintains, proj, { role: 'Lead Architect' });

// 5. Query Graph Connections (with automatic peer population)
const projects = await dev.outgoingPreds(maintains, { projection: ['title'] });
console.log(projects.map(p => ({ project: p.peer['title'], role: p.payload.role })));
// Output: [ { project: 'AI Workflow', role: 'Lead Architect' } ]
```

---

## 🧩 Core Concepts & Highlights

### 1. Zero-Join Mirrored Peer Keys (`pDcr.keys`)
In traditional multi-model systems, querying graph edges filtered by target node properties requires expensive multi-table joins. Semantika allows predicates to declare mirrored keys:
```ts
const worksFor = new PredicateDcr('worksFor', [], { target: ['companyName', 'industry'] });
```
When `sp.createPredicate(person, worksFor, company)` runs, Semantika copies `_target_companyName` and `_target_industry` directly onto the edge document and automatically indexes them. Edge lookups filter instantly without querying the node collections.

### 2. Semantic Predicate Inheritance
Predicates form ontology trees. Searching for an abstract relation automatically returns specialized sub-relations:
```ts
const contributesTo = new PredicateDcr('contributesTo');
const maintains = new PredicateDcr('maintains', []);
const fixesBugs = new PredicateDcr('fixesBugs', []);

// Define hierarchy
contributesTo.children = [maintains, fixesBugs];

// Querying 'contributesTo' automatically matches 'maintains' and 'fixesBugs'
const allContributions = await dev.outgoingPreds(contributesTo);
```

### 3. Native Optimistic Concurrency Control
Entities and collections enforce atomic optimistic locking via built-in `_version` tracking:
```ts
await entity.update({ status: 'in-review' }); // Atomically increments _version and updates _lastUpdate
```

### 4. Multi-Hop Graph Traversal (`sp.traverse`)
Extract entire subgraphs up to $N$-degrees away in a single declarative call:
```ts
const subgraph = await sp.traverse(rootEntityId, {
    maxDepth: 3,
    direction: 'both',
    predicateTypes: ['dependsOn', 'governs', 'implements']
});
// Returns { entities: [...], predicates: [...] }
```

### 5. Flexible Schema Validation (Joi, Zod, or Zero-Dep Functions)
Semantika supports Joi schemas, Zod schemas, or zero-dependency validator functions:
```ts
// Using zero-dependency custom validator
class Task extends AbstractEntity {
    static template = {
        summary: { validate: (v: any) => typeof v === 'string' ? { value: v } : { error: 'Must be string' } },
        priority: 'medium' // Plain default value
    };
    static readonly dcr = new EntityDcr(Task, Task.template);
}
```

---

## 🏷️ Tagging, Boolean Query Engine & Neuro-Symbolic Taxonomy

Semantika features a native, clutter-free tagging subsystem with multi-parent DAG taxonomy and pluggable vector search.

### 1. Tagging Entities and Predicates
Both `AbstractEntity` and `Predicate` inherit native tagging from `SemanticArtifact`:
```ts
// Tag during creation
const doc = await sp.createEntity(Document.dcr, { title: 'Whitepaper' }, false, true, ['ai', 'research']);
const edge = await sp.createPredicate(svc1, dependsOn, svc2, {}, {}, ['rpc', 'critical']);

// Dynamic tag / untag (persists to DB automatically)
await doc.tag('production', 'verified');
await doc.untag('research');

// Check tags
doc.hasTag('ai'); // true
doc.tagList;       // ['ai', 'production', 'verified']
doc.tags;          // Set { 'ai', 'production', 'verified' }
```

### 2. Boolean Tag Query Engine (`AND`, `OR`, `XOR`, `NOT`)
Filter artifacts using expressive, composable boolean expressions:
```ts
// Evaluate on loaded artifacts
doc.matchesTagQuery({
    and: [
        'ai',
        { or: ['production', 'staging'] },
        { not: 'deprecated' },
        { xor: ['public', 'private'] } // Strict 1-of-N mutual exclusion
    ]
});

// Query incoming / outgoing predicates filtered by tag query
const criticalEdges = await svc.outgoingPreds(dependsOn, {
    tagQuery: { and: ['critical', { not: 'deprecated' }] }
});
```

### 3. Neuro-Symbolic Multi-Parent DAG Taxonomy
Taxonomies are directed acyclic graphs (DAGs) supporting multiple parents (e.g. `sqlite` is both `sql` and `embedded`):
```ts
// Declarative loading
sp.tags.loadTaxonomy({
    tech: {
        backend: {
            database: {
                sql: { sqlite: {}, postgres: {} },
                nosql: { mongo: {} }
            }
        },
        storage: {}
    }
});

// Connect additional parent (Multi-parent DAG)
sp.tags.tag('database').addParent(sp.tags.tag('storage'));

const sqlite = sp.tags.tag('sqlite');
sqlite.ancestors; // Set: sql, database, backend, storage, tech
sqlite.isDescendantOf('storage'); // true!
sqlite.isDescendantOf('nosql');   // false

// Default Subsumption: If artifact has X, and X is a child of Y, hasTag(Y) is true
doc.hasTag('database'); // true!
doc.hasTag('database', { exact: true }); // false (exact check)
```

### 4. Abstract Tags, Exclusive Tags & Antonyms
Enforce structural integrity and mutual exclusivity on tags:
```ts
// Abstract tag: only descendants may be placed on artifacts
const status = sp.tags.tag('Status', { abstract: true, exclusive: true });
const draft = sp.tags.tag('Draft').addParent(status);
const published = sp.tags.tag('Published').addParent(status);

await doc.tag('Status');    // ❌ Error: Cannot tag with abstract tag 'Status'
await doc.tag('Draft');     // ✅ Works

// Exclusive tag: at most ONE descendant can be placed on an artifact
await doc.tag('Published'); // ❌ Error: Exclusive tag violation: conflicts with 'Draft'

// Antonyms: bidirectional opposition
const active = sp.tags.tag('Active');
const inactive = sp.tags.tag('Inactive');
active.addAntonym(inactive);

await doc.tag('Active');
await doc.tag('Inactive');  // ❌ Error: Antonym conflict with 'Active'
```

### 5. Multi-Language Synonyms & Localized Display Names
```ts
const ai = sp.tags.tag('art-intel', {
    displayName: 'Artificial Intelligence', // Default English display name
    synonyms: {
        en: ['machine intelligence', 'cognitive computing'],
        fr: ['intelligence artificielle'],
        he: ['בינה מלאכותית']
    }
});

ai.displayName; // 'Artificial Intelligence'
await doc.tag('art-intel');

// Querying by any synonym matches seamlessly
doc.hasTag('machine intelligence'); // true
doc.hasTag('intelligence artificielle'); // true
```

### 6. Tag Exposition Functions
Navigate from a tag directly to tagged entities, predicates, and artifacts:
```ts
const dbTag = sp.tags.tag('database');

// Find all entities tagged with 'database' (optionally including descendants like sqlite, postgres)
const entities = await dbTag.entities({ includeDescendants: true });

// Count total artifacts
const count = await dbTag.count({ includeDescendants: true });
```

### 7. Pluggable Vector DB Adapter & Semantic Search
Connect any vector database (Qdrant, Chroma, Pinecone, pgvector) using the Service Adapter Pattern, or use the built-in `InMemoryVectorStore`:
```ts
import { InMemoryVectorStore } from '@dharmax/semantika';

// Attach vector store
const vectorStore = new InMemoryVectorStore();
sp.setVectorStore(vectorStore);

// Index tag embeddings
const tMl = sp.tags.tag('machine-learning', { embedding: [0.9, 0.8, 0.1] });
const tNlp = sp.tags.tag('nlp', { embedding: [0.85, 0.85, 0.15] });
await sp.indexTagVector(tMl);
await sp.indexTagVector(tNlp);

// Find semantically similar tags
const similar = await tMl.similar();
// Output: [ { tag: Tag('nlp'), score: 0.99 } ]
```

---

## 🤖 AI & Agentic Integration (LLM Context & Studio Tooling)

### 1. Machine-Readable Ontology Introspection
AI agents and visual editors can inspect the active ontology schema dynamically:
```ts
// Export complete ontology schema
const schema = sp.ontology.exportSchema();
console.log(JSON.stringify(schema, null, 2));
```

Inject `sp.ontology.toJSON()` directly into system prompts so LLMs generate 100% schema-conformant entity types and predicate relations without hallucination.

### 2. Graph-RAG Subgraph Context Injection
```ts
// Extract localized knowledge graph around an entity
const subgraph = await sp.traverse('main_Ticket_xyz', { maxDepth: 2 });

const promptContext = `
Context Graph:
Entities: ${subgraph.entities.map(e => `${e.typeName()} (${e.id}): ${JSON.stringify(e)}`).join('\n')}
Relations: ${subgraph.predicates.map(p => `${p.sourceId} --[${p.predicateName}]--> ${p.targetId}`).join('\n')}
`;
```

---

## 💾 Storage Backends & Subpath Imports

Import specific stores cleanly via subpaths:

```ts
// Dedicated subpath imports
import { SqliteStore } from '@dharmax/semantika/sqlite';
import { PostgresStore } from '@dharmax/semantika/postgres';
import { MongoStore } from '@dharmax/semantika/mongo';
```

| Backend | Driver | Configuration Example | Ideal For |
| :--- | :--- | :--- | :--- |
| **`SqliteStore`** | `bun:sqlite` / `node:sqlite` / `better-sqlite3` | `new SqliteStore('./data.db')` or `new SqliteStore(':memory:')` | Embedded apps, CLI tools (`aiwf`), tests, desktop apps |
| **`PostgresStore`** | `pg` (JSONB with GIN indexing) | `new PostgresStore({ connectionString: 'postgres://...' })` | Enterprise relational setups, cloud backends |
| **`MongoStore`** | `mongodb` (Native BSON) | `new MongoStore('mongodb://localhost/db')` | Distributed microservices, high-throughput document graphs |

---

## 📜 API Cheat Sheet

### Entity DSL (`AbstractEntity`)
- `entity.outgoingPreds(pDcr, opts)` / `entity.incomingPreds(pDcr, opts)`
- `entity.outgoingPredsPaging(pDcr, opts, pagination)` / `entity.incomingPredsPaging(...)`
- `entity.p.o(...)` / `entity.p.i(...)` (Shorthand graph navigation)
- `entity.getFieldRecursive(fieldName, accumulate)` (Deep hierarchical property inheritance)
- `entity.drill(inDepth, outDepth)` (Recursive connection graph population)
### Tag & Artifact Tagging DSL (`SemanticArtifact` & `Tag`)
- `artifact.tag(...tags)` / `artifact.untag(...tags)` (Attach / detach tags with DB persistence)
- `artifact.hasTag(tag, { exact? })` (Default taxonomy subsumption; exact match via `{ exact: true }`)
- `artifact.matchesTagQuery(query, { exact? })` (Boolean evaluation: `and`, `or`, `xor`, `not`)
- `artifact.tags` (`Set<string>`) / `artifact.tagList` (`string[]`)
- `tag.abstract` / `tag.exclusive` (Structural constraints and mutual exclusion)
- `tag.displayName` / `tag.getDisplayName(lang)` / `tag.setDisplayName(name, lang)` (Multi-language display names, defaults to English)
- `tag.addSynonym(synonym, lang?)` / `tag.getSynonyms(lang?)` / `tag.hasSynonym(synonym)` (Multi-language synonyms)
- `tag.antonyms` / `tag.addAntonym(antonym)` / `tag.isAntonymOf(tag)` (Bidirectional antonym opposition)
- `tag.parents` / `tag.children` / `tag.ancestors` / `tag.descendants`
- `tag.addParent(parent)` / `tag.removeParent(parent)` (DAG management with cycle detection)
- `tag.isDescendantOf(tag)` / `tag.isAncestorOf(tag)`
- `tag.entities(opts)` / `tag.predicates(opts)` / `tag.artifacts(opts)` / `tag.count(opts)`
- `tag.similar(opts)` (Vector search)
- `sp.tags.loadTaxonomy(tree)` / `sp.tags.tag(name, opts)` / `sp.tags.delete(name)`
- `sp.setVectorStore(store)` / `sp.indexTagVector(tag)` / `sp.findSimilarTags(tag)`

### Package DSL (`SemanticPackage`)
- `sp.createEntity(eDcr, fields, superSetAllowed?, cutExtraFields?, tags?)`
- `sp.createPredicate(source, pDcr, target, payload?, selfKeys?, tags?)`
- `sp.loadEntity(id, eDcr?, ...projection)`
- `sp.loadEntityById(id, ...projection)`
- `sp.findEntitiesByTag(tag, opts)` / `sp.findPredicatesByTag(tag, opts)`
- `sp.predicatesBetween(source, target, bidirectional?, predicateName?)`
- `sp.traverse(startId, { maxDepth, predicateTypes, direction, limit })`

---

## ⚖️ License
MIT © Dharmax
