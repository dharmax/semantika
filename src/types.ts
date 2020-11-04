
export interface IReadOptions {
    from: number
    count: number
    entityOnly?: boolean
    queryName?: string
    queryParams?: Object
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
    opts?: IReadOptions
}
export type FilterFunction = (items: any[]) => Promise<any[]>

/**
 * note that it is possible to specify peerType with empty array as the projection. It can be useful to filter the predicates by the peer type that way!
 */
export interface IFindPredicatesOptions {
    peerId?: string,
    peerType?: string | string[],
    projection?: string[],
}

