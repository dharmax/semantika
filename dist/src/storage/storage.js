"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.StreamFormats = exports.StandardFields = exports.DuplicateKeyError = exports.AbstractStorage = exports.Cursor = void 0;
var mongodb_1 = require("mongodb");
Object.defineProperty(exports, "Cursor", {
    enumerable: true, get: function () {
        return mongodb_1.Cursor;
    }
});
class AbstractStorage {
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