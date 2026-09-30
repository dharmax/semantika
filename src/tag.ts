import type {SemanticPackage} from "./semantic-package.js";
import type {AbstractEntity} from "./abstract-entity.js";
import type {Predicate} from "./predicate.js";
import type {SemanticArtifact} from "./semantic-artifact.js";
import type {ICollection} from "./storage/storage.js";
import type {IEmbeddingProvider, IVectorStore} from "./vector-store.js";

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

interface TagRecord {
    name: string;
    description?: string;
    metadata?: Record<string, any>;
    embedding?: number[];
    abstract?: boolean;
    exclusive?: boolean;
    displayNames?: Record<string, string>;
    synonyms?: Record<string, string[]>;
    parents?: string[];
    antonyms?: string[];
}

const normalize = (value: string) => value.trim().normalize("NFKC").toLowerCase();
const nameOf = (value: Tag | string) => typeof value === "string" ? value : value.name;

export class Tag {
    readonly parents = new Set<Tag>();
    readonly children = new Set<Tag>();
    readonly antonyms = new Set<Tag>();
    description?: string;
    metadata?: Record<string, any>;
    embedding?: number[];
    abstract = false;
    exclusive = false;
    displayNames: Record<string, string> = {};
    synonyms: Record<string, Set<string>> = {};

    constructor(readonly semanticPackage: SemanticPackage, readonly name: string) {}
    get id(): string { return this.name; }
    get displayName(): string { return this.displayNames.en || Object.values(this.displayNames)[0] || this.name; }
    getDisplayName(lang = "en"): string { return this.displayNames[lang] || this.displayName; }
    getSynonyms(lang = "en"): string[] { return [...(this.synonyms[lang] || [])]; }
    hasSynonym(value: string, lang?: string): boolean {
        const sets = lang ? [this.synonyms[lang]] : Object.values(this.synonyms);
        return sets.some(set => set && [...set].some(item => normalize(item) === normalize(value)));
    }
    get synonym(): string | undefined { return this.getSynonyms()[0]; }
    get parent(): Tag | undefined { return this.parents.values().next().value; }
    get antonym(): Tag | undefined { return this.antonyms.values().next().value; }

    async setDisplayName(value: string, lang = "en"): Promise<this> {
        await this.semanticPackage.tags.update(this.name, {displayName: {[lang]: value}});
        return this;
    }
    async addSynonym(value: string, lang = "en"): Promise<this> {
        await this.semanticPackage.tags.update(this.name, {
            synonyms: {[lang]: [...this.getSynonyms(lang), value]}
        });
        return this;
    }
    async removeSynonym(value: string, lang = "en"): Promise<this> {
        await this.semanticPackage.tags.update(this.name, {
            synonyms: {[lang]: this.getSynonyms(lang).filter(item => item !== value)}
        });
        return this;
    }
    async addParent(value: Tag | string): Promise<this> {
        await this.semanticPackage.tags.update(this.name, {parents: [...this.parents].map(p => p.name).concat(nameOf(value))});
        return this;
    }
    async removeParent(value: Tag | string): Promise<this> {
        await this.semanticPackage.tags.update(this.name, {parents: [...this.parents].map(p => p.name).filter(p => p !== nameOf(value))});
        return this;
    }
    async addAntonym(value: Tag | string): Promise<this> {
        await this.semanticPackage.tags.update(this.name, {antonyms: [...this.antonyms].map(a => a.name).concat(nameOf(value))});
        return this;
    }
    async removeAntonym(value: Tag | string): Promise<this> {
        await this.semanticPackage.tags.update(this.name, {antonyms: [...this.antonyms].map(a => a.name).filter(a => a !== nameOf(value))});
        return this;
    }
    isAntonymOf(value: Tag | string): boolean { return [...this.antonyms].some(a => a.name === nameOf(value)); }
    get ancestors(): Set<Tag> {
        const result = new Set<Tag>();
        const queue = [...this.parents];
        while (queue.length) {
            const item = queue.shift()!;
            if (!result.has(item)) { result.add(item); queue.push(...item.parents); }
        }
        return result;
    }
    get descendants(): Set<Tag> {
        const result = new Set<Tag>();
        const queue = [...this.children];
        while (queue.length) {
            const item = queue.shift()!;
            if (!result.has(item)) { result.add(item); queue.push(...item.children); }
        }
        return result;
    }
    isDescendantOf(value: Tag | string): boolean { return [...this.ancestors].some(a => a.name === nameOf(value)); }
    isAncestorOf(value: Tag | string): boolean { return [...this.descendants].some(a => a.name === nameOf(value)); }
    async entities<T extends AbstractEntity = AbstractEntity>(options?: {includeDescendants?: boolean; entityType?: string}): Promise<T[]> {
        return this.semanticPackage.findEntitiesByTag<T>(this, options);
    }
    async predicates(options?: {includeDescendants?: boolean; predicateName?: string}): Promise<Predicate[]> {
        return this.semanticPackage.findPredicatesByTag(this, options);
    }
    async artifacts(options?: {includeDescendants?: boolean}): Promise<SemanticArtifact[]> {
        const [entities, predicates] = await Promise.all([this.entities(options), this.predicates(options)]);
        return [...entities, ...predicates];
    }
    async count(options?: {includeDescendants?: boolean}): Promise<number> { return (await this.artifacts(options)).length; }
    async similar(options?: {limit?: number; minScore?: number}): Promise<Array<{tag: Tag; score: number}>> {
        return this.semanticPackage.findSimilarTags(this, options);
    }
    toJSON() {
        return {
            name: this.name, displayName: this.displayName, displayNames: this.displayNames,
            description: this.description, abstract: this.abstract, exclusive: this.exclusive,
            synonyms: Object.fromEntries(Object.entries(this.synonyms).map(([lang, values]) => [lang, [...values]])),
            antonyms: [...this.antonyms].map(a => a.name), parents: [...this.parents].map(p => p.name),
            children: [...this.children].map(c => c.name), metadata: this.metadata
        };
    }
}

export class TagTaxonomy {
    private readonly tagMap = new Map<string, Tag>();
    private aliases = new Map<string, string>();
    private records = new Map<string, TagRecord>();
    private collection?: ICollection;
    private hydration?: Promise<void>;
    private hydrated = false;
    private mutation: Promise<void> = Promise.resolve();
    private searchConfig?: {vectorStore: IVectorStore; embeddingProvider: IEmbeddingProvider};

    constructor(readonly semanticPackage: SemanticPackage) {}
    private assertReady(): void {
        if (!this.hydrated) throw new Error("Tag taxonomy is not ready; await sp.ready() first.");
    }
    ensureReady(): void { this.assertReady(); }
    async ready(): Promise<void> {
        if (!this.hydration) this.hydration = this.hydrate();
        return this.hydration;
    }
    private async hydrate(): Promise<void> {
        this.collection = await this.semanticPackage.basicCollection("_TagRecords");
        const rows = await this.collection.findSome<TagRecord & {_id: string}>({});
        for (const row of rows) {
            if (row._id !== row.name) throw new Error(`Corrupt tag record: id '${row._id}' does not match canonical name '${row.name}'.`);
        }
        const records = new Map(rows.map(row => [row.name, this.clean(row)]));
        this.validate(records);
        this.install(records);
        this.hydrated = true;
    }
    private clean(record: TagRecord): TagRecord {
        return {
            name: record.name, description: record.description, metadata: record.metadata,
            embedding: record.embedding, abstract: record.abstract, exclusive: record.exclusive,
            displayNames: record.displayNames || {}, synonyms: record.synonyms || {},
            parents: record.parents || [], antonyms: record.antonyms || []
        };
    }
    private fromOptions(name: string, options: TagOptions, old?: TagRecord): TagRecord {
        const record = this.clean(old || {name});
        if (options.description !== undefined) record.description = options.description;
        if (options.metadata !== undefined) record.metadata = {...record.metadata, ...options.metadata};
        if (options.embedding !== undefined) record.embedding = options.embedding;
        if (options.abstract !== undefined) record.abstract = options.abstract;
        if (options.exclusive !== undefined) record.exclusive = options.exclusive;
        if (options.displayName !== undefined) record.displayNames = {
            ...record.displayNames, ...(typeof options.displayName === "string" ? {en: options.displayName} : options.displayName)
        };
        if (options.synonym || options.synonyms) {
            const incoming = options.synonyms
                ? (Array.isArray(options.synonyms) ? {en: options.synonyms} : options.synonyms)
                : {en: [options.synonym!]};
            record.synonyms = {...record.synonyms};
            for (const [lang, values] of Object.entries(incoming)) {
                record.synonyms[lang] = [...new Set(values)];
            }
        }
        const parents = [options.parent, ...(options.parents || [])].filter(Boolean).map(v => nameOf(v!));
        const antonyms = [options.antonym, ...(options.antonyms || [])].filter(Boolean).map(v => nameOf(v!));
        if (options.parent !== undefined || options.parents !== undefined) record.parents = [...new Set(parents)];
        if (options.antonym !== undefined || options.antonyms !== undefined) record.antonyms = [...new Set(antonyms)];
        return record;
    }
    private validate(records: Map<string, TagRecord>): Map<string, string> {
        const aliases = new Map<string, string>();
        for (const [name, record] of records) {
            if (!name.trim() || record.name !== name) throw new Error(`Invalid canonical tag name '${name}'.`);
            for (const alias of [name, ...Object.values(record.displayNames || {}), ...Object.values(record.synonyms || {}).flat()]) {
                const key = normalize(alias);
                if (!key) throw new Error(`Empty alias on tag '${name}'.`);
                const owner = aliases.get(key);
                if (owner && owner !== name) throw new Error(`Tag alias '${alias}' conflicts with '${owner}'.`);
                aliases.set(key, name);
            }
            for (const parent of record.parents || []) {
                if (parent === name || !records.has(parent)) throw new Error(`Invalid parent '${parent}' for tag '${name}'.`);
            }
            for (const antonym of record.antonyms || []) {
                if (antonym === name || !records.has(antonym)) throw new Error(`Invalid antonym '${antonym}' for tag '${name}'.`);
            }
        }
        const done = new Set<string>();
        const visiting = new Set<string>();
        const visit = (name: string) => {
            if (visiting.has(name)) throw new Error(`Cycle detected in tag taxonomy at '${name}'.`);
            if (done.has(name)) return;
            visiting.add(name);
            for (const parent of records.get(name)!.parents || []) visit(parent);
            visiting.delete(name);
            done.add(name);
        };
        for (const name of records.keys()) visit(name);
        return aliases;
    }
    private install(records: Map<string, TagRecord>): void {
        const aliases = this.validate(records);
        for (const [name] of this.tagMap) if (!records.has(name)) this.tagMap.delete(name);
        for (const name of records.keys()) if (!this.tagMap.has(name)) this.tagMap.set(name, new Tag(this.semanticPackage, name));
        for (const [name, record] of records) {
            const tag = this.tagMap.get(name)!;
            tag.description = record.description;
            tag.metadata = record.metadata;
            tag.embedding = record.embedding;
            tag.abstract = record.abstract || false;
            tag.exclusive = record.exclusive || false;
            tag.displayNames = {...record.displayNames};
            tag.synonyms = Object.fromEntries(Object.entries(record.synonyms || {}).map(([lang, values]) => [lang, new Set(values)]));
            tag.parents.clear(); tag.children.clear(); tag.antonyms.clear();
        }
        for (const [name, record] of records) {
            const tag = this.tagMap.get(name)!;
            for (const parent of record.parents || []) {
                const parentTag = this.tagMap.get(parent)!;
                tag.parents.add(parentTag); parentTag.children.add(tag);
            }
            for (const antonym of record.antonyms || []) {
                const other = this.tagMap.get(antonym)!;
                tag.antonyms.add(other); other.antonyms.add(tag);
            }
        }
        this.records = records;
        this.aliases = aliases;
    }
    private enqueue<T>(work: () => Promise<T>): Promise<T> {
        const result = this.mutation.then(work);
        this.mutation = result.then(() => {}, () => {});
        return result;
    }
    async define(name: string, options: TagOptions = {}): Promise<Tag> {
        return this.enqueue(async () => {
            await this.ready();
            if (this.records.has(name)) throw new Error(`Tag '${name}' already exists; use update().`);
            const next = new Map(this.records);
            const record = this.fromOptions(name, options);
            next.set(name, record);
            this.validate(next);
            await this.collection!.append({_id: name, ...record});
            this.install(next);
            return this.tagMap.get(name)!;
        });
    }
    async update(name: string, changes: TagOptions): Promise<Tag> {
        return this.enqueue(async () => {
            await this.ready();
            const current = this.records.get(name);
            if (!current) throw new Error(`Unknown tag '${name}'.`);
            const next = new Map(this.records);
            next.set(name, this.fromOptions(name, changes, current));
            this.validate(next);
            await this.collection!.updateDocument(name, next.get(name)!);
            this.install(next);
            return this.tagMap.get(name)!;
        });
    }
    async remove(name: string): Promise<boolean> {
        return this.enqueue(async () => {
            await this.ready();
            if (!this.records.has(name)) return false;
            const tag = this.tagMap.get(name)!;
            if (tag.children.size || tag.antonyms.size) throw new Error(`Cannot remove tag '${name}' while referenced by taxonomy.`);
            const [entities, predicates] = await Promise.all([tag.entities(), tag.predicates()]);
            if (entities.length || predicates.length) throw new Error(`Cannot remove tag '${name}' while assigned to artifacts.`);
            await this.collection!.deleteById(name);
            const next = new Map(this.records);
            next.delete(name);
            this.install(next);
            return true;
        });
    }
    async defineTaxonomy(tree: Record<string, any>): Promise<void> {
        await this.ready();
        const walk = async (nodes: Record<string, any>, parent?: string) => {
            for (const [name, value] of Object.entries(nodes)) {
                if (name.startsWith("$")) continue;
                const data = value && typeof value === "object" ? value : {};
                const options: TagOptions = {
                    abstract: data.$abstract, exclusive: data.$exclusive, displayName: data.$displayName,
                    synonym: data.$synonym, synonyms: data.$synonyms, description: data.$description,
                    parents: [...(parent ? [parent] : []), ...(data.$parent ? [data.$parent] : []), ...(data.$parents || [])],
                    antonym: data.$antonym, antonyms: data.$antonyms
                };
                if (this.records.has(name)) await this.update(name, options);
                else await this.define(name, options);
                await walk(data, name);
            }
        };
        await walk(tree);
    }
    get(value: string): Tag | undefined { this.assertReady(); return this.tagMap.get(this.aliases.get(normalize(value)) || ""); }
    has(value: string): boolean { return this.get(value) !== undefined; }
    all(): Tag[] { this.assertReady(); return [...this.tagMap.values()]; }
    toJSON(): Record<string, any> { return Object.fromEntries(this.all().map(tag => [tag.name, tag.toJSON()])); }
}
