import {map, props} from 'bluebird'
import * as mongo from "mongodb"
import {
    ChangeStream,
    ClientSession,
    Cursor,
    MongoClient,
    MongoClientOptions,
    MongoCountPreferences,
    SessionOptions
} from "mongodb"

import {Mutex} from './utils/mutex'
import {FilterFunction, IReadOptions, IReadResult, SortSpec} from './types'
import {AbstractEntity} from "./abstract-entity";
import {makeEntity, SemanticPackage} from "./model-manager";
import {generate} from 'short-uuid'
import {storageEventEmitter} from "./utils/storage-event-emitter";
import {LoggedException} from "./utils/logged-exception";

export type StorageSession = ClientSession
export type QueryDictionary = { [name: string]: (...params: any[]) => Object }

class Storage {

    private collectionMutex = new Mutex()
    private collections = {};
    private queryDictionary: QueryDictionary

    setQueryDictionary(dictionary: QueryDictionary) {
        this.queryDictionary = dictionary
    }

    async startSession(options?: SessionOptions): Promise<StorageSession> {
        const db = await getDb()
        return db.client.startSession(options)
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

        const db = await getDb()

        database = null
        this.collections = {}
        return await db.dropDatabase()
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

        let col = await Collection.create(name, forPredicates, clazz)
        this.collections[name] = col
        return col
    }

    getQueryFromReadOptions(collection: Collection, theOptions: IReadOptions) {
        if (!theOptions.queryName)
            return {}
        const queryConstructor = this.queryDictionary[theOptions.queryName]
        if (!queryConstructor)
            throw new Error(`No such query constructor ${theOptions.queryName}`)
        return queryConstructor(theOptions.queryParams)
    }
}

class DuplicateKeyError extends Error {
    constructor(public readonly col: string) {
        super('duplicate key in collection  ' + col)
    }   //
}

export class Collection {

    protected constructor(public readonly name: string, private collection: mongo.Collection, readonly clazz: Function, readonly  sp?: SemanticPackage) {
    }


    watch(callback: (change: ChangeStream) => Promise<boolean>, ...args): void {

        const self = this
        // noinspection JSIgnoredPromiseFromCall
        watchIt()

        async function watchIt() {
            while (true) {
                const changeStream: ChangeStream = self.collection.watch(...args)
                const change = await changeStream.next()
                if (await callback(change))
                    break
            }
        }
    }

    /**
     * to be used only internally by Storage
     * @param name
     * @param forPredicates set to true to make it a special predicates collection
     * @param clazz the associated JS class. Optional.
     * @returns {Collection}
     */
    static async create(name, forPredicates: boolean = false, clazz?: Function) {
        try {
            //  get connection
            let db: mongo.Db = <mongo.Db>await getDb()
            //  initialize actual collection
            let collection = await db.collection(name)

            return forPredicates ? new PredicateCollection(name, collection) : new Collection(name, collection, clazz)
        } catch (e) {
            console.error(e)
            return null
        }
    }

    async updateDocumentUnsafe(_id: string, fields: Object) {
        const result = await this.collection.updateOne({
            _id,
        }, {
            $set: fields
        })
        const success = result.modifiedCount === 1
        if (success)
            return true
    }

    async updateDocument(_id: string, fields: Object, version?: number, rawOperations: Object = {}) {
        const result = await this.collection.updateOne({
            _id,
            _version: version || fields["_version"]
        }, {
            $set: {...fields, _lastUpdate: new Date()},
            $inc: {_version: 1},
            ...rawOperations
        })
        const success = result.modifiedCount === 1
        if (success)
            return true
        // check if there was a version mismatch
        const existing: any = await this.findById(_id)
        if (existing._version != version) {
            throw new LoggedException(`Optimistic locking exception on collection ${this.name}: ver ${existing._version} instead of ${version}`)
        }
        return result.result
    }

    async findById<T extends AbstractEntity | Object>(_id: string, projection?: string[]): Promise<T> {
        const record: any = await this.findOne({_id}, projection)
        if (!record)
            return null
        if (!this.clazz)
            return record
        return <T>makeEntity(this.clazz, record._id, record)
    }

    async find(query, options: IFindOptions = {}): Promise<Cursor> {
        const cursor = this.collection.find(query)
        options?.projection?.push('_id', '_version')
        options.sort && cursor.sort(options.sort)
        options.limit && cursor.batchSize(Math.min(options.batchSize || DEFAULT_BATCH_SIZE, options.limit)).limit(options.limit)
        options.from && cursor.skip(options.from)
        arrayToProjection(options.projection, cursor)

        return cursor
    }

    async* findGenerator(query, options: IFindOptions = {}): AsyncGenerator<AbstractEntity | Object> {
        const cursor = await this.find(query, options)
        while (await cursor.hasNext()) {
            const record = await cursor.next()
            const entity = makeEntity(undefined, undefined, record)
            yield entity
        }
    }

    async distinct(field: string, query, options: IFindOptions = {}): Promise<any> {
        return this.collection.distinct(field, query)
    }

    async findSome<T>(query, options: IFindOptions = {}): Promise<T[]> {

        // @ts-ignore
        const cursor = await this.find(...arguments)
        const arrayP = await cursor.toArray()

        let result = this.clazz ?
            map(arrayP, rec => makeEntity(this.clazz, rec['_id'], rec))
            :
            arrayP

        if (options.filterFunction)
            result = await options.filterFunction(await result)

        return result as T[]
    }

    async findSomeStream<T>(query, options: IFindOptions, format = StreamFormats.strings): Promise<Cursor<T>> {
        // @ts-ignore
        const cursor = await this.find(...arguments)

        switch (format) {
            case StreamFormats.records:
                return cursor.stream()
            case StreamFormats.strings:
                return cursor.stream({
                    transform: rec => JSON.stringify(rec)
                })
            case StreamFormats.entities:
                return cursor.stream({
                    transform: rec => {
                        return this.clazz ? makeEntity(this.clazz, rec._id, rec) : rec
                    }
                })

        }
    }


    async count(query, opts?: MongoCountPreferences): Promise<number> {
        return this.collection.countDocuments(query, opts)
    }

    async findOne<T>(query, projection?: string[]): Promise<T> {

        if (projection) projection.push('_id', '_version')
        let some = await this.findSome<T>(query, {limit: 1, projection})
        return some.length ? some[0] : null
    }

    async load<T>(opt: IReadOptions, query?: Object): Promise<IReadResult> {

        query = query || storage.getQueryFromReadOptions(this, opt) || {}
        let r = await props({
            items: (opt ? this.findSome(query, {
                limit: opt.count,
                from: opt.from,
                projection: opt.projection,
                sort: opt.sort,
                filterFunction: opt.filterFunction
            }) : this.findSome(query)),
            totalFiltered: this.count(query || {}),
        })
        return Object.assign(r, {opts: opt, total: -1})
    }

    /**
     * @param doc the record
     * @returns on success, the id of the new entry
     */
    async append(doc: Object): Promise<string> {
        // @ts-ignore
        doc = Object.assign({_id: doc.id || doc._id || this.createId(), '_version': 1, '_created': new Date()}, doc)
        try {
            const res = await this.collection.insertOne(doc)
            return res.insertedId.toString()
        } catch (e) {
            if (e.code === 11000)
                throw new DuplicateKeyError(this.collection.collectionName)
            throw e
        }
    }

    async deleteById(_id: string) {
        let result = await this.collection.deleteOne({_id})
        return result.deletedCount === 1
    }

    async deleteByQuery(query: any) {
        let result = await this.collection.deleteMany(query)
        return result.deletedCount

    }

    ensureIndex(keys: Object, options?: mongo.IndexOptions) {
        return this.collection.createIndex(keys, options)
    }

    async findOneAndModify(criteria: any, change: Object) {
        return this.collection.findOneAndUpdate(criteria, {$set: change})
    }

    private createId() {
        return this.clazz ?
            `${this.sp ? this.sp.name : ''}${SEPARATOR}${this.clazz.name}${SEPARATOR}${generate()}`
            : generate()
    }
}

export const SEPARATOR = '_'

export class PredicateCollection extends Collection {

    constructor(name, collection) {
        super(name, collection, null)
    }
}

export let storage = new Storage()

function arrayToProjection(projection: string[], cursor) {
    projection = Array.from(new Set(projection))
    let p = projection.reduce((res, cur) => {
        cur && (res[cur] = 1)
        return res
    }, {})
    cursor.project(p)
}


type dbAndClient = mongo.Db & { client: MongoClient }
let database: dbAndClient = null

let dbMutex = new Mutex()

async function getDb(): Promise<dbAndClient> {

    const dbUrl = await getDatabaseUrl()
    return new Promise<dbAndClient>(resolve => {
        dbMutex.lock(() => {
            if (database) {
                dbMutex.release()
                resolve(database)
            } else {
                mongo.MongoClient.connect(dbUrl, <MongoClientOptions>{
                    useNewUrlParser: true,
                    useUnifiedTopology: true
                }).then(client => {
                    database = Object.assign(client.db(getDatabaseName()), {client})
                    storageEventEmitter.emit('connected', {database})
                    dbMutex.release()
                    resolve(database)
                }).catch(e => {
                    dbMutex.release()
                    console.error(e)
                    resolve(null)
                })
            }
        })
    })
}

export interface IFindOptions {
    batchSize?: number
    limit?: number
    from?: number
    projection?: string[]
    filterFunction?: FilterFunction
    sort?:SortSpec
}


export const StandardFields: string[] = ['_created', '_lastUpdate', '_version']

const DEFAULT_BATCH_SIZE = 100


export enum StreamFormats { records, entities, strings}

