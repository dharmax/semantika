import * as mongo
    from "../../../../.config/JetBrains/WebStorm2020.2/javascript/extLibs/codota-types/mongodb/3.5.32/@types/mongodb";
import {
    ChangeStream,
    Cursor,
    MongoCountPreferences
} from "../../../../.config/JetBrains/WebStorm2020.2/javascript/extLibs/codota-types/mongodb/3.5.32/@types/mongodb";
import {LoggedException} from "../utils/logged-exception";
import {IReadOptions, IReadResult} from "../types";
import {props} from "../../../../.config/JetBrains/WebStorm2020.2/javascript/extLibs/codota-types/bluebird/3.5.33/@types/bluebird";
import {generate} from "short-uuid";
import {DuplicateKeyError, IFindOptions, SEPARATOR, StreamFormats} from "./storage";

export class Collection {

    /**
     * Not to be accessed directly.
     * @param name
     * @param collection
     * @param clazz
     */
    constructor(public readonly name: string, private collection: mongo.Collection, readonly clazz: Function) {
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

    // async findById<T extends AbstractEntity | Object>(_id: string, projection?: string[]): Promise<T> {
    //     const record: any = await this.findOne({_id}, projection)
    //     if (!record)
    //         return null
    //     if (!this.clazz)
    //         return record
    //     return <T>this.sp.makeEntity(this.clazz, record._id, record)
    // }
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

    // async* findGenerator(query, options: IFindOptions = {}): AsyncGenerator<AbstractEntity | Object> {
    //     const cursor = await this.find(query, options)
    //     while (await cursor.hasNext()) {
    //         const record = await cursor.next()
    //         const entity = makeEntity(undefined, undefined, record)
    //         yield entity
    //     }
    // }

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

    // async findSome<T>(query, options: IFindOptions = {}): Promise<T[]> {
    //
    //     // @ts-ignore
    //     const cursor = await this.find(...arguments)
    //     const arrayP = await cursor.toArray()
    //
    //     let result = this.clazz ?
    //         map(arrayP, rec => makeEntity(this.clazz, rec['_id'], rec))
    //         :
    //         arrayP
    //
    //     if (options.filterFunction)
    //         result = await options.filterFunction(await result)
    //
    //     return result as T[]
    // }

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
        }
    }

    //
    // async findSomeStream<T>(query, options: IFindOptions, format = StreamFormats.strings): Promise<Cursor<T>> {
    //     // @ts-ignore
    //     const cursor = await this.find(...arguments)
    //
    //     switch (format) {
    //         case StreamFormats.records:
    //             return cursor.stream()
    //         case StreamFormats.strings:
    //             return cursor.stream({
    //                 transform: rec => JSON.stringify(rec)
    //             })
    //         case StreamFormats.entities:
    //             return cursor.stream({
    //                 transform: rec => {
    //                     return this.clazz ? makeEntity(this.clazz, rec._id, rec) : rec
    //                 }
    //             })
    //
    //     }
    // }
    //

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

    ensureIndex(keys: Object, options?: mongo.IndexOptions) {
        return this.collection.createIndex(keys, options)
    }

    async findOneAndModify(criteria: any, change: Object) {
        return this.collection.findOneAndUpdate(criteria, {$set: change})
    }

    protected createId() {
        return this.clazz ?
            `${this.clazz.name}${SEPARATOR}${generate()}`
            : generate()
    }

    // protected createId() {
    //     return this.clazz ?
    //         `${this.sp ? this.sp.name : ''}${SEPARATOR}${this.clazz.name}${SEPARATOR}${generate()}`
    //         : generate()
    // }
}


function arrayToProjection(projection: string[], cursor) {
    projection = Array.from(new Set(projection))
    let p = projection.reduce((res, cur) => {
        cur && (res[cur] = 1)
        return res
    }, {})
    cursor.project(p)
}
const DEFAULT_BATCH_SIZE = 100