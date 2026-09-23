import {RawOntology} from "./raw-ontology.js";
import {AbstractEntity} from "./abstract-entity.js";
import {validateArtifactTags} from "./semantic-artifact.js";
import {LoggedException} from "./utils/logged-exception.js";
import {IFindPredicatesOptions, IReadOptions, IReadResult} from "./types.js";
import {Predicate} from "./predicate.js";
import {AbstractStorage, DuplicateKeyError, ICollection, IPhysicalCollection} from "./storage/index.js";
import {ID_SEPARATOR} from "./utils/constants.js";
import {Ontology} from "./ontology.js";
import {processTemplate} from "./utils/template-processor.js";
import {ProjectionItem} from "./projection.js";
import {EntityDcr, PredicateDcr} from "./descriptors.js";
import {Mutex} from "./utils/mutex.js";
import {ArtifactCollection} from "./artifact-collection.js";
import {EntityCollection} from "./entities-collection.js";
import {IPredicateRecord, PredicateCollection} from "./predicates-collection.js";
import {Tag, TagTaxonomy, TagOptions} from "./tag.js";
import {evaluateTagQuery, TagQueryExpression} from "./tag-query.js";
import {IVectorStore, IEmbeddingProvider} from "./vector-store.js";

/**
 * A Semantic package represents and contains semantic artifacts and provides the API to manage them and query them.
 * Semantic packages can extend other semantic packages and thus logically be a super-set of their contents. Often
 * one semantic package is enough for an application, but not always.
 */
export class SemanticPackage {
    readonly ontology: Ontology;
    readonly tags: TagTaxonomy;
    vectorStore?: IVectorStore;
    embeddingProvider?: IEmbeddingProvider;
    private collectionManager: CollectionManager;
    static semanticPackages: { [name: string]: SemanticPackage } = {};

    /**
     * @param name name of semantic package
     * @param ontology the ontology associated with the SP
     * @param storage the storage for the semantic artifacts
     * @param parents optional parent semantic packages, that this one will extend
     */
    constructor(
        readonly name: string,
        ontology: RawOntology,
        readonly storage: AbstractStorage,
        readonly parents: SemanticPackage[] = []
    ) {
        this.ontology = new Ontology(this, ontology);
        this.tags = new TagTaxonomy(this);
        this.collectionManager = new CollectionManager(this, storage);
        SemanticPackage.semanticPackages[name] = this;
        this.ontology.postProcess();
    }

    static findSemanticPackage(name: string): SemanticPackage {
        return SemanticPackage.semanticPackages[name];
    }

    /**
     * Internal
     * Create an entity instance from a record and possibly from id only. If it is not an entity, it just returns the record unchanged.
     */
    makeEntity<T extends AbstractEntity>(eDcr?: EntityDcr, id?: string, record?: any): T {
        id = id || (record?._id || record?.id);
        if (!id) return null;
        const idSegments = id.split(ID_SEPARATOR);
        if (!eDcr) {
            if (!id) throw new Error("Need at least a fully qualified ID");
            eDcr = this.ontology.edcr(idSegments[idSegments.length - 2]);
        }
        if (!eDcr) return record;
        const rType = idSegments[idSegments.length - 2];
        if (rType && rType !== eDcr.name)
            throw `Requested entity type ${eDcr.name} does not match entity's record of type ${rType}.`;
        // @ts-ignore
        let e = new eDcr.clazz(this, id);
        if (record) {
            Object.assign(e, { id, _version: record._version || 1 }, record);
            if (record._tags && Array.isArray(record._tags)) {
                e._tags = [...record._tags];
            }
        } else {
            Object.assign(e, { id, _version: 1 });
        }
        return e;
    }

    /**
     * internal
     */
    async loadEntityById<T>(id: string, ...projection: string[]): Promise<T> {
        const idSegments = id.split(ID_SEPARATOR);
        const entityTypeName = idSegments[idSegments.length - 2];
        const spName = idSegments[0];
        if (spName !== this.name) {
            const foreignSp = SemanticPackage.findSemanticPackage(spName);
            if (foreignSp) {
                return foreignSp.loadEntityById(id, ...projection);
            }
        }

        const eDcr = this.ontology.edcr(entityTypeName);
        if (!eDcr) throw new Error(`No such entity type ${entityTypeName}`);
        // @ts-ignore
        return this.loadEntity(id, eDcr, ...projection);
    }

    async predicateById(pid: string): Promise<Predicate | null> {
        const pCol: PredicateCollection = await this.collectionManager.predicateCollection(pid);
        const record = <IPredicateRecord>await pCol.findById(pid, undefined);
        if (record) return new Predicate(this, record);
        for (let parent of this.parents) {
            let p = await parent.predicateById(pid);
            if (p) return p;
        }
        return null;
    }

    predicateCollection(pDcr: PredicateDcr): Promise<PredicateCollection> {
        return this.collectionManager.predicateCollection(pDcr);
    }

    basicCollection(name: string, initFunc?: (col: ICollection) => void): Promise<ICollection> {
        return this.collectionManager.basicCollection(name, initFunc);
    }

    async createPredicate(
        source: AbstractEntity,
        pDcr: PredicateDcr,
        target: AbstractEntity,
        payload?: Object,
        selfKeys: Record<string, any> = {},
        tags?: (string | Tag)[]
    ): Promise<Predicate> {
        const pCol: PredicateCollection = await this.predicateCollection(pDcr);
        const pred: IPredicateRecord = {
            predicateName: pDcr.name,
            sourceId: source.id,
            sourceType: source.constructor.name,
            targetId: target.id,
            targetType: target.constructor.name,
            payload: payload,
            timestamp: Date.now()
        };
        if (tags && tags.length > 0) {
            const rawNames = tags.map(t => (typeof t === "string" ? t : t.name));
            validateArtifactTags(this.tags, rawNames, rawNames);
            pred._tags = rawNames;
        }
        pDcr.keys && (await addKeys());

        try {
            const pid = <string>await pCol.append(pred);
            pred["id"] = pred._id = pid;
            return new Predicate(this, pred);
        } catch (e) {
            if (e instanceof DuplicateKeyError) throw new DuplicateKeyError(e.col, pDcr.name);
            throw e;
        }

        async function addKeys() {
            await addKeyForEntity("target", target);
            await addKeyForEntity("source", source);

            const recordKeys = Object.keys(pred);
            Object.keys(selfKeys).forEach(k => {
                if (recordKeys.includes(k)) throw new LoggedException(`Bad predicate self-key: ${k}`);
                pred[k] = selfKeys[k];
            });

            async function addKeyForEntity(sideName: string, e: AbstractEntity) {
                const fieldNames = pDcr.keys[sideName];
                if (!fieldNames || !fieldNames.length) return;
                const fields = await e.getFields(...fieldNames);
                Object.entries(fields).forEach(([f, v]) => {
                    pred[`_${sideName}_${f}`] = v;
                });
            }
        }
    }

    async deletePredicate(predicate: Predicate) {
        const pCol = await this.collectionManager.predicateCollection(predicate);
        return pCol.deleteById(predicate.id);
    }

    async deleteAllEntityPredicates(entityId: string) {
        const pcol = await this.collectionManager.predicateCollection();
        return pcol.deleteByQuery({
            $or: [{ sourceId: entityId }, { targetId: entityId }]
        });
    }

    async findPredicates(
        incoming: boolean,
        predicate?: string | PredicateDcr,
        entityId?: string,
        opts: IFindPredicatesOptions = {}
    ): Promise<Predicate[]> {
        return <Promise<Predicate[]>>this.loadPredicates(incoming, predicate, entityId, opts, null);
    }

    async pagePredicates(
        incoming: boolean,
        predicate: string | PredicateDcr,
        entityId: string,
        opts: IFindPredicatesOptions = {},
        pagination: IReadOptions
    ): Promise<IReadResult> {
        return <Promise<IReadResult>>this.loadPredicates(incoming, predicate, entityId, opts, pagination);
    }

    private async loadPredicates(
        incoming: boolean,
        pred?: string | PredicateDcr,
        entityId?: string,
        opts: IFindPredicatesOptions = {},
        pagination?: IReadOptions
    ): Promise<Predicate[] | IReadResult | AbstractEntity[]> {
        const self = this;
        const predicateDcr = typeof pred === "string" ? this.ontology.pdcr(pred) : pred;
        const pCol: PredicateCollection = await this.predicateCollection(predicateDcr);

        const predicateNames = expandPredicate(predicateDcr);
        let query: any = predicateNames
            ? {
                  predicateName: { $in: predicateNames }
              }
            : {};

        const whichPeer = incoming ? "source" : "target";
        const whichSelf = !incoming ? "source" : "target";
        const selfId = whichSelf + "Id";
        if (entityId) query[selfId] = entityId;
        if (opts.peerType && opts.peerType !== "*")
            query[whichPeer + "Type"] = typeof opts.peerType === "string" ? opts.peerType : { $in: opts.peerType };
        if (opts.peerId) query[whichPeer + "Id"] = opts.peerId;

        const fieldProjection = ((pagination && pagination.projection) || []).concat(opts.projection || []);
        pagination && delete pagination.projection;

        if (opts.tagQuery && pagination) {
            const originalFilter = pagination.filterFunction;
            pagination.filterFunction = async (items: any[]) => {
                if (originalFilter) items = await originalFilter(items);
                return items.filter(p => {
                    const itemTags = new Set<string>(p._tags || []);
                    return evaluateTagQuery(itemTags, opts.tagQuery!, opts.expandTaxonomy ? self.tags : undefined);
                });
            };
        }

        if (pagination) {
            let rr: IReadResult = await pCol.load(pagination, query);
            rr.items = await enrich(<IPredicateRecord[]>rr.items);
            return rr;
        } else {
            const predicates: IPredicateRecord[] = await pCol.findSome(query);
            return <Predicate[]>await enrich(predicates);
        }

        async function enrich(predicates: IPredicateRecord[]) {
            if (opts.tagQuery) {
                predicates = predicates.filter(p => {
                    const itemTags = new Set<string>(p._tags || []);
                    return evaluateTagQuery(itemTags, opts.tagQuery!, opts.expandTaxonomy ? self.tags : undefined);
                });
            }
            if (opts.projection || opts.peerType) {
                for (let p of predicates) {
                    const peerType = p[whichPeer + "Type"];
                    if (opts.peerType && opts.peerType !== "*" && opts.peerType !== peerType) continue;
                    p.peerEntity = await self.loadEntityById(p[whichPeer + "Id"], ...fieldProjection);
                }
            }
            return predicates.map(p => (pagination?.entityOnly ? p.peerEntity : new Predicate(self, p)));
        }
    }

    async predicatesBetween(
        source: AbstractEntity | string,
        target: AbstractEntity | string,
        bidirectional: boolean,
        predicateName?: string
    ): Promise<Predicate[]> {
        if (!source || !target) return [];
        const predicates = await this.collectionManager.predicateCollection();
        const sourceId = source["id"] || source;
        const targetId = target["id"] || target;
        const query: any = {};
        if (bidirectional) {
            query.$or = [{ sourceId, targetId }, { targetId: sourceId, sourceId: targetId }];
        } else {
            query.sourceId = sourceId;
            query.targetId = targetId;
        }
        predicateName && (query.predicateName = predicateName);
        return (await predicates.findSome(query)).map((rec: IPredicateRecord) => new Predicate(this, rec));
    }

    async collectionForEntityType(
        eDcr: EntityDcr,
        initFunc?: (col: EntityCollection) => void
    ): Promise<EntityCollection> {
        initFunc = initFunc || eDcr.initializer;
        return this.collectionManager.entityCollection(initFunc, eDcr);
    }

    async createEntity<T extends AbstractEntity>(
        eDcr: EntityDcr,
        fields: Object,
        superSetAllowed = false,
        cutExtraFields = true,
        tags?: (string | Tag)[]
    ): Promise<T> {
        const rawTags = tags || (fields as any)?._tags;
        fields = processTemplate(eDcr.template, fields, superSetAllowed, cutExtraFields, eDcr.clazz.name);
        const record = { ...fields } as any;
        if (rawTags && Array.isArray(rawTags)) {
            const rawNames = rawTags.map(t => (typeof t === "string" ? t : t.name));
            validateArtifactTags(this.tags, rawNames, rawNames);
            record._tags = rawNames;
        }
        const col = await this.collectionForEntityType(eDcr);
        let id = await col.append(record);
        return <T>this.makeEntity(eDcr, id, record);
    }

    async loadEntity<T extends AbstractEntity>(
        entityId: any,
        eDcr?: EntityDcr,
        ...projection: ProjectionItem[]
    ): Promise<T> {
        if (!entityId) throw new LoggedException("No entity id!");
        let e = <T>this.makeEntity(eDcr, entityId);
        return e.populate(...projection);
    }

    /**
     * Traverses the graph from a starting entity up to maxDepth hops.
     * Ideal for AI context extraction and visual graph renderers.
     * @param startId starting entity or entity ID
     * @param options maxDepth, predicateTypes, direction, limit
     */
    async traverse(
        startId: string | AbstractEntity,
        options: {
            maxDepth?: number;
            predicateTypes?: string[];
            direction?: "outgoing" | "incoming" | "both";
            limit?: number;
        } = {}
    ): Promise<{ entities: AbstractEntity[]; predicates: Predicate[] }> {
        const rootId = typeof startId === "string" ? startId : startId.id;
        const maxDepth = options.maxDepth ?? 1;
        const direction = options.direction ?? "both";
        const limit = options.limit ?? 100;

        const visitedEntityIds = new Set<string>([rootId]);
        const visitedPredIds = new Set<string>();
        const entities: AbstractEntity[] = [];
        const predicates: Predicate[] = [];

        try {
            const rootEntity = await this.loadEntityById<AbstractEntity>(rootId);
            if (rootEntity) entities.push(rootEntity);
        } catch {}

        let currentQueue = [rootId];
        let currentDepth = 0;

        while (currentQueue.length > 0 && currentDepth < maxDepth && entities.length < limit) {
            const nextQueue: string[] = [];
            for (const currentId of currentQueue) {
                const hops: Predicate[] = [];
                if (direction === "outgoing" || direction === "both") {
                    const out = await this.findPredicates(false, undefined, currentId);
                    hops.push(...out);
                }
                if (direction === "incoming" || direction === "both") {
                    const inc = await this.findPredicates(true, undefined, currentId);
                    hops.push(...inc);
                }

                for (const pred of hops) {
                    if (options.predicateTypes && !options.predicateTypes.includes(pred.predicateName)) {
                        continue;
                    }
                    if (!visitedPredIds.has(pred.id)) {
                        visitedPredIds.add(pred.id);
                        predicates.push(pred);
                    }

                    const peerId = pred.sourceId === currentId ? pred.targetId : pred.sourceId;
                    if (!visitedEntityIds.has(peerId) && entities.length < limit) {
                        visitedEntityIds.add(peerId);
                        nextQueue.push(peerId);
                        try {
                            const peerEntity = await this.loadEntityById<AbstractEntity>(peerId);
                            if (peerEntity) entities.push(peerEntity);
                        } catch {}
                    }
                }
            }
            currentQueue = nextQueue;
            currentDepth++;
        }

        return { entities, predicates };
    }

    setVectorStore(store: IVectorStore): this {
        this.vectorStore = store;
        return this;
    }

    setEmbeddingProvider(provider: IEmbeddingProvider): this {
        this.embeddingProvider = provider;
        return this;
    }

    async indexTagVector(tag: Tag | string, vector?: number[]): Promise<void> {
        if (!this.vectorStore) return;
        const tagObj = typeof tag === "string" ? this.tags.tag(tag) : tag;
        let vec = vector || tagObj.embedding;
        if (!vec && this.embeddingProvider) {
            vec = await this.embeddingProvider.embed(
                tagObj.name + (tagObj.description ? `: ${tagObj.description}` : "")
            );
            tagObj.embedding = vec;
        }
        if (vec) {
            await this.vectorStore.upsert(tagObj.name, vec, {
                name: tagObj.name,
                description: tagObj.description,
                parents: Array.from(tagObj.parents).map(p => p.name)
            });
        }
    }

    async findSimilarTags(
        tag: Tag | string,
        options: { limit?: number; minScore?: number } = {}
    ): Promise<Array<{ tag: Tag; score: number }>> {
        if (!this.vectorStore) return [];
        const tagObj = typeof tag === "string" ? this.tags.tag(tag) : tag;
        let queryVec = tagObj.embedding;
        if (!queryVec && this.embeddingProvider) {
            queryVec = await this.embeddingProvider.embed(tagObj.name);
        }
        if (!queryVec) return [];

        const requestedLimit = options.limit ?? 10;
        const queryOptions = {
            ...options,
            limit: requestedLimit + 1
        };
        const hits = await this.vectorStore.query(queryVec, queryOptions);
        return hits
            .filter(h => h.id !== tagObj.name)
            .slice(0, requestedLimit)
            .map(h => ({
                tag: this.tags.tag(h.id),
                score: h.score
            }));
    }

    async findEntitiesByTag<T extends AbstractEntity = AbstractEntity>(
        tag: Tag | string,
        options: { includeDescendants?: boolean; entityType?: string } = {}
    ): Promise<T[]> {
        const tagName = typeof tag === "string" ? tag : tag.name;
        const tagObj = typeof tag === "string" ? this.tags.get(tag) : tag;
        const targetTags = new Set<string>([tagName]);
        if (options.includeDescendants && tagObj) {
            for (const d of tagObj.descendants) targetTags.add(d.name);
        }

        const eDcrs = options.entityType
            ? [this.ontology.edcr(options.entityType)].filter(Boolean)
            : this.ontology.allEntityDcrs;

        const query = { _tags: { $in: Array.from(targetTags) } };
        const results: T[] = [];
        for (const eDcr of eDcrs) {
            const col = await this.collectionForEntityType(eDcr);
            const found = await col.findSome<any>(query);
            for (const item of found) {
                results.push(this.makeEntity<T>(eDcr, item._id || item.id, item));
            }
        }
        return results;
    }

    async findPredicatesByTag(
        tag: Tag | string,
        options: { includeDescendants?: boolean; predicateName?: string } = {}
    ): Promise<Predicate[]> {
        const tagName = typeof tag === "string" ? tag : tag.name;
        const tagObj = typeof tag === "string" ? this.tags.get(tag) : tag;
        const targetTags = new Set<string>([tagName]);
        if (options.includeDescendants && tagObj) {
            for (const d of tagObj.descendants) targetTags.add(d.name);
        }

        const pDcrs = options.predicateName
            ? [this.ontology.pdcr(options.predicateName)].filter(Boolean)
            : this.ontology.allPredicateDcrs;

        const query = { _tags: { $in: Array.from(targetTags) } };
        const results: Predicate[] = [];
        for (const pDcr of pDcrs) {
            const pCol = await this.predicateCollection(pDcr);
            const found = await pCol.findSome<IPredicateRecord>(query);
            for (const item of found) {
                results.push(new Predicate(this, item));
            }
        }
        return results;
    }
}

function expandPredicate(predicateDcr?: PredicateDcr): string[] | null {
    if (!predicateDcr) return null;
    const names: string[] = [predicateDcr.name];
    function collect(dcr: PredicateDcr) {
        if (dcr.children && Array.isArray(dcr.children)) {
            for (const child of dcr.children) {
                if (!names.includes(child.name)) {
                    names.push(child.name);
                    collect(child);
                }
            }
        }
    }
    collect(predicateDcr);
    return names;
}

class CollectionManager {
    collectionMutex = new Mutex();
    collections: { [name: string]: ArtifactCollection } = {};

    constructor(private semanticPackage: SemanticPackage, private storage: AbstractStorage) {}

    entityCollection(
        initFunc: (col: EntityCollection) => void,
        eDcr: EntityDcr
    ): EntityCollection | Promise<EntityCollection> {
        const collectionName = this.semanticPackage.name + ID_SEPARATOR + (eDcr.collectionName || eDcr.clazz.name);
        return this.collectionForName(collectionName, false, c =>
            this.storage.makeEntityCollection(c, eDcr, initFunc)
        );
    }

    basicCollection(name: string, initFunc: (col: ICollection) => void): Promise<ICollection> {
        const collectionName = this.semanticPackage.name + ID_SEPARATOR + name;
        return this.collectionForName(collectionName, false, c => this.storage.makeBasicCollection(c, initFunc));
    }

    async predicateCollection(p?: Predicate | string | PredicateDcr): Promise<PredicateCollection> {
        if (p && typeof p == "string")
            return this.collectionForName(p, true, c => {
                const col = this.storage.makePredicateCollection(this.semanticPackage, c);
                predicateInitFunction(col);
                return col;
            });
        // @ts-ignore
        const pDcr: PredicateDcr = p?.constructor.name === "PredicateDcr" ? p : (p as Predicate)?.dcr;

        const collectionName = pDcr?.collectionName || this.semanticPackage.name + ID_SEPARATOR + "_Predicates";
        return this.collectionForName(collectionName, true, c =>
            this.storage.makePredicateCollection(this.semanticPackage, c)
        );
    }

    async collectionForName<T extends ArtifactCollection>(
        name: string,
        forPredicate: boolean,
        wrapper: (pc: IPhysicalCollection) => ArtifactCollection
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.collectionMutex.lock(() => {
                let col = this.collections[name];
                if (col) {
                    this.collectionMutex.release();
                    resolve(col as T);
                } else {
                    this.storage
                        .getPhysicalCollection(name, forPredicate)
                        .then(physicalCollection => {
                            const newCollection = wrapper(physicalCollection);
                            this.collections[name] = newCollection;
                            this.collectionMutex.release();
                            resolve(newCollection as T);
                        })
                        .catch(e => {
                            this.collectionMutex.release();
                            reject(e);
                        });
                }
            });
        });
    }
}

const predicateInitFunction = (col: any) => {
    col.ensureIndex(
        {
            predicateName: 1,
            sourceId: 1,
            targetType: 1
        },
        {}
    );
    col.ensureIndex(
        {
            predicateName: 1,
            targetId: 1,
            sourceType: 1
        },
        {}
    );
    col.ensureIndex(
        {
            sourceId: 1,
            keys: 1
        },
        {}
    );
    col.ensureIndex(
        {
            targetId: 1,
            keys: 1
        },
        {}
    );
    col.ensureIndex(
        {
            sourceId: 1,
            targetId: 1,
            predicateName: 1
        },
        {}
    );
};
