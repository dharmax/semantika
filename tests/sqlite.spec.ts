import * as joi from 'joi';
import {
    AbstractEntity,
    DuplicateKeyError,
    EntityDcr,
    PredicateDcr,
    SemanticPackage,
    SqliteStore
} from '../src/index.js';
import {EntityTemplate} from "../src/utils/template-processor.js";
import {describe, it, beforeAll, afterAll, expect} from 'bun:test';

class Person extends AbstractEntity {
    static template: EntityTemplate = {
        name: joi.string().required(),
        role: joi.string().optional()
    };
    static readonly dcr = new EntityDcr(Person, Person.template);
}

class Project extends AbstractEntity {
    static template: EntityTemplate = {
        title: joi.string().required(),
        status: joi.string().default('active')
    };
    static readonly dcr = new EntityDcr(Project, Project.template);
}

class Task extends AbstractEntity {
    static template: EntityTemplate = {
        summary: joi.string().required()
    };
    static readonly dcr = new EntityDcr(Task, Task.template);
}

// Parent predicate
const contributesTo = new PredicateDcr('contributesTo', []);
// Child predicate inheriting from contributesTo
const worksOn = new PredicateDcr('worksOn', [], { target: ['title'] }, { hours: joi.number() });
// Another predicate
const tracks = new PredicateDcr('tracks', []);

describe("Testing Semantika SQLite Store & Advanced Graph Features", function () {
    let sp: SemanticPackage;
    let storage: SqliteStore;

    beforeAll(async () => {
        storage = new SqliteStore(':memory:');
        await storage.connect();

        // Connect child predicate to parent
        contributesTo.children.push(worksOn);
        worksOn._parents.push(contributesTo);

        sp = new SemanticPackage('main', {
            entityDcrs: [Person.dcr, Project.dcr, Task.dcr],
            predicateDcrs: [contributesTo, worksOn, tracks]
        }, storage);
    });

    afterAll(async () => {
        await storage.close();
    });

    it("should create entities with template validation and default values", async () => {
        const alice = await sp.createEntity<Person>(Person.dcr, { name: 'Alice', role: 'Architect' });
        const proj = await sp.createEntity<Project>(Project.dcr, { title: 'AIWF' });

        expect(alice.id).toContain('main_Person_');
        expect(alice['name']).toBe('Alice');
        expect(alice['role']).toBe('Architect');
        expect(alice.version).toBe(1);

        expect(proj.id).toContain('main_Project_');
        expect(proj['title']).toBe('AIWF');
        expect(proj['status']).toBe('active');
    });

    it("should support optimistic concurrency locking on entity updates", async () => {
        const bob = await sp.createEntity<Person>(Person.dcr, { name: 'Bob' });
        expect(bob.version).toBe(1);

        await bob.update({ role: 'Engineer' });
        expect(bob.version).toBe(2);
        expect(bob['role']).toBe('Engineer');

        const reloaded = await sp.loadEntity<Person>(bob.id);
        expect(reloaded.version).toBe(2);
        expect(reloaded['role']).toBe('Engineer');
    });

    it("should create predicates with mirrored peer keys and prevent duplicates", async () => {
        const alice = await sp.createEntity<Person>(Person.dcr, { name: 'Alice 2' });
        const proj = await sp.createEntity<Project>(Project.dcr, { title: 'SemanticStudio' });

        const pred = await sp.createPredicate(alice, worksOn, proj, { hours: 40 });
        expect(pred.id).toBeDefined();
        expect(pred['_target_title']).toBe('SemanticStudio');
        expect(pred.payload.hours).toBe(40);

        // Duplicate predicate rejection
        let threw = false;
        try {
            await sp.createPredicate(alice, worksOn, proj, { hours: 20 });
        } catch (e: any) {
            threw = true;
            expect(e instanceof DuplicateKeyError || e.name === 'DuplicateKeyError' || e.message.includes('duplicate key')).toBe(true);
        }
        expect(threw).toBe(true);
    });

    it("should query incoming and outgoing predicates with entity enrichment", async () => {
        const dev = await sp.createEntity<Person>(Person.dcr, { name: 'Charlie' });
        const p1 = await sp.createEntity<Project>(Project.dcr, { title: 'P1' });
        const p2 = await sp.createEntity<Project>(Project.dcr, { title: 'P2' });

        await sp.createPredicate(dev, worksOn, p1);
        await sp.createPredicate(dev, worksOn, p2);

        const outPreds = await dev.outgoingPreds(worksOn, { projection: ['title'] });
        expect(outPreds.length).toBe(2);
        const titles = outPreds.map(p => p.peer['title']);
        expect(titles).toContain('P1');
        expect(titles).toContain('P2');

        const inPreds = await p1.incomingPreds(worksOn, { projection: ['name'] });
        expect(inPreds.length).toBe(1);
        expect(inPreds[0].peer['name']).toBe('Charlie');
    });

    it("should support semantic predicate inheritance", async () => {
        const lead = await sp.createEntity<Person>(Person.dcr, { name: 'Diana' });
        const proj = await sp.createEntity<Project>(Project.dcr, { title: 'EnterpriseMesh' });

        await sp.createPredicate(lead, worksOn, proj);

        // Querying parent predicate 'contributesTo' should return child 'worksOn' predicate
        const contributions = await lead.outgoingPreds(contributesTo);
        expect(contributions.some(p => p.predicateName === 'worksOn')).toBe(true);
    });

    it("should perform multi-hop graph traversal (traverse)", async () => {
        const dev = await sp.createEntity<Person>(Person.dcr, { name: 'Evan' });
        const proj = await sp.createEntity<Project>(Project.dcr, { title: 'TraversalProj' });
        const task = await sp.createEntity<Task>(Task.dcr, { summary: 'Implement SQLite' });

        await sp.createPredicate(dev, worksOn, proj);
        await sp.createPredicate(proj, tracks, task);

        // Traverse 2 hops from dev
        const subgraph = await sp.traverse(dev.id, { maxDepth: 2 });
        expect(subgraph.entities.length).toBe(3);
        expect(subgraph.predicates.length).toBe(2);

        const titles = subgraph.entities.map(e => e['title'] || e['name'] || e['summary']);
        expect(titles).toContain('Evan');
        expect(titles).toContain('TraversalProj');
        expect(titles).toContain('Implement SQLite');
    });

    it("should export ontology schema to JSON for AI / visual studio inspection", () => {
        const json = sp.ontology.toJSON();
        expect(json.packageName).toBe('main');
        const entityNames = json.entities.map(e => e.name);
        expect(entityNames).toContain('Person');
        expect(entityNames).toContain('Project');
        expect(entityNames).toContain('Task');

        const predNames = json.predicates.map(p => p.name);
        expect(predNames).toContain('contributesTo');
        expect(predNames).toContain('worksOn');
        expect(predNames).toContain('tracks');

        const schema = sp.ontology.exportSchema();
        expect(schema.entities['Person'].fields).toContain('name');
        expect(schema.entities['Person'].fields).toContain('role');
        expect(schema.predicates['worksOn'].keys).toEqual({ target: ['title'] });
    });

    it("should properly erase entities and cascade delete connected predicates", async () => {
        const ghost = await sp.createEntity<Person>(Person.dcr, { name: 'Ghost' });
        const target = await sp.createEntity<Project>(Project.dcr, { title: 'GhostProject' });

        await sp.createPredicate(ghost, worksOn, target);
        const ghostOut = await ghost.outgoingPreds(worksOn);
        expect(ghostOut.length).toBe(1);

        await ghost.erase();

        const reloadedGhost = await sp.loadEntity(ghost.id);
        expect(reloadedGhost).toBeNull();
        const remainingPreds = await target.incomingPreds(worksOn);
        expect(remainingPreds.length).toBe(0);
    });
});
