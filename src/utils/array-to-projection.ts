export function arrayToProjection(projection: string[], cursor) {
    projection = Array.from(new Set(projection))
    let p = projection.reduce((res, cur) => {
        cur && (res[cur] = 1)
        return res
    }, {})
    cursor.project(p)
}