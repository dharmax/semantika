"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.PredicateCollection = exports.EntityCollection = exports.ArtifactCollection = void 0;
const storage_1 = require("./storage");
const constants_1 = require("../utils/constants");

class ArtifactCollection {
    constructor(basicCollection) {
        this.basicCollection = basicCollection;
    }

    append(doc) {
        return this.basicCollection.append(doc);
    }

    count(query, opts) {
        return this.basicCollection.count(query, opts);
    }

    createId() {
        return this.basicCollection.createId();
    }

    deleteById(_id) {
        return this.basicCollection.deleteById(_id);
    }

    deleteByQuery(query) {
        return this.basicCollection.deleteByQuery(query);
    }

    distinct(field, query, options) {
        return this.basicCollection.distinct(field, query, options);
    }

    ensureIndex(keys, options) {
        return this.basicCollection.ensureIndex(keys, options);
    }

    find(query, options) {
        return this.basicCollection.find(query, options);
    }

    findById(_id, projection) {
        // @ts-ignore
        return this.basicCollection.findById(...arguments);
    }

    findGenerator(query, options) {
        // @ts-ignore
        return this.basicCollection.findGenerator(...arguments);
    }

    findOne(query, projection) {
        // @ts-ignore
        return this.basicCollection.findOne(...arguments);
    }

    findOneAndModify(criteria, change) {
        // @ts-ignore
        return this.basicCollection.findOneAndModify(...arguments);
    }

    findSome(query, options) {
        // @ts-ignore
        return this.basicCollection.findSome(...arguments);
    }

    findSomeStream(query, options, format) {
        // @ts-ignore
        return this.basicCollection.findSomeStream(...arguments);
    }

    load(opt, query) {
        // @ts-ignore
        return this.basicCollection.load(...arguments);
    }

    updateDocument(_id, fields, version, rawOperations) {
        // @ts-ignore
        return this.basicCollection.updateDocument(...arguments);
    }

    updateDocumentUnsafe(_id, fields) {
        // @ts-ignore
        return this.basicCollection.updateDocumentUnsafe(...arguments);
    }

    watch(callback, ...args) {
        // @ts-ignore
        return this.basicCollection.watch(...arguments);
    }
}

exports.ArtifactCollection = ArtifactCollection;

class EntityCollection extends ArtifactCollection {
    constructor(entityDcr, collection) {
        super(collection);
        this.entityDcr = entityDcr;
    }

    createId() {
        return `${this.entityDcr.name}${constants_1.ID_SEPARATOR}${this.basicCollection.createId()}`;
    }

    get semanticPackage() {
        return this.entityDcr.semanticPackage;
    }
    async findSomeStream(query, options, format = storage_1.StreamFormats.strings) {
        if (format !== storage_1.StreamFormats.entities)
            return this.basicCollection.findSomeStream(query, options, format);
        // @ts-ignore
        const cursor = await this.basicCollection.find(...arguments);
        return cursor.stream({
            transform: rec => {
                return this.semanticPackage.makeEntity(this.entityDcr, rec._id, rec);
            }
        });
    }
    async findSome(query, options = {}) {
        // @ts-ignore
        const arrayP = await super.findSome(...arguments);
        let result = arrayP.map(rec => this.semanticPackage.makeEntity(this.entityDcr, rec['_id'], rec));
        if (options.filterFunction)
            result = await options.filterFunction(result);
        return result;
    }

    async findById(_id, projection) {
        const record = await this.basicCollection.findById(_id, projection);
        if (!record)
            return null;
        // @ts-ignore
        return this.semanticPackage.makeEntity(this.entityDcr, record._id, record);
    }

    async* findGenerator(query, options = {}) {
        const cursor = await this.basicCollection.find(query, options);
        while (await cursor.hasNext()) {
            const record = await cursor.next();
            const entity = this.semanticPackage.makeEntity(undefined, undefined, record);
            yield entity;
        }
    }
}
exports.EntityCollection = EntityCollection;

class PredicateCollection extends ArtifactCollection {
    constructor(semanticPackage, collection) {
        super(collection);
        this.semanticPackage = semanticPackage;
    }
}
exports.PredicateCollection = PredicateCollection;
//# sourceMappingURL=semantic-collections.js.map