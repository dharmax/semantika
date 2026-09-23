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

    it("should support taxonomy-expanded queries (subsumption)", async () => {
        const doc = await sp.createEntity<Document>(Document.dcr, { title: 'SQLite Architecture' }, false, true, ['sqlite']);

        // Without expansion: only exact tag matches
        expect(doc.hasTag('sqlite')).toBe(true);
        expect(doc.hasTag('database')).toBe(false);
        expect(doc.hasTag('tech')).toBe(false);

        // With taxonomy expansion: matches through subsumption
        expect(doc.hasTag('database', { expandTaxonomy: true })).toBe(true);
        expect(doc.hasTag('tech', { expandTaxonomy: true })).toBe(true);
        expect(doc.hasTag('nosql', { expandTaxonomy: true })).toBe(false);

        // Boolean query with taxonomy expansion
        expect(doc.matchesTagQuery({ and: ['database', { not: 'nosql' }] }, { expandTaxonomy: true })).toBe(true);
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
});

