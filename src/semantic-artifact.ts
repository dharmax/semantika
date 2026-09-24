import {SemanticPackage} from "./semantic-package.js";
import type {Tag, TagTaxonomy} from "./tag.js";
import {evaluateTagQuery, type TagQueryExpression} from "./tag-query.js";
import type {ICollection} from "./storage/storage.js";

/**
 * Validates that tags comply with abstract, exclusive, and antonym constraints.
 */
export function validateArtifactTags(
    taxonomy: TagTaxonomy | undefined,
    targetTagNames: string[],
    newTagNames?: string[]
): void {
    if (!taxonomy) return;

    // 1. Abstract tag check: abstract tags cannot be placed directly on artifacts
    if (newTagNames) {
        for (const name of newTagNames) {
            const tagObj = taxonomy.get(name);
            if (tagObj?.abstract) {
                throw new Error(
                    `Cannot tag artifact with abstract tag '${tagObj.name}'. Only its offspring may be placed on artifacts.`
                );
            }
        }
    }

    const tagSet = new Set(targetTagNames);
    const resolvedTags = new Map<string, Tag>();
    for (const name of tagSet) {
        const tagObj = taxonomy.get(name);
        if (tagObj) resolvedTags.set(tagObj.name, tagObj);
    }

    // 2. Exclusive tag check: at most one child/descendant of an exclusive tag can be present
    for (const tag of taxonomy.all()) {
        if (tag.exclusive) {
            const conflicting: string[] = [];
            for (const descendant of tag.descendants) {
                if (resolvedTags.has(descendant.name) || tagSet.has(descendant.name)) {
                    conflicting.push(descendant.name);
                }
            }
            if (conflicting.length > 1) {
                throw new Error(
                    `Exclusive tag violation: artifact cannot have multiple descendants of exclusive tag '${tag.name}' (found: ${conflicting.join(", ")}).`
                );
            }
        }
    }

    // 3. Antonym check: conflicting antonyms cannot both be placed on the artifact
    for (const tag of resolvedTags.values()) {
        for (const antonym of tag.antonyms) {
            if (resolvedTags.has(antonym.name) || tagSet.has(antonym.name)) {
                throw new Error(
                    `Antonym conflict: artifact cannot have both '${tag.name}' and its antonym '${antonym.name}'.`
                );
            }
        }
    }
}

export abstract class SemanticArtifact {
    private readonly _semanticPackageName: string;

    id: string;
    _tags: string[] = [];

    protected constructor(sp: SemanticPackage, public _id: string) {
        this._semanticPackageName = sp.name;
        this.id = _id;
    }

    get semanticPackage(): SemanticPackage {
        return SemanticPackage.findSemanticPackage(this._semanticPackageName);
    }

    abstract getCollection(): Promise<ICollection>;

    get tags(): Set<string> {
        return new Set(this._tags || []);
    }

    get tagList(): string[] {
        return this._tags || [];
    }

    /**
     * Checks if the artifact has the specified tag.
     * By default, taxonomy subsumption is enabled: if an artifact is tagged with X,
     * and X is a child/descendant of Y, then hasTag(Y) is true.
     * To require an exact tag match without subsumption, pass { exact: true }.
     */
    hasTag(tag: string | Tag, options?: { exact?: boolean; expandTaxonomy?: boolean }): boolean {
        const name = typeof tag === "string" ? tag : tag.name;
        if (this.tags.has(name)) return true;

        const shouldExpand = options?.exact ? false : (options?.expandTaxonomy ?? true);
        const taxonomy = this.semanticPackage?.tags;
        const tagObj = taxonomy?.get(name);

        if (tagObj && this.tags.has(tagObj.name)) return true;

        if (shouldExpand && tagObj) {
            for (const descendant of tagObj.descendants) {
                if (this.tags.has(descendant.name)) return true;
            }
        }
        return false;
    }

    matchesTagQuery(query: TagQueryExpression, options?: { exact?: boolean; expandTaxonomy?: boolean }): boolean {
        const shouldExpand = options?.exact ? false : (options?.expandTaxonomy ?? true);
        const taxonomy = shouldExpand ? this.semanticPackage?.tags : undefined;
        return evaluateTagQuery(this.tags, query, taxonomy);
    }

    async tag(...tags: (string | Tag)[]): Promise<this> {
        const taxonomy = this.semanticPackage?.tags;
        const names = tags.map(t => {
            if (typeof t !== "string") return t.name;
            const tagObj = taxonomy?.get(t);
            return tagObj ? tagObj.name : t;
        });
        const currentSet = this.tags;
        const newNames: string[] = [];
        for (const n of names) {
            if (!currentSet.has(n)) {
                newNames.push(n);
            }
        }
        if (newNames.length === 0) return this;

        const candidateList = [...this._tags, ...newNames];
        validateArtifactTags(this.semanticPackage?.tags, candidateList, newNames);

        for (const n of newNames) {
            currentSet.add(n);
        }
        this._tags = Array.from(currentSet);

        const col = await this.getCollection();
        if (col) {
            const version = (this as any)._version;
            if (version !== undefined) {
                await col.updateDocument(this.id, { _tags: this._tags }, version);
                (this as any)._version = version + 1;
            } else {
                await col.updateDocumentUnsafe(this.id, { _tags: this._tags });
            }
        }
        return this;
    }

    async untag(...tags: (string | Tag)[]): Promise<this> {
        const taxonomy = this.semanticPackage?.tags;
        const currentSet = this.tags;
        let modified = false;
        for (const t of tags) {
            const rawName = typeof t === "string" ? t : t.name;
            const tagObj = taxonomy?.get(rawName);
            const canonicalName = tagObj ? tagObj.name : rawName;
            if (currentSet.delete(canonicalName)) modified = true;
            if (currentSet.delete(rawName)) modified = true;
        }
        if (!modified) return this;
        this._tags = Array.from(currentSet);

        const col = await this.getCollection();
        if (col) {
            const version = (this as any)._version;
            if (version !== undefined) {
                await col.updateDocument(this.id, { _tags: this._tags }, version);
                (this as any)._version = version + 1;
            } else {
                await col.updateDocumentUnsafe(this.id, { _tags: this._tags });
            }
        }
        return this;
    }
}