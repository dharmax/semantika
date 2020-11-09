import {IReadOptions} from "../types";
import {BasicCollection} from "./basic-collection";

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
    getQueryFromReadOptions(collection: BasicCollection, theOptions: IReadOptions) {
        if (!theOptions.queryName)
            return {}
        const queryConstructor = this.queryDictionary[theOptions.queryName]
        if (!queryConstructor)
            throw new Error(`No such query constructor ${theOptions.queryName}`)
        return queryConstructor(theOptions.queryParams)
    }

}
