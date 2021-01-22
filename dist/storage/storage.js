"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamFormats = exports.StandardFields = exports.DuplicateKeyError = exports.AbstractStorage = exports.Cursor = void 0;
var mongodb_1 = require("mongodb");
Object.defineProperty(exports, "Cursor", { enumerable: true, get: function () { return mongodb_1.Cursor; } });
class AbstractStorage {
    createCustomQuery(queryName, queryParameters) {
        if (!queryName)
            return null;
        const queryConstructor = this.queryDictionary[queryName];
        if (!queryConstructor)
            throw new Error(`No such query constructor ${queryName}`);
        return queryConstructor(queryParameters);
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
//# sourceMappingURL=storage.js.map