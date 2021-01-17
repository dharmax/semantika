import {Collection as MongoCollection, MongoClient, SessionOptions} from "mongodb";
import {AbstractStorage, ICollection, IPhysicalCollection, QueryDictionary, StorageSession} from "../storage";
import {EntityCollection, PredicateCollection} from "../semantic-collections";
import {EntityDcr} from "../../descriptors";
import {MongoBasicCollection} from "./mongo-basic-collection";
import {SemanticPackage} from "../../semantic-package";

export class MongoStore extends AbstractStorage {

    private collections = {};
    private queryDictionary: QueryDictionary
    readonly dbClient: MongoClient


    constructor(uri: string) {
        super()
        this.dbClient = new MongoClient(uri, {useUnifiedTopology: true, useNewUrlParser: true});
    }

    async connect() {
        return this.dbClient.connect();
    }

    setQueryDictionary(dictionary: QueryDictionary) {
        this.queryDictionary = dictionary
    }

    async startSession(options?: SessionOptions): Promise<StorageSession> {
        return this.dbClient.startSession(options)
    }

    async purgeDatabase() {

        this.collections = {}
        return await this.dbClient.db().dropDatabase()
    }

    async close() {
        return await this.dbClient.close()
    }

    async getPhysicalCollection(name: string): Promise<any> {
        return this.dbClient.db().collection(name)
    }

    makeEntityCollection(physicalCollection: IPhysicalCollection, eDcr: EntityDcr, initFunc: (col: EntityCollection) => void): EntityCollection {
        const c = new EntityCollection(eDcr, this.makeBasicCollection(physicalCollection))
        initFunc && initFunc(c)
        return c
    }

    makePredicateCollection(semanticPackage: SemanticPackage, physicalCollection: IPhysicalCollection): PredicateCollection {
        return new PredicateCollection(semanticPackage, this.makeBasicCollection(physicalCollection))
    }

    makeBasicCollection(physicalCollection: IPhysicalCollection, initFunc?: (col: MongoBasicCollection) => void): ICollection {
        const c = new MongoBasicCollection(physicalCollection as MongoCollection)
        initFunc && initFunc(c)
        return c
    }

}