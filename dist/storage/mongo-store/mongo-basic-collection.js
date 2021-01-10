"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoBasicCollection = void 0;
const logged_exception_1 = require("../../utils/logged-exception");
const bluebird_1 = require("bluebird");
const short_uuid_1 = require("short-uuid");
const storage_1 = require("../storage");
const array_to_projection_1 = require("../../utils/array-to-projection");
class MongoBasicCollection {
    /**
     * Not to be accessed directly.
     * @param name
     * @param collection
     */
    constructor(collection) {
        this.collection = collection;
    }
    get name() {
        return this.collection.collectionName;
    }
    watch(callback, ...args) {
        const self = this;
        // noinspection JSIgnoredPromiseFromCall
        watchIt();
        async function watchIt() {
            while (true) {
                const changeStream = self.collection.watch(...args);
                const change = await changeStream.next();
                if (await callback(change))
                    break;
            }
        }
    }
    async updateDocumentUnsafe(_id, fields) {
        const result = await this.collection.updateOne({
            _id,
        }, {
            $set: fields
        });
        const success = result.modifiedCount === 1;
        if (success)
            return true;
    }
    async updateDocument(_id, fields, version, rawOperations = {}) {
        const result = await this.collection.updateOne({
            _id,
            _version: version || fields["_version"]
        }, {
            $set: { ...fields, _lastUpdate: new Date() },
            $inc: { _version: 1 },
            ...rawOperations
        });
        const success = result.modifiedCount === 1;
        if (success)
            return true;
        // check if there was a version mismatch
        const existing = await this.findById(_id);
        if (existing._version != version) {
            throw new logged_exception_1.LoggedException(`Optimistic locking exception on collection ${this.name}: ver ${existing._version} instead of ${version}`);
        }
        return result.result;
    }
    async findById(_id, projection) {
        return this.findOne({ _id }, projection);
    }
    async find(query, options = {}) {
        var _a;
        const cursor = this.collection.find(query);
        (_a = options === null || options === void 0 ? void 0 : options.projection) === null || _a === void 0 ? void 0 : _a.push('_id', '_version');
        options.sort && cursor.sort(options.sort);
        options.limit && cursor.batchSize(Math.min(options.batchSize || DEFAULT_BATCH_SIZE, options.limit)).limit(options.limit);
        options.from && cursor.skip(options.from);
        array_to_projection_1.arrayToProjection(options.projection, cursor);
        return cursor;
    }
    async *findGenerator(query, options = {}) {
        const cursor = await this.find(query, options);
        while (await cursor.hasNext()) {
            const record = await cursor.next();
            yield record;
        }
    }
    async distinct(field, query, options = {}) {
        return this.collection.distinct(field, query);
    }
    async findSome(query, options = {}) {
        // @ts-ignore
        const cursor = await this.find(...arguments);
        const arrayP = await cursor.toArray();
        let result = arrayP;
        if (options.filterFunction)
            result = await options.filterFunction(result);
        return result;
    }
    async findSomeStream(query, options, format = storage_1.StreamFormats.strings) {
        // @ts-ignore
        const cursor = await this.find(...arguments);
        switch (format) {
            case storage_1.StreamFormats.records:
                return cursor.stream();
            case storage_1.StreamFormats.strings:
                return cursor.stream({
                    transform: rec => JSON.stringify(rec)
                });
            default:
                throw new Error('Stream formant not supported');
        }
    }
    async count(query, opts) {
        return this.collection.countDocuments(query, opts);
    }
    async findOne(query, projection) {
        if (projection)
            projection.push('_id', '_version');
        let some = await this.findSome(query, { limit: 1, projection });
        return some.length ? some[0] : null;
    }
    async load(opt, query) {
        let r = await bluebird_1.props({
            items: (opt ? this.findSome(query, {
                limit: opt.count,
                from: opt.from,
                projection: opt.projection,
                sort: opt.sort,
                filterFunction: opt.filterFunction
            }) : this.findSome(query)),
            totalFiltered: this.count(query || {}),
        });
        return Object.assign(r, { opts: opt, total: -1 });
    }
    /**
     * @param doc the record
     * @returns on success, the id of the new entry
     */
    async append(doc) {
        // @ts-ignore
        doc = Object.assign({ _id: doc.id || doc._id || this.createId(), '_version': 1, '_created': new Date() }, doc);
        try {
            const res = await this.collection.insertOne(doc);
            return res.insertedId.toString();
        }
        catch (e) {
            if (e.code === 11000)
                throw new storage_1.DuplicateKeyError(this.collection.collectionName);
            throw e;
        }
    }
    async deleteById(_id) {
        let result = await this.collection.deleteOne({ _id });
        return result.deletedCount === 1;
    }
    async deleteByQuery(query) {
        let result = await this.collection.deleteMany(query);
        return result.deletedCount;
    }
    ensureIndex(keys, options) {
        return this.collection.createIndex(keys, options);
    }
    async findOneAndModify(criteria, change) {
        return this.collection.findOneAndUpdate(criteria, { $set: change });
    }
    createId() {
        return short_uuid_1.generate();
    }
}
exports.MongoBasicCollection = MongoBasicCollection;
const DEFAULT_BATCH_SIZE = 100;
//# sourceMappingURL=mongo-basic-collection.js.map