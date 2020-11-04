import {beforeEach, describe, expect, it} from 'jasmine'
import {AbstractEntity, EntityDcr, PredicateDcr, SemanticPackage} from '../../src';
import {MongoStorage} from "../../src/storage/mongo-storage";
import {IStorage} from "../../src/storage/storage";
import {EntityTemplate} from "../../src/utils/template-processor";
import * as joi from 'joi'

describe("Testing Semantix", function () {

    beforeEach(() => {
    });

    it("should be able to create a Semantic Package and a collection ", async () => {

        const storage: IStorage = new MongoStorage('mongodb://localhost');

        const entityDcrs = [Person.dcr, WorkPlace.dcr];
        const predicateDcrs = [worksFor]
        const sp = new SemanticPackage('main', {
            entityDcrs,
            predicateDcrs
        }, storage)

        const george = <Person>await sp.createEntity(Person.dcr, {name: 'George'})
        const hooli = <WorkPlace>await sp.createEntity(WorkPlace.dcr, {name: 'Hooli'})

        const job = await sp.createPredicate(george, worksFor, hooli, {position: 'CTO'})

    })
})


class Person extends AbstractEntity {

    static template: EntityTemplate = {
        name: joi.string().required()
    };
    static readonly dcr = new EntityDcr(Person, Person.template)

    getContainers(): Promise<AbstractEntity[]> {
        return Promise.resolve([]);
    }

}

class WorkPlace extends AbstractEntity {

    static template: EntityTemplate = {
        name: joi.string().required()
    };
    static readonly dcr = new EntityDcr(WorkPlace, WorkPlace.template)

    getContainers(): Promise<AbstractEntity[]> {
        return Promise.resolve([]);
    }

}

const worksFor = new PredicateDcr('worksFor', [], {}, {
    position: joi.string(),
    start: joi.date(),
    end: joi.date(),
})