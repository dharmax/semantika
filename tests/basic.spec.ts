import * as joi from 'joi'
import {AbstractEntity, EntityDcr, PredicateDcr, SemanticPackage} from '../src';
import {EntityTemplate} from "../src/utils/template-processor";
import * as CAP from 'chai-as-promised'
import * as chai from 'chai'
import {MongoStore} from "../src";
import {MongoClient} from "mongodb";

chai.use(CAP)
const expect = chai.expect


describe("test mongo connectivity", () => {

    it('should connect to mongo db', async () => {

        const client = new MongoClient('mongodb://localhost:27017/testing-semantika', {useUnifiedTopology:true, useNewUrlParser:true})
        const con = await client.connect()
        await con.close()
    })

})

describe("Testing Semantika", function () {

    let sp: SemanticPackage
    before(async () => {
        const storage = new MongoStore('mongodb://localhost/testing-semantika');
        await storage.connect()
        await storage.purgeDatabase()
        sp = new SemanticPackage('main', {
            entityDcrs: [Person.dcr, WorkPlace.dcr],
            predicateDcrs: [worksFor]
        }, storage)

        process.on('SIGINT', async () => {
            await storage.close()
        })
    })

    it("should be able to create a Semantic Package and a collection ", async () => {


        const george = <Person>await sp.createEntity(Person.dcr, {name: 'George'})
        const hooli = <WorkPlace>await sp.createEntity(WorkPlace.dcr, {name: 'Hooli'})

        const job = await sp.createPredicate(george, worksFor, hooli, {position: 'CTO'})

        const foundPredicates = await hooli.incomingPreds(worksFor, {projection: ['name']})

        expect(foundPredicates.some(p => p.dcr === worksFor)).to.be.true;


    })

    it('should delete properly', async () => {
        const moshe: Person = await sp.createEntity(Person.dcr, {name: 'Moshe'})

        await moshe.erase()

        expect(await sp.loadEntity(moshe.id)).to.be.null

        const david: Person = await sp.createEntity(Person.dcr, {name: 'David'})
        const col = await sp.collectionForEntityType(david.descriptor)
        await col.deleteByQuery({name: 'David'})
        expect(await sp.loadEntity(david.id)).to.be.null

    })

    it("should use basic collection", async () => {
        const col = await sp.basicCollection('basic')
        await col.append({x: 10, y: 'bla'})

        const doc: any = await col.findOne({x: 10})

        expect(doc.y).to.be.equal('bla')


    })


})


class Person extends AbstractEntity {

    static template: EntityTemplate = {
        name: joi.string().required()
    };
    static readonly dcr = new EntityDcr(Person, Person.template)
}

class WorkPlace extends AbstractEntity {

    static template: EntityTemplate = {
        name: joi.string().required()
    };
    static readonly dcr = new EntityDcr(WorkPlace, WorkPlace.template)
}

const worksFor = new PredicateDcr('worksFor', [], {}, {
    position: joi.string(),
    start: joi.date(),
    end: joi.date(),
})