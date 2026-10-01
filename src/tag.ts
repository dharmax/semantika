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
interface TagState {
    description?: string;
    metadata?: Record<string, any>;
    embedding?: number[];
    abstract: boolean;
    exclusive: boolean;
    displayNames: Record<string, string>;
    synonyms: Record<string, Set<string>>;
    parents: Set<Tag>;
    children: Set<Tag>;
    antonyms: Set<Tag>;
    declaredAntonyms: string[];
}
const installState = Symbol("installTagState");
const tagRecordSnapshot = Symbol("tagRecordSnapshot");
const emptyState = (): TagState => ({
    abstract: false, exclusive: false, displayNames: {}, synonyms: {},
    parents: new Set(), children: new Set(), antonyms: new Set(), declaredAntonyms: []
});

export class Tag {
    #state: TagState = emptyState();
    constructor(readonly semanticPackage: SemanticPackage, readonly name: string) {
        Object.defineProperty(this, "name", {value: name, enumerable: true});
    }
    [installState](state: TagState): void { this.#state = state; }
    private get state(): TagState { return this.#state; }
    [tagRecordSnapshot](): TagRecord {
        const state = this.#state;
        return {
            name: this.name, description: state.description,
            metadata: state.metadata && structuredClone(state.metadata),
            embedding: state.embedding?.slice(), abstract: state.abstract, exclusive: state.exclusive,
            displayNames: {...state.displayNames},
            synonyms: Object.fromEntries(Object.entries(state.synonyms).map(([lang, values]) => [lang, [...values]])),
            parents: [...state.parents].map(parent => parent.name),
            antonyms: [...state.declaredAntonyms]
        };
    }
    get parents(): Set<Tag> { return new Set(this.state.parents); }
    get children(): Set<Tag> { return new Set(this.state.children); }
    get antonyms(): Set<Tag> { return new Set(this.state.antonyms); }
    get description(): string | undefined { return this.state.description; }
    get metadata(): Record<string, any> | undefined {
        return this.state.metadata ? structuredClone(this.state.metadata) : undefined;
    }
    get embedding(): number[] | undefined { return this.state.embedding?.slice(); }
    get abstract(): boolean { return this.state.abstract; }
    get exclusive(): boolean { return this.state.exclusive; }
    get displayNames(): Record<string, string> { return {...this.state.displayNames}; }
    get synonyms(): Record<string, Set<string>> {
        return Object.fromEntries(Object.entries(this.state.synonyms).map(([lang, values]) => [lang, new Set(values)]));
    }
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
        if (this.isAntonymOf(value)) return this;
        await this.semanticPackage.tags.update(this.name, {
            antonyms: [...this.state.declaredAntonyms, nameOf(value)]
        });
        return this;
    }
    async removeAntonym(value: Tag | string): Promise<this> {
        await this.semanticPackage.tags.unlinkAntonym(this.name, nameOf(value));
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
        const limit = options?.limit ?? 10;
        const hits = await this.semanticPackage.tags.search(this.name, {...options, limit: limit + 1});
        return hits.filter(hit => hit.match === "semantic" && hit.tag !== this)
            .slice(0, limit).map(hit => ({tag: hit.tag, score: hit.score!}));
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
    private collection?: ICollection;
    private hydration?: Promise<void>;
    private hydrated = false;
    private mutation: Promise<void> = Promise.resolve();
    private searchConfig?: {vectorStore: IVectorStore; embeddingProvider: IEmbeddingProvider};

    constructor(readonly semanticPackage: SemanticPackage) {}
    private get records(): Map<string, TagRecord> {
        return new Map([...this.tagMap.values()].map(tag => [tag.name, this.clean(tag[tagRecordSnapshot]())]));
    }
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
            name: record.name, description: record.description,
            metadata: record.metadata && structuredClone(record.metadata),
            embedding: record.embedding?.slice(), abstract: record.abstract, exclusive: record.exclusive,
            displayNames: {...record.displayNames},
            synonyms: Object.fromEntries(Object.entries(record.synonyms || {}).map(([lang, values]) => [lang, values.slice()])),
            parents: [...(record.parents || [])], antonyms: [...(record.antonyms || [])]
        };
    }
    private fromOptions(name: string, options: TagOptions, old?: TagRecord): TagRecord {
        const record = this.clean(old || {name});
        if (options.description !== undefined) record.description = options.description;
        if (options.metadata !== undefined) record.metadata = {...record.metadata, ...structuredClone(options.metadata)};
        if (options.embedding !== undefined) record.embedding = options.embedding.slice();
        else if (options.description !== undefined || options.displayName !== undefined
            || options.synonym !== undefined || options.synonyms !== undefined) record.embedding = undefined;
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
                if (records.get(antonym)!.antonyms?.includes(name)) {
                    throw new Error(`Duplicate antonym relation between '${name}' and '${antonym}'.`);
                }
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
        const states = new Map<string, TagState>();
        for (const [name, record] of records) {
            states.set(name, {
                description: record.description, metadata: record.metadata && structuredClone(record.metadata),
                embedding: record.embedding?.slice(), abstract: record.abstract || false,
                exclusive: record.exclusive || false, displayNames: {...record.displayNames},
                synonyms: Object.fromEntries(Object.entries(record.synonyms || {}).map(([lang, values]) => [lang, new Set(values)])),
                parents: new Set(), children: new Set(), antonyms: new Set(),
                declaredAntonyms: [...(record.antonyms || [])]
            });
        }
        for (const [name, record] of records) {
            const state = states.get(name)!;
            for (const parent of record.parents || []) {
                const parentTag = this.tagMap.get(parent)!;
                state.parents.add(parentTag); states.get(parent)!.children.add(this.tagMap.get(name)!);
            }
            for (const antonym of record.antonyms || []) {
                const other = this.tagMap.get(antonym)!;
                state.antonyms.add(other); states.get(antonym)!.antonyms.add(this.tagMap.get(name)!);
            }
        }
        for (const [name, state] of states) this.tagMap.get(name)![installState](state);
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
            await this.refreshVector(name);
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
            await this.refreshVector(name);
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
            await this.removeVector(name);
            return true;
        });
    }
    async unlinkAntonym(name: string, other: string): Promise<void> {
        await this.ready();
        const owner = this.records.get(name)?.antonyms?.includes(other) ? name
            : this.records.get(other)?.antonyms?.includes(name) ? other : undefined;
        if (!owner) return;
        const opposite = owner === name ? other : name;
        await this.update(owner, {
            antonyms: (this.records.get(owner)!.antonyms || []).filter(value => value !== opposite)
        });
    }
    async defineTaxonomy(tree: Record<string, any>): Promise<void> {
        await this.ready();
        const definitions = new Map<string, TagOptions>();
        const walk = (nodes: Record<string, any>, parent?: string) => {
            for (const [name, value] of Object.entries(nodes)) {
                if (name.startsWith("$")) continue;
                const data = value && typeof value === "object" ? value : {};
                const previous = definitions.get(name);
                const options: TagOptions = {
                    abstract: data.$abstract, exclusive: data.$exclusive, displayName: data.$displayName,
                    synonym: data.$synonym, synonyms: data.$synonyms, description: data.$description,
                    parents: [...new Set([
                        ...(previous?.parents || []), ...(parent ? [parent] : []),
                        ...(data.$parent ? [data.$parent] : []), ...(data.$parents || [])
                    ])],
                    antonym: data.$antonym, antonyms: data.$antonyms
                };
                definitions.set(name, {...previous, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))});
                walk(data, name);
            }
        };
        walk(tree);
        const proposed = new Map(this.records);
        for (const name of definitions.keys()) if (!proposed.has(name)) proposed.set(name, this.clean({name}));
        for (const [name, options] of definitions) {
            options.parents = [...new Set([...(proposed.get(name)!.parents || []), ...(options.parents || [])])];
            options.antonyms = [...new Set([
                ...(proposed.get(name)!.antonyms || []), ...(options.antonym ? [options.antonym] : []),
                ...(options.antonyms || [])
            ])];
            delete options.antonym;
            proposed.set(name, this.fromOptions(name, options, proposed.get(name)));
        }
        this.validate(proposed);
        for (const name of definitions.keys()) if (!this.records.has(name)) await this.define(name);
        for (const [name, options] of definitions) await this.update(name, options);
    }
    get(value: string): Tag | undefined { this.assertReady(); return this.tagMap.get(this.aliases.get(normalize(value)) || ""); }
    has(value: string): boolean { return this.get(value) !== undefined; }
    all(): Tag[] { this.assertReady(); return [...this.tagMap.values()]; }
    toJSON(): Record<string, any> { return Object.fromEntries(this.all().map(tag => [tag.name, tag.toJSON()])); }

    private semanticText(tag: Tag): string {
        return [
            tag.name, ...Object.values(tag.displayNames),
            ...Object.values(tag.synonyms).flatMap(values => [...values]),
            tag.description
        ].filter(Boolean).join("\n");
    }
    private vectorId(name: string): string {
        return `${encodeURIComponent(this.semanticPackage.name)}::${encodeURIComponent(name)}`;
    }
    private tagNameFromVectorId(id: string): string | undefined {
        const prefix = `${encodeURIComponent(this.semanticPackage.name)}::`;
        return id.startsWith(prefix) ? decodeURIComponent(id.slice(prefix.length)) : undefined;
    }
    private async indexVector(
        name: string,
        config: {vectorStore: IVectorStore; embeddingProvider: IEmbeddingProvider}
    ): Promise<void> {
        const tag = this.tagMap.get(name)!;
        const vector = tag.embedding || await config.embeddingProvider.embed(this.semanticText(tag));
        await config.vectorStore.upsert(this.vectorId(name), vector, {
            semanticPackage: this.semanticPackage.name,
            tagName: name
        });
    }
    private async refreshVector(name: string): Promise<void> {
        const config = this.searchConfig;
        if (!config) return;
        try {
            await this.indexVector(name, config);
        } catch {
            // TagRecord is authoritative. Never report a committed semantic mutation as failed
            // because its derived search index failed; disable semantic search instead of serving stale data.
            if (this.searchConfig === config) this.searchConfig = undefined;
        }
    }
    private async removeVector(name: string): Promise<void> {
        const config = this.searchConfig;
        if (!config) return;
        try {
            await config.vectorStore.delete(this.vectorId(name));
        } catch {
            if (this.searchConfig === config) this.searchConfig = undefined;
        }
    }
    async configureSearch(config: {vectorStore: IVectorStore; embeddingProvider: IEmbeddingProvider}): Promise<void> {
        await this.enqueue(async () => {
            await this.ready();
            for (const name of this.records.keys()) await this.indexVector(name, config);
            this.searchConfig = config;
        });
    }
    async search(query: string, options: {limit?: number; minScore?: number} = {}): Promise<Array<{tag: Tag; match: "exact" | "semantic"; score?: number}>> {
        await this.ready();
        await this.mutation;
        const limit = options.limit ?? 10;
        if (limit <= 0) return [];
        const exact = this.get(query);
        const hits: Array<{tag: Tag; match: "exact" | "semantic"; score?: number}> =
            exact ? [{tag: exact, match: "exact"}] : [];
        const config = this.searchConfig;
        if (!config || hits.length >= limit) return hits;
        const vector = await config.embeddingProvider.embed(query);
        const results = await config.vectorStore.query(vector, {
            limit: limit + 1,
            minScore: options.minScore,
            filter: {semanticPackage: this.semanticPackage.name}
        });
        for (const result of results) {
            const name = result.metadata?.tagName || this.tagNameFromVectorId(result.id);
            const tag = name ? this.tagMap.get(name) : undefined;
            if (tag && tag !== exact) hits.push({tag, match: "semantic", score: result.score});
            if (hits.length >= limit) break;
        }
        return hits;
    }
}
