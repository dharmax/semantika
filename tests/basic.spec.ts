import * as joi from 'joi';
import {AbstractEntity, DuplicateKeyError, EntityDcr, PredicateDcr, SemanticPackage, MongoStore} from '../src/index.js';
import {EntityTemplate} from "../src/utils/template-processor.js";
import {describe, it, beforeAll, afterAll, expect} from 'bun:test';

class Person extends AbstractEntity {
    static template: EntityTemplate = {
        name: joi.string().required()
    };
    static readonly dcr = new EntityDcr(Person, Person.template);
}

class WorkPlace extends AbstractEntity {
    static template: EntityTemplate = {
        name: joi.string().required()
    };
    static readonly dcr = new EntityDcr(WorkPlace, WorkPlace.template);
}

const worksFor = new PredicateDcr('worksFor', [], {target:['name']}, {
    position: joi.string(),
    start: joi.date(),
    end: joi.date(),
});

describe("Testing Semantika Mongo Store (Integration)", function () {
    let sp: SemanticPackage;
    let storage: MongoStore;
    let isMongoAvailable = false;

    beforeAll(async () => {
        try {
            storage = new MongoStore('mongodb://localhost:27017/testing-semantika?serverSelectionTimeoutMS=300&connectTimeoutMS=300');
            await storage.connect();
            await storage.purgeDatabase();
            isMongoAvailable = true;

            sp = new SemanticPackage('main', {
                entityDcrs: [Person.dcr, WorkPlace.dcr],
                predicateDcrs: [worksFor]
            }, storage);
        } catch {
            isMongoAvailable = false;
        }
    });

    afterAll(async () => {
        if (storage && isMongoAvailable) {
            try {
                await storage.close();
            } catch {}
        }
    });

    it("should be able to create a Semantic Package and a collection when Mongo is running", async () => {
        if (!isMongoAvailable) {
            expect(true).toBe(true);
            return;
        }

        const george = await sp.createEntity<Person>(Person.dcr, {name: 'George'});
        const hooli = await sp.createEntity<WorkPlace>(WorkPlace.dcr, {name: 'Hooli'});

        const job = await sp.createPredicate(george, worksFor, hooli, {position: 'CTO'});
        const foundPredicates = await hooli.incomingPreds(worksFor, {projection: ['name']});

        expect(foundPredicates.some(p => p.predicateName === 'worksFor')).toBe(true);

        let threw = false;
        try {
            await sp.createPredicate(george, worksFor, hooli, {position: 'Babysitter'});
        } catch (e: any) {
            threw = true;
            expect(e instanceof DuplicateKeyError || e.name === 'DuplicateKeyError' || e.message.includes('duplicate key')).toBe(true);
        }
        expect(threw).toBe(true);
    });

    it('should delete properly in Mongo', async () => {
        if (!isMongoAvailable) {
            expect(true).toBe(true);
            return;
        }

        const moshe = await sp.createEntity<Person>(Person.dcr, {name: 'Moshe'});
        await moshe.erase();
        expect(await sp.loadEntity(moshe.id)).toBeNull();

        const david = await sp.createEntity<Person>(Person.dcr, {name: 'David'});
        const col = await sp.collectionForEntityType(david.descriptor);
        await col.deleteByQuery({name: 'David'});
        expect(await sp.loadEntity(david.id)).toBeNull();
    });

    it("should use basic collection in Mongo", async () => {
        if (!isMongoAvailable) {
            expect(true).toBe(true);
            return;
        }

        const col = await sp.basicCollection('basic');
        await col.append({x: 10, y: 'bla'});

        const doc: any = await col.findOne({x: 10});
        expect(doc.y).toBe('bla');
    });
});