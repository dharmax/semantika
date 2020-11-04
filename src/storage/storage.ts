import * as mongo from "mongodb"
import {ClientSession, MongoClient, SessionOptions} from "mongodb"

import {FilterFunction, SortSpec} from '../types'
import {Mutex} from "../utils/mutex";
import {Collection} from "./collection";

export type StorageSession = ClientSession
export type QueryDictionary = { [name: string]: (...params: any[]) => Object }

class Storage {

    private collectionMutex = new Mutex()
    private collections = {};
    private queryDictionary: QueryDictionary

    constructor( readonly dbClient: MongoClient) {
    }
    setQueryDictionary(dictionary: QueryDictionary) {
        this.queryDictionary = dictionary
    }

    async startSession(options?: SessionOptions): Promise<StorageSession> {
        return this.dbClient.startSession(options)
    }

    async collection(name: string, initFunc?: (col: Collection) => void, clazz?: Function): Promise<Collection> {
        return this._collection(name, false, initFunc, clazz)
    }

    async predicateCollection(name: string, initFunc?: (col: Collection) => void): Promise<Collection> {
        return this._collection(name, true, initFunc)
    }

    async collectionForEntityType(type: Function, initFunc?: (col: Collection) => void): Promise<Collection> {
        initFunc = initFunc || type['initCollection']
        const collectionName = type['collectionName'] || type.name;
        return this.collection(collectionName, initFunc, type)
    }

    async purgeDatabase() {

        database = null
        this.collections = {}
        return await this.dbClient.dropDatabase()
    }


    private async _collection(name: string, forPredicates = false, initFunc?: (col: Collection) => void, clazz?: Function): Promise<Collection> {
        let self = this
        return new Promise<Collection>((resolve, reject) => {
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

    private async initCollection(name: string, forPredicates: boolean, clazz?: Function) {

        let col = await this.createCollection(name, forPredicates, clazz)
        this.collections[name] = col
        return col
    }


    /**
     * to be used only internally by Storage
     * @param name
     * @param forPredicates set to true to make it a special predicates collection
     * @param clazz the associated JS class. Optional.
     * @returns {Collection}
     */
     async createCollection(name: string, forPredicates: boolean, clazz?: Function):Promise<Collection> {
        try {
            //  initialize actual collection
            let collection = await this.dbClient.collection(name)

            return forPredicates ? new PredicateCollection(name, collection) : new Collection(name, collection, clazz)
        } catch (e) {
            console.error(e)
            return null
        }
    }
}

export class DuplicateKeyError extends Error {
    constructor(public readonly col: string) {
        super('duplicate key in collection  ' + col)
    }   //
}

export const SEPARATOR = '_'

export class PredicateCollection extends Collection {

    constructor(name, collection) {
        super(name, collection, null)
    }
}


type dbAndClient = mongo.Db & { client: MongoClient }
let database: dbAndClient = null

let dbMutex = new Mutex()
//
// async function getDb(): Promise<dbAndClient> {
//
//     const dbUrl = await getDatabaseUrl()
//     return new Promise<dbAndClient>(resolve => {
//         dbMutex.lock(() => {
//             if (database) {
//                 dbMutex.release()
//                 resolve(database)
//             } else {
//                 mongo.MongoClient.connect(dbUrl, <MongoClientOptions>{
//                     useNewUrlParser: true,
//                     useUnifiedTopology: true
//                 }).then(client => {
//                     database = Object.assign(client.db(getDatabaseName()), {client})
//                     storageEventEmitter.emit('connected', {database})
//                     dbMutex.release()
//                     resolve(database)
//                 }).catch(e => {
//                     dbMutex.release()
//                     console.error(e)
//                     resolve(null)
//                 })
//             }
//         })
//     })
// }

export interface IFindOptions {
    batchSize?: number
    limit?: number
    from?: number
    projection?: string[]
    filterFunction?: FilterFunction
    sort?:SortSpec
}


export const StandardFields: string[] = ['_created', '_lastUpdate', '_version']



export enum StreamFormats { records, entities, strings}

