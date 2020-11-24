"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.QueryExtender = void 0;

/**
 * You can use this class to assigned complex named queries. The query result is typically passed to the collection
 * load method.
 */
class QueryExtender {
    constructor(queryDictionary) {
        this.queryDictionary = queryDictionary;
    }

    /**
     *
     * @param collection the target collection
     * @param theOptions options
     * @return the query
     */
    getQueryFromReadOptions(collection, theOptions) {
        if (!theOptions.queryName)
            return {};
        const queryConstructor = this.queryDictionary[theOptions.queryName];
        if (!queryConstructor)
            throw new Error(`No such query constructor ${theOptions.queryName}`);
        return queryConstructor(theOptions.queryParams);
    }
}

exports.QueryExtender = QueryExtender;
//# sourceMappingURL=query-extender.js.map