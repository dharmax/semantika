"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoStore = void 0;
const mongodb_1 = require("mongodb");
const storage_1 = require("../storage");
const mongo_basic_collection_1 = require("./mongo-basic-collection");
const entities_collection_1 = require("../../entities-collection");
const predicates_collection_1 = require("../../predicates-collection");
class MongoStore extends storage_1.AbstractStorage {
    constructor(uri) {
        super();
        this.collections = {};
        this.dbClient = new mongodb_1.MongoClient(uri, { useUnifiedTopology: true, useNewUrlParser: true });
    }
    async connect() {
        return this.dbClient.connect();
    }
    async startSession(options) {
        return this.dbClient.startSession(options);
    }
    async purgeDatabase() {
        this.collections = {};
        return await this.dbClient.db().dropDatabase();
    }
    async close() {
        return await this.dbClient.close();
    }
    async getPhysicalCollection(name) {
        return this.dbClient.db().collection(name);
    }
    makeEntityCollection(physicalCollection, eDcr, initFunc) {
        const c = new entities_collection_1.EntityCollection(eDcr, this.makeBasicCollection(physicalCollection));
        initFunc && initFunc(c);
        return c;
    }
    makePredicateCollection(semanticPackage, physicalCollection) {
        return new predicates_collection_1.PredicateCollection(semanticPackage, this.makeBasicCollection(physicalCollection));
    }
    makeBasicCollection(physicalCollection, initFunc) {
        const c = new mongo_basic_collection_1.MongoBasicCollection(physicalCollection);
        initFunc && initFunc(c);
        return c;
    }
}
exports.MongoStore = MongoStore;
//# sourceMappingURL=mongo-store.js.map