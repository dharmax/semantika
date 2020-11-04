import {Mutex} from "../utils/mutex";
import {MongoClient, SessionOptions} from "mongodb";
import {BasicCollection} from "./basic-collection";
import {ICollection, IStorage, QueryDictionary, StorageSession} from "./storage";
import {EntityDcr} from "../descriptors";

export class MongoStorage implements IStorage {

    private collectionMutex = new Mutex()
    private collections = {};
    private queryDictionary: QueryDictionary
    private dbClient: MongoClient


    constructor(uri: string) {
        this.dbClient = new MongoClient(uri);
    }

    async connect(uri: string) {
        return this.dbClient.connect();
    }

    setQueryDictionary(dictionary: QueryDictionary) {
        this.queryDictionary = dictionary
    }

    async startSession(options?: SessionOptions): Promise<StorageSession> {
        return this.dbClient.startSession(options)
    }

    async collection(name: string, initFunc?: (col: ICollection) => void, eDcr?: EntityDcr): Promise<ICollection> {
        return this._collection(name, false, initFunc, eDcr)
    }

    async purgeDatabase() {

        this.collections = {}
        return await this.dbClient.db().dropDatabase()
    }

    initCollection(name: string, forPredicates: boolean, clazz?: Function): Promise<ICollection> {

    }


    private async _collection(name: string, forPredicates = false, initFunc?: (col: ICollection) => void, clazz?: Function): Promise<BasicCollection> {
        let self = this
        return new Promise<BasicCollection>((resolve, reject) => {
            self.collectionMutex.lock(() => {
                let col = self.collections[name]
                if (col) {
                    self.collectionMutex.release()
                    resolve(col)
                } else {
                    self.initCollection(name, forPredicates, clazz).then(c => {
                        initFunc && initFunc(c)
                        resolve(c);
                        self.collectionMutex.release()
                    })
                        .catch((e) => {
                            self.collectionMutex.release()
                            reject(e)
                        })

                }
            })
        })
    }

    createCollection(name: string, forPredicates: boolean, clazz?: Function): Promise<BasicCollection> {

        return Promise.resolve(undefined);
    }


}