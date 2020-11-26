"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
const joi = require("joi");
const src_1 = require("../src");
const mongo_storage_1 = require("../src/storage/mongo-storage");
const chai_1 = require("chai");
describe("Testing Semantix", function () {
    let sp;
    before(async () => {
        const storage = new mongo_storage_1.MongoStorage('mongodb://localhost/testing-semantix');
        await storage.connect();
        await storage.purgeDatabase();
        const entityDcrs = [Person.dcr, WorkPlace.dcr];
        const predicateDcrs = [worksFor];
        sp = new src_1.SemanticPackage('main', {
            entityDcrs,
            predicateDcrs
        }, storage);
    });
    beforeEach(() => {
    });
    it("should be able to create a Semantic Package and a collection ", async () => {
        const george = await sp.createEntity(Person.dcr, {name: 'George'});
        const hooli = await sp.createEntity(WorkPlace.dcr, {name: 'Hooli'});
        const job = await sp.createPredicate(george, worksFor, hooli, {position: 'CTO'});
        const foundPredicates = await hooli.incomingPreds(worksFor, {projection: ['name']});
        chai_1.expect(foundPredicates.some(p => p.dcr === worksFor)).to.be.true;
    });
});
class Person extends src_1.AbstractEntity {
    getContainers() {
        return Promise.resolve([]);
    }
}
Person.template = {
    name: joi.string().required()
};
Person.dcr = new src_1.EntityDcr(Person, Person.template);
class WorkPlace extends src_1.AbstractEntity {
    getContainers() {
        return Promise.resolve([]);
    }
}
WorkPlace.template = {
    name: joi.string().required()
};
WorkPlace.dcr = new src_1.EntityDcr(WorkPlace, WorkPlace.template);
const worksFor = new src_1.PredicateDcr('worksFor', [], {}, {
    position: joi.string(),
    start: joi.date(),
    end: joi.date(),
});
//# sourceMappingURL=basic.spec.js.map