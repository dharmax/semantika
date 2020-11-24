"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.PredicateCollection = exports.EntityCollection = void 0;
const storage_1 = require("./storage");
const basic_collection_1 = require("./basic-collection");
const constants_1 = require("../utils/constants");

class EntityCollection extends basic_collection_1.BasicCollection {
    constructor(entityDcr, collection) {
        super(collection);
        this.entityDcr = entityDcr;
    }

    createId() {
        return `${this.entityDcr.name}${constants_1.ID_SEPARATOR}${super.createId()}`;
    }

    get semanticPackage() {
        return this.entityDcr.semanticPackage;
    }

    async findSomeStream(query, options, format = storage_1.StreamFormats.strings) {
        if (format !== storage_1.StreamFormats.entities)
            return super.findSomeStream(query, options, format);
        // @ts-ignore
        const cursor = await this.find(...arguments);
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
        const record = await super.findById(_id, projection);
        if (!record)
            return null;
        // @ts-ignore
        return this.semanticPackage.makeEntity(this.entityDcr, record._id, record);
    }

    async* findGenerator(query, options = {}) {
        const cursor = await this.find(query, options);
        while (await cursor.hasNext()) {
            const record = await cursor.next();
            const entity = this.semanticPackage.makeEntity(undefined, undefined, record);
            yield entity;
        }
    }
}

exports.EntityCollection = EntityCollection;

class PredicateCollection extends basic_collection_1.BasicCollection {
    constructor(semanticPackage, collection) {
        super(collection);
        this.semanticPackage = semanticPackage;
    }
}

exports.PredicateCollection = PredicateCollection;
//# sourceMappingURL=semantic-collections.js.map