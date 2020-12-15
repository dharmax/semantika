"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const joi = require("joi");
const src_1 = require("../src");
const chai_1 = require("chai");
const src_2 = require("../src");
describe("Testing Semantix", function () {
    let sp;
    before(async () => {
        const storage = new src_2.MongoStore('mongodb://localhost/testing-semantix');
        await storage.connect();
        await storage.purgeDatabase();
        sp = new src_1.SemanticPackage('main', {
            entityDcrs: [Person.dcr, WorkPlace.dcr],
            predicateDcrs: [worksFor]
        }, storage);
    });
    it("should be able to create a Semantic Package and a collection ", async () => {
        const george = await sp.createEntity(Person.dcr, { name: 'George' });
        const hooli = await sp.createEntity(WorkPlace.dcr, { name: 'Hooli' });
        const job = await sp.createPredicate(george, worksFor, hooli, { position: 'CTO' });
        const foundPredicates = await hooli.incomingPreds(worksFor, { projection: ['name'] });
        chai_1.expect(foundPredicates.some(p => p.dcr === worksFor)).to.be.true;
    });
    it("should use basic collection", async () => {
        const col = await sp.basicCollection('basic');
        await col.append({ x: 10, y: 'bla' });
        const doc = await col.findOne({ x: 10 });
        chai_1.expect(doc.y).to.be.equal('bla');
    });
});
class Person extends src_1.AbstractEntity {
}
Person.template = {
    name: joi.string().required()
};
Person.dcr = new src_1.EntityDcr(Person, Person.template);
class WorkPlace extends src_1.AbstractEntity {
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