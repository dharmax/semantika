import type {Tag, TagTaxonomy} from "./tag.js";

/**
 * Boolean tag query expression supporting existence, absence, and composite operations.
 */
export type TagQueryExpression =
    | string
    | Tag
    | { has: string | Tag }
    | { not: TagQueryExpression }
    | { and: TagQueryExpression[] }
    | { or: TagQueryExpression[] }
    | { xor: TagQueryExpression[] };

/**
 * Evaluates whether a set of tags satisfies a TagQueryExpression.
 * Supports optional taxonomy expansion (subsumption) through TagTaxonomy.
 */
export function evaluateTagQuery(
    tags: Set<string> | string[],
    query: TagQueryExpression,
    taxonomy?: TagTaxonomy
): boolean {
    const tagSet = tags instanceof Set ? tags : new Set(tags);

    if (typeof query === "string") {
        return checkTag(query, tagSet, taxonomy);
    }

    if (typeof query === "object" && query !== null) {
        if ("name" in query && "semanticPackage" in query && typeof (query as any).name === "string") {
            return checkTag((query as Tag).name, tagSet, taxonomy);
        }

        if ("has" in query) {
            const hasTarget = typeof query.has === "string" ? query.has : (query.has as Tag).name;
            return checkTag(hasTarget, tagSet, taxonomy);
        }

        if ("not" in query) {
            return !evaluateTagQuery(tagSet, query.not, taxonomy);
        }

        if ("and" in query) {
            if (!Array.isArray(query.and) || query.and.length === 0) return true;
            return query.and.every(sub => evaluateTagQuery(tagSet, sub, taxonomy));
        }

        if ("or" in query) {
            if (!Array.isArray(query.or) || query.or.length === 0) return false;
            return query.or.some(sub => evaluateTagQuery(tagSet, sub, taxonomy));
        }

        if ("xor" in query) {
            if (!Array.isArray(query.xor) || query.xor.length === 0) return false;
            // Strict mutual exclusivity: exactly one sub-expression must evaluate to true
            let matched = 0;
            for (const sub of query.xor) {
                if (evaluateTagQuery(tagSet, sub, taxonomy)) {
                    matched++;
                    if (matched > 1) return false;
                }
            }
            return matched === 1;
        }
    }

    return false;
}

function checkTag(name: string, tagSet: Set<string>, taxonomy?: TagTaxonomy): boolean {
    if (tagSet.has(name)) return true;
    if (taxonomy) {
        const tag = taxonomy.get(name);
        if (tag) {
            if (tagSet.has(tag.name)) return true;
            for (const child of tag.descendants) {
                if (tagSet.has(child.name)) return true;
            }
        }
    }
    return false;
}
