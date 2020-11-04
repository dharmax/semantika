export type ProjectionPredicateItem = {
    pName: string
    in: boolean
    limit: number
    projection: ProjectionItem[]
}

export type ProjectionItem = string | ProjectionPredicateItem
