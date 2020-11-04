import {IReadOptions} from "../types";
import {Collection} from "./collection";

/**
 * You can use this class to assigned complex named queries. The query result is typically passed to the collection
 * load method.
 */
export class QueryExtender {

    constructor(private queryDictionary: {[queryName:string]:(queryParams: Object) => Object}) {
    }

    /**
     *
     * @param collection the target collection
     * @param theOptions options
     * @return the query
     */
    getQueryFromReadOptions(collection: Collection, theOptions: IReadOptions) {
        if (!theOptions.queryName)
            return {}
        const queryConstructor = this.queryDictionary[theOptions.queryName]
        if (!queryConstructor)
            throw new Error(`No such query constructor ${theOptions.queryName}`)
        return queryConstructor(theOptions.queryParams)
    }

}
