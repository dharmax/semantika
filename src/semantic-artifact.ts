import {SemanticPackage} from "./semantic-package.js";
import type {Tag} from "./tag.js";
import {evaluateTagQuery, type TagQueryExpression} from "./tag-query.js";
import type {ICollection} from "./storage/storage.js";

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

    hasTag(tag: string | Tag, options?: { expandTaxonomy?: boolean }): boolean {
        const name = typeof tag === "string" ? tag : tag.name;
        if (this.tags.has(name)) return true;
        if (options?.expandTaxonomy) {
            const taxonomy = this.semanticPackage?.tags;
            const tagObj = taxonomy?.get(name);
            if (tagObj) {
                for (const descendant of tagObj.descendants) {
                    if (this.tags.has(descendant.name)) return true;
                }
            }
        }
        return false;
    }

    matchesTagQuery(query: TagQueryExpression, options?: { expandTaxonomy?: boolean }): boolean {
        const taxonomy = options?.expandTaxonomy ? this.semanticPackage?.tags : undefined;
        return evaluateTagQuery(this.tags, query, taxonomy);
    }

    async tag(...tags: (string | Tag)[]): Promise<this> {
        const names = tags.map(t => (typeof t === "string" ? t : t.name));
        const currentSet = this.tags;
        let modified = false;
        for (const n of names) {
            if (!currentSet.has(n)) {
                currentSet.add(n);
                modified = true;
            }
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

    async untag(...tags: (string | Tag)[]): Promise<this> {
        const names = new Set(tags.map(t => (typeof t === "string" ? t : t.name)));
        const currentSet = this.tags;
        let modified = false;
        for (const n of names) {
            if (currentSet.delete(n)) {
                modified = true;
            }
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