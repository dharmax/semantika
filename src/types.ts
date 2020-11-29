
export interface IReadOptions {
    from: number
    count: number
    /**means, it returns just the peer entity without a predicate. Useful.*/
    entityOnly?: boolean
    /** if you want to use a query from the query dictionary you defined*/
    queryName?: string
    /** parameters for the query you use*/
    queryParams?: Object
    /** filtering by function*/
    filterFunction?: FilterFunction
    sort?: SortSpec
    projection?: string[]
    requestNumber?: number // created automatically
}


export type SortSpec = { [fieldName: string]: 1 | -1 }

export interface IReadResult {
    error?: string
    items: any[]
    total?: number
    totalFiltered: number
    /**the read options to which this result was provided*/
    opts?: IReadOptions
}
export type FilterFunction = (items: any[]) => Promise<any[]>

/**
 * note that it is possible to specify peerType with empty array as the projection. It can be useful to filter the predicates by the peer type that way!
 */
export interface IFindPredicatesOptions {
    /** if specified, only peers with that id will be returned      */
    peerId?: string,
    /** filter by peer type*/
    peerType?: string | string[],
    /** if specified, read the peer fields specified here and put them under the "peer" member*/
    projection?: string[],
}

