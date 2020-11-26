import {IRawOntology} from "./raw-ontology";
import {AbstractEntity} from "./abstract-entity";
import {LoggedException} from "./utils/logged-exception";
import {IFindPredicatesOptions, IReadOptions, IReadResult} from "./types";
import {Predicate} from "./model-manager";
import {
    ArtifactCollection,
    EntityCollection,
    IPredicateRecord,
    PredicateCollection
} from "./storage/semantic-collections";
import {ID_SEPARATOR} from "./utils/constants";
import {Ontology} from "./ontology";
import {processTemplate} from "./utils/template-processor";
import {ProjectionItem} from "./projection";
import {EntityDcr, PredicateDcr} from "./descriptors";
import {AbstractStorage, IPhysicalCollection} from "./storage/storage";
import {Mutex} from "./utils/mutex";

export class SemanticPackage {

    readonly ontology: Ontology
    private collectionManager: CollectionManager;

    constructor(readonly name: string, ontology: IRawOntology, readonly storage: AbstractStorage, readonly parents: SemanticPackage[] = []) {
        this.ontology = new Ontology(this, ontology)
        this.collectionManager = new CollectionManager(this, storage)
    }

    /**
     * Create an entity instance from a record and possibly from id only. If it is not an entity, it just returns the record unchanged.
     * @param eDcr
     * @param id the id, if there's no id in the record
     * @param record the record by which to populate the entity
     */
    makeEntity<T extends AbstractEntity>(eDcr?: EntityDcr, id?, record?): T {
        const idSegments = (id || record?._id).split(ID_SEPARATOR)
        if (!eDcr) {
            id = id || record.id || record._id
            if (!id)
                throw new Error('Need at least a fully qualified ID')
            eDcr = this.ontology.edcr(idSegments[idSegments.length - 2])
        }
        // TODO check parents' ontologies; manage both dcrs and concretes in SP
        if (!eDcr)
            return record
        const rType = idSegments[idSegments.length - 2]
        if (rType && (rType !== eDcr.name))
            throw `Requested entity type ${eDcr.name} does not match entity's record of type ${rType}.`
        // @ts-ignore
        let e = new eDcr.clazz(this, id)
        record && Object.assign(e, {id}, record)
        // record && Object.assign(e, {id, _etype: eDcr.name}, record)
        return e
    }

    async loadEntityById<T>(id: string, ...projection: string[]): Promise<T> {
        const idSegments = id.split(ID_SEPARATOR);
        const entityTypeName = idSegments[idSegments.length - 2]
        const eDcr = this.ontology.edcr(entityTypeName)
        if (!eDcr)
            throw new Error(`No such entity type ${eDcr}`)
        // @ts-ignore
        return this.loadEntity(id, eDcr, ...projection)
    }


// noinspection JSUnusedGlobalSymbols
    async predicateById(pid: string) {
        const pCol: PredicateCollection = await this.collectionManager.predicateCollection(pid)
        const record = <IPredicateRecord>await pCol.findById(pid, undefined)
        if (record)
            return new Predicate(this, record)
        for (let parent of this.parents) {
            let p = await parent.predicateById(pid)
            if (p)
                return p
        }
        return null
    }

    predicateCollection(pDcr: PredicateDcr): Promise<PredicateCollection> {
        return this.collectionManager.predicateCollection(pDcr)
    }

    async createPredicate(source: AbstractEntity, pDcr: PredicateDcr, target: AbstractEntity, payload?: Object, selfKeys = {}): Promise<Predicate> {
        const pCol: PredicateCollection = await this.predicateCollection(pDcr)
        const pred: IPredicateRecord = {
            predicateName: pDcr.name,
            sourceId: source.id,
            sourceType: source.constructor.name,
            targetId: target.id,
            targetType: target.constructor.name,
            payload: payload,
            timestamp: Date.now()
        }
        await addKeys()

        const pid = <string>await pCol.append(pred)
        pred['id'] = pred._id = pid
        return new Predicate(this, pred)

        async function addKeys() {

            await addKeyForEntity('target', target)
            await addKeyForEntity('source', source)

            // validate and assign self-keys
            const recordKeys = Object.keys(pred)
            Object.keys(selfKeys).forEach(k => {
                if (recordKeys.includes(k))
                    throw new LoggedException(`Bad predicate self-key: ${k}`)
                pred[k] = selfKeys[k]
            })

            async function addKeyForEntity(sideName, e) {
                const fieldNames = pDcr.keys[sideName]
                if (!fieldNames || !fieldNames.length)
                    return
                const fields = await e.getFields(...fieldNames)
                Object.entries(fields).forEach(([f, v]) => {
                    pred[`_${sideName}_${f}`] = v
                })
            }


        }
    }


    async deletePredicate(predicate: Predicate) {
        const pCol = await this.collectionManager.predicateCollection(predicate)
        return pCol.deleteById(predicate.id)
    }


    async deleteAllEntityPredicates(entityId: string) {
        // TODO this is db-dependent and also dependent on a single pred collection - should be improved
        const pcol = await this.collectionManager.predicateCollection()
        return pcol.deleteByQuery({
            $or: [
                {sourceId: entityId},
                {targetId: entityId},
            ]
        })
    }

    /**
     * This is the method by which predicates are searched and paged through
     * @param {boolean} incoming specify false for outgoing predicates
     * @param {string|PredicateDcr} predicate the name of the predicate
     * @param {string} entityId the entity id - it would be the source for outgoing predicates and the target for incoming
     * @param {IFindPredicatesOptions} opts
     * @returns {Promise<Object[]}
     */
    async findPredicates(incoming: boolean, predicate: string | PredicateDcr, entityId: string, opts: IFindPredicatesOptions = {}): Promise<Predicate[]> {
        // noinspection ES6MissingAwait
        return <Promise<Predicate[]>>this.loadPredicates(incoming, predicate, entityId, opts, null)
    }


    /**
     * This is the method by which predicates are searched and paged through
     * @param {boolean} incoming specify false for outgoing predicates
     * @param {string|PredicateDcr} predicate the name of the predicate
     * @param {string} entityId the entity id - it would be the source for outgoing predicates and the target for incoming
     * @param {IFindPredicatesOptions} opts
     * @param {IReadOptions} pagination parameters. Null will return an array instead of IReadResult
     * @returns {Promise<Object[] | IReadResult>}
     */
    async pagePredicates(incoming: boolean, predicate: string | PredicateDcr, entityId: string, opts: IFindPredicatesOptions = {}, pagination: IReadOptions): Promise<IReadResult> {
        // noinspection ES6MissingAwait
        return <Promise<IReadResult>>this.loadPredicates(incoming, predicate, entityId, opts, pagination)
    }


    async loadPredicates(incoming: boolean, pred: string | PredicateDcr, entityId: string, opts: IFindPredicatesOptions = {}, pagination: IReadOptions): Promise<Predicate[] | IReadResult | AbstractEntity[]> {

        const self = this

        const predicateDcr = typeof pred === "string" ? this.ontology.pdcr(pred) : pred;
        const pCol: PredicateCollection = await this.predicateCollection(predicateDcr)

        const predicateNames = expandPredicate(predicateDcr)
        let query: any = predicateNames ? {
            predicateName: {$in: predicateNames}
        } : {};

        const whichPeer = incoming ? 'source' : 'target'
        const whichSelf = !incoming ? 'source' : 'target'
        const selfId = whichSelf + 'Id'
        if (entityId) query[selfId] = entityId
        if (opts.peerType && opts.peerType !== '*')
            query[whichPeer + 'Type'] = typeof opts.peerType == 'string' ? opts.peerType : {$in: opts.peerType}
        if (opts.peerId)
            query[whichPeer + 'Id'] = opts.peerId

        const fieldProjection = (pagination && pagination.projection || []).concat(opts.projection || [])
        pagination && (delete pagination.projection)

        if (pagination) {
            let rr: IReadResult = await pCol.load(pagination, query)
            rr.items = await enrich(<IPredicateRecord[]>rr.items)
            return rr
        } else {
            const predicates: IPredicateRecord[] = await pCol.findSome(query)
            return <Predicate[]>await enrich(predicates)
        }

        async function enrich(predicates: IPredicateRecord[]) {
            // if projection is specified or peer-type, we should populate the predicates with fields from the peer
            if (opts.projection || opts.peerType) {
                for (let pred of predicates) {
                    const peerType = pred[whichPeer + 'Type']
                    if (opts.peerType && opts.peerType != '*' && opts.peerType != peerType)
                        continue
                    pred.peerEntity = await self.loadEntityById(pred[whichPeer + "Id"], ...fieldProjection)
                }
            }
            return predicates.map(p => pagination && pagination.entityOnly ? p.peerEntity : new Predicate(self, p))
        }

    }

    /**
     * @param source either entity or its id
     * @param target either entity or its id
     * @param bidirectional check both directions of predicates
     * @param predicateName optionally look for specific predicate type
     * @return the list of predicates directly between these two entities
     */
    async predicatesBetween(source: AbstractEntity | string, target: AbstractEntity | string, bidirectional: boolean, predicateName?: string): Promise<Predicate[]> {
        if (!source || !target)
            return []
        const predicates = await this.collectionManager.predicateCollection()
        const sourceId = source['id'] || source
        const targetId = target['id'] || target
        const query: any = {}
        if (bidirectional) {
            query.$or = [{sourceId, targetId},
                {targetId: sourceId, sourceId: targetId}]
        } else {
            query.sourceId = sourceId
            query.targetId = targetId
        }
        predicateName && (query.predicateName = predicateName)
        return (await predicates.findSome(query)).map((rec: IPredicateRecord) => new Predicate(this, rec))
    }


    async collectionForEntityType(eDcr: EntityDcr, initFunc?: (col: EntityCollection) => void): Promise<EntityCollection> {
        initFunc = initFunc || eDcr.initializer
        return this.collectionManager.entityCollection(initFunc, eDcr)
    }


    async createEntity<T extends AbstractEntity>(eDcr: EntityDcr, fields: Object, superSetAllowed = false, cutExtraFields = true): Promise<T> {
        fields = processTemplate(eDcr.template, fields, superSetAllowed, cutExtraFields, eDcr.clazz.name)
        const record = fields
        const col = await this.collectionForEntityType(eDcr)
        let id = await col.append(record)
        return <T>this.makeEntity(eDcr, id, record)
    }

    async loadEntity<T extends AbstractEntity>(entityId: any, eDcr?: EntityDcr, ...projection: ProjectionItem[]): Promise<T> {
        if (!entityId)
            throw new LoggedException('No entity id!')
        let e = <T>this.makeEntity(eDcr, entityId)
        return e.populate(...projection)
    }

}

function expandPredicate(predicateDcr: PredicateDcr): string[] {
    if (!predicateDcr)
        return null
    let childrenNames = Object.keys(predicateDcr.children.map(dcr => dcr.name) || {})
    return [...childrenNames, predicateDcr.name]
}


class CollectionManager {
    collectionMutex = new Mutex();
    collections: { [name: string]: ArtifactCollection } = {}

    constructor(private semanticPackage, private storage: AbstractStorage) {
    }

    entityCollection(initFunc: (col: EntityCollection) => void, eDcr: EntityDcr): EntityCollection | Promise<EntityCollection> {
        const collectionName = this.semanticPackage.name + ID_SEPARATOR + (eDcr.collectionName || eDcr.clazz.name);
        return this.collectionForName(collectionName, false, c => this.storage.makeEntityCollection(c, eDcr, initFunc))
    }

    async predicateCollection(p?: Predicate | string | PredicateDcr): Promise<PredicateCollection> {
        if (typeof p == 'string')
            return this.collectionForName(p, true, c => this.storage.makePredicateCollection(this.semanticPackage, c))
        // @ts-ignore
        const pDcr: PredicateDcr = p && p.constructor.name === 'PredicateDcr' ? p : (p as Predicate).dcr

        const collectionName = pDcr.collectionName || (this.semanticPackage.name + ID_SEPARATOR + '_Predicates')
        return this.collectionForName(collectionName, true, c => this.storage.makePredicateCollection(this.semanticPackage, c))
    }

    async collectionForName<T extends ArtifactCollection>(name: string, forPredicate: boolean, wrapper: (pc: IPhysicalCollection) => ArtifactCollection): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.collectionMutex.lock(() => {
                let col = this.collections[name]
                if (col) {
                    this.collectionMutex.release()
                    resolve(col as T)
                } else {
                    this.storage.getPhysicalCollection(name, forPredicate).then(physicalCollection => {
                        const newCollection = wrapper(physicalCollection)
                        this.collections[name] = newCollection
                        this.collectionMutex.release()
                        resolve(newCollection as T);
                    }).catch((e) => {
                        this.collectionMutex.release()
                        reject(e)
                    })
                }
            })
        })

    }
}



