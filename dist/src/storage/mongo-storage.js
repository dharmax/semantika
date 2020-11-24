"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.MongoStorage = void 0;
const mongodb_1 = require("mongodb");
const storage_1 = require("./storage");
const semantic_collections_1 = require("./semantic-collections");

class MongoStorage extends storage_1.AbstractStorage {
    constructor(uri) {
        super();
        this.collections = {};
        this.dbClient = new mongodb_1.MongoClient(uri);
    }

    async connect() {
        return this.dbClient.connect();
    }

    setQueryDictionary(dictionary) {
        this.queryDictionary = dictionary;
    }

    async startSession(options) {
        return this.dbClient.startSession(options);
    }

    async purgeDatabase() {
        this.collections = {};
        return await this.dbClient.db().dropDatabase();
    }

    async getPhysicalCollection(name) {
        return this.dbClient.db().collection(name);
    }

    async entityCollection(collectionName, initFunc, eDcr) {
        const c = await super.collectionForName(collectionName, false, initFunc, eDcr.clazz);
        return new semantic_collections_1.EntityCollection(eDcr, c);
    }

    async predicateCollection(semanticPackage, name) {
        const c = await super.collectionForName(name, true);
        return new semantic_collections_1.PredicateCollection(semanticPackage, c);
    }

    basicCollection(collectionName, initFunc) {
        return super.collectionForName(collectionName, false, initFunc);
    }
}

exports.MongoStorage = MongoStorage;
//# sourceMappingURL=mongo-storage.js.map