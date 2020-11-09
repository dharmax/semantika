import {MongoClient, SessionOptions} from "mongodb";
import {AbstractStorage, QueryDictionary, StorageSession} from "./storage";

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




}