import type {SemanticPackage} from "./semantic-package.js";
import type {AbstractEntity} from "./abstract-entity.js";
import type {Predicate} from "./predicate.js";
import type {SemanticArtifact} from "./semantic-artifact.js";

export interface TagOptions {
    description?: string;
    metadata?: Record<string, any>;
    embedding?: number[];
    parent?: Tag | string;
    parents?: (Tag | string)[];
    abstract?: boolean;
    exclusive?: boolean;
    displayName?: string | Record<string, string>;
    synonym?: string;
    synonyms?: Record<string, string[]> | string[];
    antonym?: Tag | string;
    antonyms?: (Tag | string)[];
}

/**
 * First-class Tag representation supporting DAG taxonomy, multi-language synonyms,
 * antonyms, abstract tags, exclusive groups, artifact navigation, and vector search.
 */
export class Tag {
    readonly name: string;
    description?: string;
    metadata?: Record<string, any>;
    embedding?: number[];
    abstract: boolean = false;
    exclusive: boolean = false;

    displayNames: Record<string, string> = {};
    synonyms: Record<string, Set<string>> = {};

    readonly parents = new Set<Tag>();
    readonly children = new Set<Tag>();
    readonly antonyms = new Set<Tag>();

    constructor(
        readonly semanticPackage: SemanticPackage,
        name: string,
        options: TagOptions = {}
    ) {
        this.name = name;
        this.description = options.description;
        this.metadata = options.metadata;
        this.embedding = options.embedding;
        this.abstract = options.abstract ?? false;
        this.exclusive = options.exclusive ?? false;

        if (options.displayName) {
            if (typeof options.displayName === "string") {
                this.displayNames["en"] = options.displayName;
            } else {
                this.displayNames = { ...options.displayName };
            }
        }

        if (options.synonym) {
            this.addSynonym(options.synonym, "en");
        }

        if (options.synonyms) {
            if (Array.isArray(options.synonyms)) {
                this.synonyms["en"] = new Set(options.synonyms);
            } else {
                for (const [lang, syns] of Object.entries(options.synonyms)) {
                    this.synonyms[lang] = new Set(syns);
                }
            }
        }
    }

    get id(): string {
        return this.name;
    }

    /**
     * Default display name in English, or the first configured display name, or the canonical tag name.
     */
    get displayName(): string {
        return this.displayNames["en"] || Object.values(this.displayNames)[0] || this.name;
    }

    getDisplayName(lang = "en"): string {
        return this.displayNames[lang] || this.displayName;
    }

    setDisplayName(name: string, lang = "en"): this {
        this.displayNames[lang] = name;
        return this;
    }

    addSynonym(synonym: string, lang = "en"): this {
        if (!this.synonyms[lang]) {
            this.synonyms[lang] = new Set();
        }
        this.synonyms[lang].add(synonym);
        return this;
    }

    removeSynonym(synonym: string, lang = "en"): this {
        this.synonyms[lang]?.delete(synonym);
        return this;
    }

    getSynonyms(lang = "en"): string[] {
        return Array.from(this.synonyms[lang] || []);
    }

    hasSynonym(synonym: string, lang?: string): boolean {
        const query = synonym.toLowerCase();
        if (lang) {
            const set = this.synonyms[lang];
            if (!set) return false;
            for (const s of set) {
                if (s.toLowerCase() === query) return true;
            }
            return false;
        }

        for (const set of Object.values(this.synonyms)) {
            for (const s of set) {
                if (s.toLowerCase() === query) return true;
            }
        }
        return false;
    }

    get synonym(): string | undefined {
        return this.getSynonyms("en")[0];
    }

    set synonym(val: string | undefined) {
        if (!val) {
            delete this.synonyms["en"];
            return;
        }
        this.synonyms["en"] = new Set([val]);
    }

    get antonym(): Tag | undefined {
        return this.antonyms.values().next().value;
    }

    set antonym(antonym: Tag | string | undefined) {
        if (!antonym) {
            for (const a of [...this.antonyms]) {
                this.removeAntonym(a);
            }
            return;
        }
        const antonymTag = typeof antonym === "string" ? this.semanticPackage.tags.tag(antonym) : antonym;
        if (this.antonyms.has(antonymTag) && this.antonyms.size === 1) return;
        for (const a of [...this.antonyms]) {
            this.removeAntonym(a);
        }
        this.addAntonym(antonymTag);
    }

    addAntonym(antonym: Tag | string): this {
        const antonymTag = typeof antonym === "string" ? this.semanticPackage.tags.tag(antonym) : antonym;
        if (antonymTag === this) {
            throw new Error(`Cannot add tag '${this.name}' as antonym of itself.`);
        }
        this.antonyms.add(antonymTag);
        antonymTag.antonyms.add(this);
        return this;
    }

    removeAntonym(antonym: Tag | string): this {
        const antonymName = typeof antonym === "string" ? antonym : antonym.name;
        for (const a of this.antonyms) {
            if (a.name === antonymName) {
                this.antonyms.delete(a);
                a.antonyms.delete(this);
                break;
            }
        }
        return this;
    }

    isAntonymOf(other: Tag | string): boolean {
        const otherName = typeof other === "string" ? other : other.name;
        for (const a of this.antonyms) {
            if (a.name === otherName) return true;
        }
        return false;
    }

    get parent(): Tag | undefined {
        return this.parents.values().next().value;
    }

    set parent(parent: Tag | string | undefined) {
        if (!parent) {
            for (const p of [...this.parents]) {
                this.removeParent(p);
            }
            return;
        }
        const parentTag = typeof parent === "string" ? this.semanticPackage.tags.tag(parent) : parent;
        if (this.parents.has(parentTag) && this.parents.size === 1) return;
        for (const p of [...this.parents]) {
            this.removeParent(p);
        }
        this.addParent(parentTag);
    }

    addParent(parent: Tag | string): this {
        const parentTag = typeof parent === "string" ? this.semanticPackage.tags.tag(parent) : parent;
        if (parentTag === this) {
            throw new Error(`Cannot add tag '${this.name}' as parent of itself.`);
        }
        if (this.isAncestorOf(parentTag)) {
            throw new Error(`Cycle detected: cannot add descendant '${parentTag.name}' as parent of '${this.name}'.`);
        }
        this.parents.add(parentTag);
        parentTag.children.add(this);
        return this;
    }

    removeParent(parent: Tag | string): this {
        const parentName = typeof parent === "string" ? parent : parent.name;
        for (const p of this.parents) {
            if (p.name === parentName) {
                this.parents.delete(p);
                p.children.delete(this);
                break;
            }
        }
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
            displayName: this.displayName,
            displayNames: this.displayNames,
            description: this.description,
            abstract: this.abstract,
            exclusive: this.exclusive,
            synonyms: Object.fromEntries(
                Object.entries(this.synonyms).map(([lang, set]) => [lang, Array.from(set)])
            ),
            antonyms: Array.from(this.antonyms).map(a => a.name),
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
            if (options.description !== undefined) tag.description = options.description;
            if (options.metadata !== undefined) tag.metadata = { ...tag.metadata, ...options.metadata };
            if (options.embedding !== undefined) tag.embedding = options.embedding;
            if (options.abstract !== undefined) tag.abstract = options.abstract;
            if (options.exclusive !== undefined) tag.exclusive = options.exclusive;
            if (options.displayName) {
                if (typeof options.displayName === "string") {
                    tag.displayNames["en"] = options.displayName;
                } else {
                    Object.assign(tag.displayNames, options.displayName);
                }
            }
            if (options.synonym) {
                tag.addSynonym(options.synonym, "en");
            }
            if (options.synonyms) {
                if (Array.isArray(options.synonyms)) {
                    for (const s of options.synonyms) tag.addSynonym(s, "en");
                } else {
                    for (const [lang, syns] of Object.entries(options.synonyms)) {
                        for (const s of syns) tag.addSynonym(s, lang);
                    }
                }
            }
        }

        if (options.parent) {
            const parentTag = typeof options.parent === "string" ? this.tag(options.parent) : options.parent;
            tag.addParent(parentTag);
        }

        if (options.parents) {
            for (const parent of options.parents) {
                const parentTag = typeof parent === "string" ? this.tag(parent) : parent;
                tag.addParent(parentTag);
            }
        }

        if (options.antonym) {
            tag.addAntonym(options.antonym);
        }

        if (options.antonyms) {
            for (const antonym of options.antonyms) {
                tag.addAntonym(antonym);
            }
        }

        return tag;
    }

    get(nameOrSynonym: string): Tag | undefined {
        const direct = this.tagMap.get(nameOrSynonym);
        if (direct) return direct;

        const normalized = nameOrSynonym.toLowerCase();
        for (const tag of this.tagMap.values()) {
            if (tag.name.toLowerCase() === normalized) return tag;
            if (tag.displayName.toLowerCase() === normalized) return tag;
            if (tag.hasSynonym(nameOrSynonym)) return tag;
        }
        return undefined;
    }

    has(nameOrSynonym: string): boolean {
        return this.get(nameOrSynonym) !== undefined;
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
        for (const antonym of tag.antonyms) {
            antonym.antonyms.delete(tag);
        }
        return this.tagMap.delete(name);
    }

    /**
     * Loads a nested taxonomy tree into the multi-parent DAG.
     * Supports metadata properties like $abstract, $exclusive, $synonyms, $displayName.
     * Example:
     * taxonomy.loadTaxonomy({
     *   Status: {
     *     $exclusive: true,
     *     $abstract: true,
     *     Draft: {},
     *     Published: {}
     *   }
     * });
     */
    loadTaxonomy(tree: Record<string, any>, parentTag?: Tag): this {
        for (const [key, value] of Object.entries(tree)) {
            if (key.startsWith("$")) continue;

            const opts: TagOptions = {};
            if (value && typeof value === "object" && !Array.isArray(value)) {
                if (value.$abstract !== undefined) opts.abstract = value.$abstract;
                if (value.$exclusive !== undefined) opts.exclusive = value.$exclusive;
                if (value.$displayName !== undefined) opts.displayName = value.$displayName;
                if (value.$synonym !== undefined) opts.synonym = value.$synonym;
                if (value.$synonyms !== undefined) opts.synonyms = value.$synonyms;
                if (value.$parent !== undefined) opts.parent = value.$parent;
                if (value.$parents !== undefined) opts.parents = value.$parents;
                if (value.$antonym !== undefined) opts.antonym = value.$antonym;
                if (value.$antonyms !== undefined) opts.antonyms = value.$antonyms;
                if (value.$description !== undefined) opts.description = value.$description;
            }

            const currentTag = this.tag(key, opts);
            if (parentTag) {
                currentTag.addParent(parentTag);
            }
            if (value && typeof value === "object" && !Array.isArray(value)) {
                this.loadTaxonomy(value, currentTag);
            }
        }
        return this;
    }

    clear(): void {
        this.tagMap.clear();
    }

    toJSON(): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [name, tag] of this.tagMap.entries()) {
            result[name] = tag.toJSON();
        }
        return result;
    }
}
