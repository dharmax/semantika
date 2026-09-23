import type {SemanticPackage} from "./semantic-package.js";
import type {AbstractEntity} from "./abstract-entity.js";
import type {Predicate} from "./predicate.js";
import type {SemanticArtifact} from "./semantic-artifact.js";

export interface TagOptions {
    description?: string;
    metadata?: Record<string, any>;
    embedding?: number[];
    parents?: (Tag | string)[];
}

/**
 * First-class Tag representation supporting DAG taxonomy, artifact navigation, and vector search.
 */
export class Tag {
    readonly name: string;
    description?: string;
    metadata?: Record<string, any>;
    embedding?: number[];

    readonly parents = new Set<Tag>();
    readonly children = new Set<Tag>();

    constructor(
        readonly semanticPackage: SemanticPackage,
        name: string,
        options: TagOptions = {}
    ) {
        this.name = name;
        this.description = options.description;
        this.metadata = options.metadata;
        this.embedding = options.embedding;
    }

    get id(): string {
        return this.name;
    }

    addParent(parent: Tag): this {
        if (parent === this) {
            throw new Error(`Cannot add tag '${this.name}' as parent of itself.`);
        }
        if (this.isAncestorOf(parent)) {
            throw new Error(`Cycle detected: cannot add descendant '${parent.name}' as parent of '${this.name}'.`);
        }
        this.parents.add(parent);
        parent.children.add(this);
        return this;
    }

    removeParent(parent: Tag): this {
        this.parents.delete(parent);
        parent.children.delete(this);
        return this;
    }

    get ancestors(): Set<Tag> {
        const visited = new Set<Tag>();
        const queue = [...this.parents];
        while (queue.length > 0) {
            const current = queue.shift()!;
            if (!visited.has(current)) {
                visited.add(current);
                queue.push(...current.parents);
            }
        }
        return visited;
    }

    get descendants(): Set<Tag> {
        const visited = new Set<Tag>();
        const queue = [...this.children];
        while (queue.length > 0) {
            const current = queue.shift()!;
            if (!visited.has(current)) {
                visited.add(current);
                queue.push(...current.children);
            }
        }
        return visited;
    }

    isDescendantOf(parent: Tag | string): boolean {
        const parentName = typeof parent === "string" ? parent : parent.name;
        for (const ancestor of this.ancestors) {
            if (ancestor.name === parentName) return true;
        }
        return false;
    }

    isAncestorOf(child: Tag | string): boolean {
        const childName = typeof child === "string" ? child : child.name;
        for (const descendant of this.descendants) {
            if (descendant.name === childName) return true;
        }
        return false;
    }

    async entities<T extends AbstractEntity = AbstractEntity>(options?: {
        includeDescendants?: boolean;
        entityType?: string;
    }): Promise<T[]> {
        return this.semanticPackage.findEntitiesByTag<T>(this, options);
    }

    async predicates(options?: {
        includeDescendants?: boolean;
        predicateName?: string;
    }): Promise<Predicate[]> {
        return this.semanticPackage.findPredicatesByTag(this, options);
    }

    async artifacts(options?: {
        includeDescendants?: boolean;
    }): Promise<SemanticArtifact[]> {
        const [e, p] = await Promise.all([this.entities(options), this.predicates(options)]);
        return [...e, ...p];
    }

    async count(options?: { includeDescendants?: boolean }): Promise<number> {
        const items = await this.artifacts(options);
        return items.length;
    }

    async similar(options?: { limit?: number; minScore?: number }): Promise<Array<{ tag: Tag; score: number }>> {
        return this.semanticPackage.findSimilarTags(this, options);
    }

    toJSON() {
        return {
            name: this.name,
            description: this.description,
            parents: Array.from(this.parents).map(p => p.name),
            children: Array.from(this.children).map(c => c.name),
            metadata: this.metadata
        };
    }
}

/**
 * Multi-parent Directed Acyclic Graph (DAG) Tag Taxonomy manager.
 */
export class TagTaxonomy {
    private readonly tagMap = new Map<string, Tag>();

    constructor(readonly semanticPackage: SemanticPackage) {}

    tag(name: string, options: TagOptions = {}): Tag {
        let tag = this.tagMap.get(name);
        if (!tag) {
            tag = new Tag(this.semanticPackage, name, options);
            this.tagMap.set(name, tag);
        } else {
            if (options.description) tag.description = options.description;
            if (options.metadata) tag.metadata = { ...tag.metadata, ...options.metadata };
            if (options.embedding) tag.embedding = options.embedding;
        }

        if (options.parents) {
            for (const parent of options.parents) {
                const parentTag = typeof parent === "string" ? this.tag(parent) : parent;
                tag.addParent(parentTag);
            }
        }

        return tag;
    }

    get(name: string): Tag | undefined {
        return this.tagMap.get(name);
    }

    has(name: string): boolean {
        return this.tagMap.has(name);
    }

    all(): Tag[] {
        return Array.from(this.tagMap.values());
    }

    delete(name: string): boolean {
        const tag = this.tagMap.get(name);
        if (!tag) return false;

        for (const parent of tag.parents) {
            parent.children.delete(tag);
        }
        for (const child of tag.children) {
            child.parents.delete(tag);
        }
        return this.tagMap.delete(name);
    }

    /**
     * Loads a nested taxonomy tree into the multi-parent DAG.
     * Example:
     * taxonomy.loadTaxonomy({
     *   ai: {
     *     ml: { deepLearning: {} },
     *     nlp: { llm: {} }
     *   }
     * });
     */
    loadTaxonomy(tree: Record<string, any>, parentTag?: Tag): this {
        for (const [key, value] of Object.entries(tree)) {
            const currentTag = this.tag(key);
            if (parentTag) {
                currentTag.addParent(parentTag);
            }
            if (value && typeof value === "object" && !Array.isArray(value)) {
                this.loadTaxonomy(value, currentTag);
            }
        }
        return this;
    }
}
