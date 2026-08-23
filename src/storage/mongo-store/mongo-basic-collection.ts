import {ChangeStream, Collection as MongoCollection, FindCursor as Cursor, CreateIndexesOptions as IndexOptions, CountDocumentsOptions as MongoCountPreferences,} from "mongodb";
import {LoggedException} from "../../utils/logged-exception.js";
import {IReadOptions, IReadResult} from "../../types.js";
import {generate} from "short-uuid";
import {DuplicateKeyError, ICollection, IFindOptions, IPhysicalCollection, StreamFormats} from "../storage.js";
import {arrayToProjection} from "../../utils/array-to-projection.js";

export class MongoBasicCollection implements IPhysicalCollection, ICollection {

    /**
     * Not to be accessed directly.
     * @param collection
     */
    constructor(private collection: MongoCollection) {
    }

    get name() {
        return this.collection.collectionName;
    }

    watch(callback: (change: any) => Promise<boolean>, ...args: any[]): void {

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
            _id: _id as any,
        }, {
            $set: fields
        })
        const success = result.modifiedCount === 1
        if (success)
            return true
    }

    async updateDocument(_id: string, fields: Object, version?: number, rawOperations: Object = {}) {
        const result = await this.collection.updateOne({
            _id: _id as any,
            _version: (version || fields["_version"]) as any
        }, {
            $set: {...fields, _lastUpdate: new Date()},
            $inc: {_version: 1} as any,
            ...rawOperations
        })
        const success = result.modifiedCount === 1
        if (success)
            return true
        // check if there was a version mismatch
        const existing: any = await this.findById(_id)
        if (existing._version != version) {
            throw new LoggedException(`Optimistic locking exception on collection \${this.name}: ver \${existing._version} instead of \${version}`)
        }
        return result
    }

    async findById<T extends Object>(_id: string, projection?: string[]): Promise<T> {
        return this.findOne({_id}, projection)
    }

    async find(query: any, options: IFindOptions = {}): Promise<Cursor> {
        const cursor = this.collection.find(query || {})
        options.projection && options.projection.push('_id', '_version')
        options.sort && cursor.sort(options.sort as any)
        if (options.limit) {
            cursor.limit(options.limit)
            if (options.batchSize) cursor.batchSize(options.batchSize)
        }
        options.from && cursor.skip(options.from)
        arrayToProjection(options.projection, cursor as any)

        return cursor as any
    }

    async* findGenerator(query: any, options: IFindOptions = {}): AsyncGenerator<Object> {
        const cursor = await this.find(query, options)
        while (await cursor.hasNext()) {
            const record = await cursor.next()
            yield record as any
        }
    }

    async distinct(field: string, query: any, _options: IFindOptions = {}): Promise<any> {
        return this.collection.distinct(field, query)
    }

    async findSome<T>(query: any, options: IFindOptions = {}): Promise<T[]> {

        // @ts-ignore
        const cursor = await this.find(query, options)
        let result = await cursor.toArray()

        if (options.filterFunction)
            result = await options.filterFunction(result)

        return result as any[]
    }

    async findSomeStream<T>(query: any, options: IFindOptions, format = StreamFormats.strings): Promise<Cursor<T>> {
        // @ts-ignore
        const cursor = await this.find(query, options)

        switch (format) {
            case StreamFormats.records:
                return cursor.stream() as any
            case StreamFormats.strings:
                return cursor.stream({
                    transform: (rec: any) => JSON.stringify(rec) as any
                }) as any
            default:
                throw new Error('Stream formant not supported')
        }
    }

    async count(query: any, opts?: MongoCountPreferences): Promise<number> {
        return this.collection.countDocuments(query, opts)
    }

    async findOne<T>(query: any, projection?: string[]): Promise<T> {

        if (projection) projection.push('_id', '_version')
        let some = await this.findSome<T>(query, {limit: 1, projection})
        return some.length ? some[0] : null as any
    }

    async load<T>(opt: IReadOptions, query?: Object): Promise<IReadResult> {

        // it is done that way to let the database do both heavy tasks in parallel
        let [items, totalFiltered] = [
            (opt ? this.findSome(query, {
                limit: opt.count,
                from: opt.from,
                projection: opt.projection,
                sort: opt.sort,
                filterFunction: opt.filterFunction
            }) : this.findSome(query)),
            this.count(query || {})]

        let [_items, _totalFiltered] = await Promise.all([items, totalFiltered])
        return Object.assign({items: _items, totalFiltered: _totalFiltered}, {opts: opt, total: -1})
    }

    /**
     * @param doc the record
     * @returns on success, the id of the new entry
     */
    async append(doc: Object): Promise<string> {
        // @ts-ignore
        doc = Object.assign({_id: doc.id || doc._id || this.createId(), '_version': 1, '_created': new Date()}, doc)
        try {
            const res = await this.collection.insertOne(doc as any)
            return res.insertedId.toString()
        } catch (e: any) {
            if (e.code === 11000)
                throw new DuplicateKeyError(this.collection.collectionName)
            throw e
        }
    }

    async deleteById(_id: string) {
        let result = await this.collection.deleteOne({_id: _id as any})
        return result.deletedCount === 1
    }

    async deleteByQuery(query: any) {
        let result = await this.collection.deleteMany(query)
        return result.deletedCount

    }

    ensureIndex(keys: Object, options?: IndexOptions) {
        return this.collection.createIndex(keys as any, options)
    }

    async findOneAndModify(criteria: any, change: Object) {
        return this.collection.findOneAndUpdate(criteria, {$set: change})
    }

    createId() {
        return generate()
    }

}
