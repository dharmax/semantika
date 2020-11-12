import {MongoClient, SessionOptions} from "mongodb";
import {AbstractStorage, QueryDictionary, StorageSession} from "./storage";
import {EntityCollection, PredicateCollection} from "./semantic-collections";
import {EntityDcr, PredicateDcr} from "../descriptors";
import {BasicCollection} from "./basic-collection";

export class MongoStorage extends AbstractStorage {

    private collections = {};
    private queryDictionary: QueryDictionary
    private dbClient: MongoClient


    constructor(uri: string) {
        super()
        this.dbClient = new MongoClient(uri);
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

    async getPhysicalCollection(name: string): Promise<any> {

        return this.dbClient.db().collection(name)
    }

    async entityCollection(collectionName: string, initFunc: (col: EntityCollection) => void, eDcr: EntityDcr): Promise<EntityCollection> {
        const c = await super.collectionForName(collectionName, false, initFunc, eDcr.clazz) as EntityCollection
        return new EntityCollection(eDcr, c)
    }

    async predicateCollection(pDcr: PredicateDcr): Promise<PredicateCollection> {
        const c = await super.collectionForName(pDcr || '_predicates', true)
        return new PredicateCollection()
    }

    basicCollection(collectionName: string, initFunc?: (col: BasicCollection) => void): Promise<BasicCollection> {
        return super.collectionForName(collectionName, false, initFunc)
    }


}