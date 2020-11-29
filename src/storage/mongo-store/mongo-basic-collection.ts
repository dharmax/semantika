import {ChangeStream, Collection as MongoCollection, Cursor, IndexOptions, MongoCountPreferences,} from "mongodb";
import {LoggedException} from "../../utils/logged-exception";
import {IReadOptions, IReadResult} from "../../types";
import {props} from "bluebird";
import {generate} from "short-uuid";
import {DuplicateKeyError, IFindOptions, IPhysicalCollection, StreamFormats} from "../storage";
import {arrayToProjection} from "../../utils/array-to-projection";

export class MongoBasicCollection implements IPhysicalCollection {

    /**
     * Not to be accessed directly.
     * @param name
     * @param collection
     */
    constructor(private collection: MongoCollection) {
    }


    get name() {
        return this.collection.collectionName;
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

    async findById<T extends Object>(_id: string, projection?: string[]): Promise<T> {
        return this.findOne({_id}, projection)
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

    async* findGenerator(query, options: IFindOptions = {}): AsyncGenerator<Object> {
        const cursor = await this.find(query, options)
        while (await cursor.hasNext()) {
            const record = await cursor.next()
            yield record
        }
    }

    async distinct(field: string, query, options: IFindOptions = {}): Promise<any> {
        return this.collection.distinct(field, query)
    }

    async findSome<T>(query, options: IFindOptions = {}): Promise<T[]> {

        // @ts-ignore
        const cursor = await this.find(...arguments)
        const arrayP = await cursor.toArray()

        let result = arrayP

        if (options.filterFunction)
            result = await options.filterFunction(result)

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
            default:
                throw new Error('Stream formant not supported')
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

    ensureIndex(keys: Object, options?: IndexOptions) {
        return this.collection.createIndex(keys, options)
    }

    async findOneAndModify(criteria: any, change: Object) {
        return this.collection.findOneAndUpdate(criteria, {$set: change})
    }

    createId() {
        return generate()
    }

}


const DEFAULT_BATCH_SIZE = 100