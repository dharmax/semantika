import * as joi from 'joi';
import {
    AbstractEntity,
    EntityDcr,
    PredicateDcr,
    SemanticPackage,
    SqliteStore,
    Tag,
    TagTaxonomy,
    InMemoryVectorStore,
    evaluateTagQuery
} from '../src/index.js';
import {EntityTemplate} from "../src/utils/template-processor.js";
import {describe, it, beforeAll, afterAll, expect} from 'bun:test';

class Document extends AbstractEntity {
    static template: EntityTemplate = {
        title: joi.string().required(),
        author: joi.string().optional()
    };
    static readonly dcr = new EntityDcr(Document, Document.template);
}

class Service extends AbstractEntity {
    static template: EntityTemplate = {
        name: joi.string().required()
    };
    static readonly dcr = new EntityDcr(Service, Service.template);
}

const dependsOn = new PredicateDcr('dependsOn', []);
const references = new PredicateDcr('references', []);

describe("Tagging Mechanism, Boolean Query Engine & Neuro-Symbolic Taxonomy", () => {
    let sp: SemanticPackage;
    let storage: SqliteStore;

    beforeAll(async () => {
        storage = new SqliteStore(':memory:');
        await storage.connect();

        sp = new SemanticPackage('main', {
            entityDcrs: [Document.dcr, Service.dcr],
            predicateDcrs: [dependsOn, references]
        }, storage);
    });

    afterAll(async () => {
        await storage.close();
    });

    it("should tag and untag entities with persistence across reloads", async () => {
        const doc = await sp.createEntity<Document>(Document.dcr, { title: 'Whitepaper' }, false, true, ['ai', 'research']);

        expect(doc.hasTag('ai')).toBe(true);
        expect(doc.hasTag('research')).toBe(true);
        expect(doc.hasTag('production')).toBe(false);
        expect(doc.tagList).toEqual(['ai', 'research']);

        // Tag an additional label
        await doc.tag('urgent', 'draft');
        expect(doc.hasTag('urgent')).toBe(true);
        expect(doc.hasTag('draft')).toBe(true);

        // Untag a label
        await doc.untag('research');
        expect(doc.hasTag('research')).toBe(false);
        expect(doc.hasTag('ai')).toBe(true);

        // Reload from database to verify persistence
        const reloaded = await sp.loadEntity<Document>(doc.id, Document.dcr);
        expect(reloaded.hasTag('ai')).toBe(true);
        expect(reloaded.hasTag('urgent')).toBe(true);
        expect(reloaded.hasTag('draft')).toBe(true);
        expect(reloaded.hasTag('research')).toBe(false);
    });

    it("should tag and untag predicates with persistence", async () => {
        const svc1 = await sp.createEntity<Service>(Service.dcr, { name: 'AuthService' });
        const svc2 = await sp.createEntity<Service>(Service.dcr, { name: 'DbService' });

        const pred = await sp.createPredicate(svc1, dependsOn, svc2, {}, {}, ['rpc', 'critical']);
        expect(pred.hasTag('rpc')).toBe(true);
        expect(pred.hasTag('critical')).toBe(true);
        expect(pred.hasTag('rest')).toBe(false);

        await pred.tag('internal');
        expect(pred.hasTag('internal')).toBe(true);

        await pred.untag('rpc');
        expect(pred.hasTag('rpc')).toBe(false);
        expect(pred.hasTag('internal')).toBe(true);

        // Query predicate and verify tags
        const preds = await sp.findPredicates(false, dependsOn, svc1.id);
        expect(preds.length).toBe(1);
        expect(preds[0].hasTag('critical')).toBe(true);
        expect(preds[0].hasTag('internal')).toBe(true);
        expect(preds[0].hasTag('rpc')).toBe(false);
    });

    it("should evaluate boolean tag queries (Existence, Absence, AND, OR, XOR)", () => {
        const tags = new Set(['typescript', 'backend', 'postgres', 'active']);

        // Existence
        expect(evaluateTagQuery(tags, 'typescript')).toBe(true);
        expect(evaluateTagQuery(tags, { has: 'typescript' })).toBe(true);
        expect(evaluateTagQuery(tags, 'python')).toBe(false);

        // Absence (NOT)
        expect(evaluateTagQuery(tags, { not: 'deprecated' })).toBe(true);
        expect(evaluateTagQuery(tags, { not: 'typescript' })).toBe(false);

        // Conjunction (AND)
        expect(evaluateTagQuery(tags, { and: ['typescript', 'backend'] })).toBe(true);
        expect(evaluateTagQuery(tags, { and: ['typescript', 'frontend'] })).toBe(false);

        // Disjunction (OR)
        expect(evaluateTagQuery(tags, { or: ['frontend', 'backend'] })).toBe(true);
        expect(evaluateTagQuery(tags, { or: ['ruby', 'python'] })).toBe(false);

        // Strict Mutual Exclusion (XOR)
        // Case 1: Exactly one is present -> true
        expect(evaluateTagQuery(tags, { xor: ['backend', 'frontend'] })).toBe(true);
        // Case 2: Both are present -> false
        expect(evaluateTagQuery(tags, { xor: ['backend', 'postgres'] })).toBe(false);
        // Case 3: Neither is present -> false
        expect(evaluateTagQuery(tags, { xor: ['ruby', 'python'] })).toBe(false);
        // Case 4: Multi-item XOR (strictly 1 of N)
        expect(evaluateTagQuery(tags, { xor: ['active', 'archived', 'deleted'] })).toBe(true);

        // Nested composite boolean expression
        expect(
            evaluateTagQuery(tags, {
                and: [
                    'typescript',
                    { or: ['postgres', 'mysql'] },
                    { not: 'deprecated' },
                    { xor: ['backend', 'frontend'] }
                ]
            })
        ).toBe(true);
    });

    it("should construct a Multi-Parent Directed Acyclic Graph (DAG) Taxonomy", () => {
        // Taxonomy hierarchy:
        //        tech
        //       /    \
        //    backend  storage
        //       \     /
        //       database
        //       /      \
        //     sql     nosql
        //     /
        //   sqlite
        const tech = sp.tags.tag('tech');
        const backend = sp.tags.tag('backend').addParent(tech);
        const storage = sp.tags.tag('storage').addParent(tech);

        // Multi-parent: database is both backend AND storage!
        const database = sp.tags.tag('database').addParent(backend).addParent(storage);
        const sql = sp.tags.tag('sql').addParent(database);
        const nosql = sp.tags.tag('nosql').addParent(database);
        const sqlite = sp.tags.tag('sqlite').addParent(sql);

        // Direct parents & children
        expect(database.parents.has(backend)).toBe(true);
        expect(database.parents.has(storage)).toBe(true);
        expect(backend.children.has(database)).toBe(true);

        // Ancestors
        const sqliteAncestors = sqlite.ancestors;
        expect(sqliteAncestors.has(sql)).toBe(true);
        expect(sqliteAncestors.has(database)).toBe(true);
        expect(sqliteAncestors.has(backend)).toBe(true);
        expect(sqliteAncestors.has(storage)).toBe(true);
        expect(sqliteAncestors.has(tech)).toBe(true);
        expect(sqliteAncestors.has(nosql)).toBe(false);

        // Descendants
        const techDescendants = tech.descendants;
        expect(techDescendants.has(backend)).toBe(true);
        expect(techDescendants.has(storage)).toBe(true);
        expect(techDescendants.has(database)).toBe(true);
        expect(techDescendants.has(sql)).toBe(true);
        expect(techDescendants.has(nosql)).toBe(true);
        expect(techDescendants.has(sqlite)).toBe(true);

        // Lineage methods
        expect(sqlite.isDescendantOf('database')).toBe(true);
        expect(sqlite.isDescendantOf('backend')).toBe(true);
        expect(sqlite.isDescendantOf('nosql')).toBe(false);
        expect(tech.isAncestorOf('sqlite')).toBe(true);
    });

    it("should support default taxonomy subsumption on hasTag", async () => {
        const doc = await sp.createEntity<Document>(Document.dcr, { title: 'SQLite Architecture' }, false, true, ['sqlite']);

        // Default behavior: if artifact is tagged with X, and X is a child/descendant of Y, hasTag(Y) is true
        expect(doc.hasTag('sqlite')).toBe(true);
        expect(doc.hasTag('database')).toBe(true);
        expect(doc.hasTag('backend')).toBe(true);
        expect(doc.hasTag('tech')).toBe(true);
        expect(doc.hasTag('nosql')).toBe(false);

        // Exact match flag explicitly disables subsumption
        expect(doc.hasTag('database', { exact: true })).toBe(false);
        expect(doc.hasTag('sqlite', { exact: true })).toBe(true);

        // Boolean query with default taxonomy subsumption
        expect(doc.matchesTagQuery({ and: ['database', { not: 'nosql' }] })).toBe(true);
    });

    it("should support Tag exposition functions (entities, predicates, artifacts, count)", async () => {
        const secTag = sp.tags.tag('security');
        const auditTag = sp.tags.tag('audit').addParent(secTag);

        const svc = await sp.createEntity<Service>(Service.dcr, { name: 'KmsService' }, false, true, ['audit']);
        const doc = await sp.createEntity<Document>(Document.dcr, { title: 'Compliance Report' }, false, true, ['audit']);

        // Query entities directly from the tag with descendant expansion
        const entitiesDirect = await auditTag.entities();
        expect(entitiesDirect.length).toBe(2);

        // From parent tag with includeDescendants
        const parentEntities = await secTag.entities({ includeDescendants: true });
        expect(parentEntities.length).toBe(2);

        const artifacts = await auditTag.artifacts();
        expect(artifacts.length).toBe(2);

        const count = await secTag.count({ includeDescendants: true });
        expect(count).toBe(2);
    });

    it("should support pluggable VectorDB with InMemoryVectorStore and semantic search", async () => {
        const vStore = new InMemoryVectorStore();
        sp.setVectorStore(vStore);

        // Synthetic 3-dimensional embeddings for testing
        // ml & nlp are close in space; security is orthogonal
        const tMl = sp.tags.tag('machine-learning', { embedding: [0.9, 0.8, 0.1] });
        const tNlp = sp.tags.tag('natural-language-processing', { embedding: [0.85, 0.85, 0.15] });
        const tSec = sp.tags.tag('cyber-security', { embedding: [0.1, 0.1, 0.95] });

        await sp.indexTagVector(tMl);
        await sp.indexTagVector(tNlp);
        await sp.indexTagVector(tSec);

        // Find tags similar to machine-learning
        const similarToMl = await tMl.similar();
        expect(similarToMl.length).toBeGreaterThan(0);
        // NLP should have the highest similarity to ML
        expect(similarToMl[0].tag.name).toBe('natural-language-processing');
        expect(similarToMl[0].score).toBeGreaterThan(0.9);

        // Security should have low similarity
        const secScore = similarToMl.find(h => h.tag.name === 'cyber-security')?.score ?? 0;
        expect(secScore).toBeLessThan(0.4);

        // Direct query through semantic package
        const hits = await sp.findSimilarTags('cyber-security', { limit: 1 });
        expect(hits.length).toBe(1);
    });

    it("should filter predicates using tagQuery in findPredicates", async () => {
        const s1 = await sp.createEntity<Service>(Service.dcr, { name: 'Gateway' });
        const s2 = await sp.createEntity<Service>(Service.dcr, { name: 'Payment' });
        const s3 = await sp.createEntity<Service>(Service.dcr, { name: 'Logger' });

        await sp.createPredicate(s1, dependsOn, s2, {}, {}, ['http', 'critical']);
        await sp.createPredicate(s1, dependsOn, s3, {}, {}, ['udp', 'low-priority']);

        // Find only critical outgoing dependencies
        const criticalPreds = await sp.findPredicates(false, dependsOn, s1.id, {
            tagQuery: 'critical'
        });
        expect(criticalPreds.length).toBe(1);
        expect(criticalPreds[0].hasTag('critical')).toBe(true);

        // Find non-critical outgoing dependencies
        const nonCritical = await sp.findPredicates(false, dependsOn, s1.id, {
            tagQuery: { not: 'critical' }
        });
        expect(nonCritical.length).toBe(1);
        expect(nonCritical[0].hasTag('low-priority')).toBe(true);
    });

    it("should prevent cycles in the Tag Taxonomy DAG", () => {
        const root = sp.tags.tag('dag-root');
        const child = sp.tags.tag('dag-child').addParent(root);
        const grandChild = sp.tags.tag('dag-grandchild').addParent(child);

        // Self-parenting must throw
        expect(() => root.addParent(root)).toThrow('Cannot add tag');

        // Cycle creation (adding descendant as parent) must throw
        expect(() => root.addParent(grandChild)).toThrow('Cycle detected');
        expect(() => root.addParent(child)).toThrow('Cycle detected');
    });

    it("should safely delete tags from TagTaxonomy and sever DAG relationships", () => {
        const p = sp.tags.tag('del-parent');
        const m = sp.tags.tag('del-middle').addParent(p);
        const c = sp.tags.tag('del-child').addParent(m);

        expect(m.parents.has(p)).toBe(true);
        expect(p.children.has(m)).toBe(true);
        expect(c.ancestors.has(p)).toBe(true);

        // Delete middle tag
        const deleted = sp.tags.delete('del-middle');
        expect(deleted).toBe(true);
        expect(sp.tags.has('del-middle')).toBe(false);

        // Severed links
        expect(p.children.has(m)).toBe(false);
        expect(c.parents.has(m)).toBe(false);
        expect(c.ancestors.has(p)).toBe(false);
    });

    it("should validate vector dimensions in InMemoryVectorStore", async () => {
        const store = new InMemoryVectorStore();
        await store.upsert('vec-1', [1.0, 0.0, 0.5]);

        // Mismatched dimension on upsert should throw
        await expect(store.upsert('vec-2', [1.0, 0.0])).rejects.toThrow('Vector dimension mismatch');

        // Mismatched dimension on query should throw
        await expect(store.query([1.0, 0.0])).rejects.toThrow('dimension mismatch');
    });

    it("should prevent placing abstract tags directly on artifacts", async () => {
        const abstractParent = sp.tags.tag('LifecycleState', { abstract: true });
        const concreteChild = sp.tags.tag('Initialized').addParent(abstractParent);

        const doc = await sp.createEntity<Document>(Document.dcr, { title: 'Test Lifecycle' });

        // Tagging with concrete child succeeds
        await doc.tag('Initialized');
        expect(doc.hasTag('Initialized')).toBe(true);
        // By subsumption, it has the abstract parent
        expect(doc.hasTag('LifecycleState')).toBe(true);

        // Attempting to tag directly with the abstract parent must throw
        await expect(doc.tag('LifecycleState')).rejects.toThrow("Cannot tag artifact with abstract tag 'LifecycleState'");

        // Also prevented during entity creation
        await expect(
            sp.createEntity<Document>(Document.dcr, { title: 'Invalid' }, false, true, ['LifecycleState'])
        ).rejects.toThrow("Cannot tag artifact with abstract tag 'LifecycleState'");
    });

    it("should enforce exclusive tag constraints (at most one descendant on an artifact)", async () => {
        const exclusiveCategory = sp.tags.tag('AccessLevel', { exclusive: true, abstract: true });
        const levelPublic = sp.tags.tag('LevelPublic').addParent(exclusiveCategory);
        const levelPrivate = sp.tags.tag('LevelPrivate').addParent(exclusiveCategory);
        const levelConfidential = sp.tags.tag('LevelConfidential').addParent(exclusiveCategory);

        const doc = await sp.createEntity<Document>(Document.dcr, { title: 'Confidential Doc' });

        // Tagging with one descendant works
        await doc.tag('LevelPublic');
        expect(doc.hasTag('LevelPublic')).toBe(true);

        // Tagging with a second descendant of the same exclusive tag must throw
        await expect(doc.tag('LevelPrivate')).rejects.toThrow("Exclusive tag violation");

        // Batch tagging with multiple descendants of an exclusive tag must throw
        const doc2 = await sp.createEntity<Document>(Document.dcr, { title: 'Confidential Doc 2' });
        await expect(doc2.tag('LevelPublic', 'LevelConfidential')).rejects.toThrow("Exclusive tag violation");

        // Untagging the first allows tagging the second
        await doc.untag('LevelPublic');
        await doc.tag('LevelPrivate');
        expect(doc.hasTag('LevelPrivate')).toBe(true);
        expect(doc.hasTag('LevelPublic')).toBe(false);
    });

    it("should support multi-language synonyms with default English display name", async () => {
        const aiTag = sp.tags.tag('art-intel', {
            displayName: 'Artificial Intelligence',
            synonyms: {
                en: ['machine intelligence', 'cognitive computing'],
                fr: ['intelligence artificielle'],
                he: ['בינה מלאכותית']
            }
        });

        // Default display name is English
        expect(aiTag.displayName).toBe('Artificial Intelligence');
        expect(aiTag.getDisplayName('en')).toBe('Artificial Intelligence');

        // Multi-language synonyms access
        expect(aiTag.getSynonyms('en')).toContain('machine intelligence');
        expect(aiTag.getSynonyms('fr')).toContain('intelligence artificielle');
        expect(aiTag.getSynonyms('he')).toContain('בינה מלאכותית');
        expect(aiTag.hasSynonym('machine intelligence')).toBe(true);
        expect(aiTag.hasSynonym('intelligence artificielle')).toBe(true);
        expect(aiTag.hasSynonym('בינה מלאכותית')).toBe(true);

        // Tag an artifact and query using synonyms
        const doc = await sp.createEntity<Document>(Document.dcr, { title: 'AI Paper' });
        await doc.tag('art-intel');

        // hasTag resolves through synonyms seamlessly
        expect(doc.hasTag('art-intel')).toBe(true);
        expect(doc.hasTag('machine intelligence')).toBe(true);
        expect(doc.hasTag('intelligence artificielle')).toBe(true);
        expect(doc.hasTag('בינה מלאכותית')).toBe(true);
        expect(doc.hasTag('Artificial Intelligence')).toBe(true);
    });

    it("should support bidirectional antonyms and prevent antonym conflicts", async () => {
        const active = sp.tags.tag('tag-active');
        const inactive = sp.tags.tag('tag-inactive');

        // Add antonym bidirectionally
        active.addAntonym(inactive);
        expect(active.antonyms.has(inactive)).toBe(true);
        expect(inactive.antonyms.has(active)).toBe(true);
        expect(active.isAntonymOf('tag-inactive')).toBe(true);
        expect(inactive.isAntonymOf('tag-active')).toBe(true);

        const doc = await sp.createEntity<Document>(Document.dcr, { title: 'Active Doc' });
        await doc.tag('tag-active');

        // Attempting to tag with antonym must throw
        await expect(doc.tag('tag-inactive')).rejects.toThrow("Antonym conflict");

        // Attempting to tag both simultaneously must throw
        const doc2 = await sp.createEntity<Document>(Document.dcr, { title: 'Conflict Doc' });
        await expect(doc2.tag('tag-active', 'tag-inactive')).rejects.toThrow("Antonym conflict");
    });

    it("should provide seamless ergonomics for both singular and set definitions (parent, antonym, synonym)", async () => {
        // Singular options
        const backend = sp.tags.tag('backend-singular');
        const db = sp.tags.tag('db-singular', {
            parent: 'backend-singular',
            antonym: 'frontend-singular',
            synonym: 'datastore'
        });

        expect(db.parent).toBe(backend);
        expect(db.parents.has(backend)).toBe(true);
        expect(db.antonym?.name).toBe('frontend-singular');
        expect(db.antonyms.size).toBe(1);
        expect(db.synonym).toBe('datastore');
        expect(db.hasSynonym('datastore')).toBe(true);

        // Dynamic property setter
        const cloud = sp.tags.tag('cloud-singular');
        db.parent = cloud;
        expect(db.parent).toBe(cloud);
        expect(db.parents.has(cloud)).toBe(true);
        expect(db.parents.has(backend)).toBe(false);

        // Multiple parents (set) coexist cleanly with singular getter
        db.addParent(backend);
        expect(db.parents.size).toBe(2);
        expect(db.parents.has(cloud)).toBe(true);
        expect(db.parents.has(backend)).toBe(true);
        expect(db.parent).toBeDefined();

        // Antonym setter
        const client = sp.tags.tag('client-singular');
        db.antonym = client;
        expect(db.antonym).toBe(client);
        expect(db.isAntonymOf(client)).toBe(true);
        expect(db.isAntonymOf('frontend-singular')).toBe(false);

        // Synonym setter
        db.synonym = 'storage-engine';
        expect(db.synonym).toBe('storage-engine');
        expect(db.hasSynonym('storage-engine')).toBe(true);
    });

    it("should accept Tag objects directly in TagQueryExpression", async () => {
        const tDb = sp.tags.tag('tag-db');
        const tSql = sp.tags.tag('tag-sql', { parent: tDb });
        const tLegacy = sp.tags.tag('tag-legacy');

        const doc = await sp.createEntity<Document>(Document.dcr, { title: 'Modern SQL' });
        await doc.tag(tSql);

        // Direct Tag in TagQueryExpression with subsumption
        expect(doc.matchesTagQuery(tDb)).toBe(true);
        expect(doc.matchesTagQuery({ has: tDb })).toBe(true);
        expect(doc.matchesTagQuery({
            and: [
                tDb,
                { not: tLegacy }
            ]
        })).toBe(true);

        expect(doc.matchesTagQuery({
            xor: [tDb, tLegacy]
        })).toBe(true);
    });

    it("should normalize synonyms to canonical tag names on artifact and support synonym lookup", async () => {
        const mlTag = sp.tags.tag('machine-learning', {
            displayName: 'Machine Learning',
            synonym: 'deep-learning'
        });

        const doc = await sp.createEntity<Document>(Document.dcr, { title: 'DL Research' });
        // Tag using synonym
        await doc.tag('deep-learning');

        // Stored under canonical name
        expect(doc.tags.has('machine-learning')).toBe(true);
        expect(doc.hasTag('deep-learning')).toBe(true);
        expect(doc.hasTag('machine-learning')).toBe(true);

        // findEntitiesByTag works when querying by synonym
        const found = await sp.findEntitiesByTag<Document>('deep-learning');
        expect(found.some(d => d.id === doc.id)).toBe(true);

        // Untag via synonym works
        await doc.untag('deep-learning');
        expect(doc.hasTag('machine-learning')).toBe(false);
    });

    it("should export full tag taxonomy in ontology.exportSchema() and serialize cleanly to JSON", () => {
        const schema = sp.ontology.exportSchema();
        expect(schema.tags).toBeDefined();
        expect(typeof schema.tags).toBe('object');

        // Test taxonomy serialization
        const json = sp.tags.toJSON();
        expect(json).toBeDefined();
        expect(json['machine-learning']).toBeDefined();
        expect(json['machine-learning'].displayName).toBe('Machine Learning');
    });
});




