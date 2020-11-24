"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.StreamFormats = exports.StandardFields = exports.DuplicateKeyError = exports.AbstractStorage = exports.Cursor = void 0;
const mutex_1 = require("../utils/mutex");
var mongodb_1 = require("mongodb");
Object.defineProperty(exports, "Cursor", {
    enumerable: true, get: function () {
        return mongodb_1.Cursor;
    }
});

class AbstractStorage {
    async collectionForName(name, forPredicates = false, initFunc, clazz) {
        return new Promise((resolve, reject) => {
            collectionMutex.lock(() => {
                let col = collections[name];
                if (col) {
                    collectionMutex.release();
                    resolve(col);
                } else {
                    this.getPhysicalCollection(name, forPredicates).then(c => {
                        collections[name] = c;
                        initFunc && initFunc(c);
                        collectionMutex.release();
                        resolve(c);
                    }).catch((e) => {
                        collectionMutex.release();
                        reject(e);
                    });
                }
            });
        });
    }
}

exports.AbstractStorage = AbstractStorage;

class DuplicateKeyError extends Error {
    constructor(col) {
        super('duplicate key in collection  ' + col);
        this.col = col;
    } //
}

exports.DuplicateKeyError = DuplicateKeyError;
exports.StandardFields = ['_created', '_lastUpdate', '_version', '_parent'];
var StreamFormats;
(function (StreamFormats) {
    StreamFormats[StreamFormats["records"] = 0] = "records";
    StreamFormats[StreamFormats["entities"] = 1] = "entities";
    StreamFormats[StreamFormats["strings"] = 2] = "strings";
})(StreamFormats = exports.StreamFormats || (exports.StreamFormats = {}));
const collectionMutex = new mutex_1.Mutex();
const collections = {};
const predicateInitFunction = col => {
    col.ensureIndex({
        predicateName: 1,
        sourceId: 1,
        targetType: 1
    }, {});
    col.ensureIndex({
        predicateName: 1,
        targetId: 1,
        sourceType: 1
    }, {});
    col.ensureIndex({
        sourceId: 1,
        keys: 1
    }, {});
    col.ensureIndex({
        targetId: 1,
        keys: 1
    }, {});
    col.ensureIndex({
        sourceId: 1,
        targetId: 1,
        predicateName: 1
    }, {});
};
//# sourceMappingURL=storage.js.map