import {IRawOntology} from "./raw-ontology";
import {AbstractEntity} from "./abstract-entity";
import {LoggedException} from "./utils/logged-exception";
import {IFindPredicatesOptions, IReadOptions, IReadResult} from "./types";
import {Predicate} from "./model-manager";
import {EntityCollection, IPredicateRecord, PredicateCollection} from "./storage/semantic-collections";
import {ID_SEPARATOR} from "./utils/constants";
import {Ontology} from "./ontology";
import {processTemplate} from "./utils/template-processor";
import {ProjectionItem} from "./projection";
import {EntityDcr, PredicateDcr} from "./descriptors";
import {AbstractStorage} from "./storage/storage";

export class SemanticPackage {

    readonly ontology: Ontology

    constructor(readonly name: string, ontology: IRawOntology, readonly storage: AbstractStorage, readonly parents: SemanticPackage[] = []) {
        this.ontology = new Ontology(this, ontology)
    }

    /**
     * Create an entity instance from a record and possibly from id only. If it is not an entity, it just returns the record unchanged.
     * @param clazz the entity class (the function)
     * @param id the id, if there's no id in the record
     * @param record the record by which to populate the entity
     */
    makeEntity<T extends AbstractEntity>(clazz: string | typeof AbstractEntity, id?, record?): T {
        if (!clazz) {
            id = id || record.id || record._id
            if (!id)
                throw new Error('Need at least a fully qualified ID')
            clazz = id.split(ID_SEPARATOR)[1]
        }
        // TODO check parents' ontologies; manage both dcrs and concretes in SP
        clazz = typeof clazz == 'string' ? this.ontology.edcr(clazz).clazz : clazz
        if (!clazz)
            return record
        const idSegments = record && (id || record._id).split(ID_SEPARATOR)
        const rType = idSegments[idSegments.length - 2]
        if (rType && (rType !== clazz.name))
            throw `Requested entity type ${clazz.name} does not match entity's record of type ${rType}.`
        // @ts-ignore
        let e = new clazz(id)
        record && Object.assign(e, {id, _etype: clazz.name}, record)
        return e
    }

    async loadEntityById<T>(id: string, ...projection: string[]): Promise<T> {
        const entityTypeName = id.split(ID_SEPARATOR)[1]
        const eDcr = this.ontology.edcr(entityTypeName)
        if (!eDcr)
            throw new Error(`No such entity type ${eDcr}`)
        // @ts-ignore
        return eDcr.clazz.createFromDB(eDcr.clazz, id, ...projection)

    }


// noinspection JSUnusedGlobalSymbols
    async predicateById(pid: string) {
        const pCol: PredicateCollection = await this.storage.predicateCollection()
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

    async createPredicate(source: AbstractEntity, pDcr: PredicateDcr, target: AbstractEntity, payload?: Object, selfKeys = {}): Promise<Predicate> {
        let pCol: PredicateCollection = await this.storage.predicateCollection(pDcr)
        let pred: IPredicateRecord = {
            predicateName: pDcr.name,
            sourceId: source.id,
            sourceType: source.constructor.name,
            targetId: target.id,
            targetType: target.constructor.name,
            payload: payload,
            timestamp: Date.now()
        }
        await addKeys()

        let pid = <string>await pCol.append(pred)
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
        let pId = predicate.id
        let pCol = await this.storage.predicateCollection()
        return pCol.deleteById(pId)
    }


    async deleteAllEntityPredicates(entityId: string) {
        let pcol = await this.storage.predicateCollection()
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

        const pCol: PredicateCollection = await this.storage.predicateCollection()


        const predicateDcr = typeof pred === "string" ? this.ontology.pdcr(pred) : pred;
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
                    // const f = self.ontology.edcr(peerType).clazz
                    pred.peerEntity = await self.loadEntityById(pred[whichPeer + "Id"], ...fieldProjection)
                    // pred.peerEntity = await f['createFromDB'](f, pred[whichPeer + "Id"], ...fieldProjection)
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
        const predicates = await this.storage.predicateCollection()
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

    async predicateCollection(name?: string, initFunc?: (col: PredicateCollection) => void): Promise<PredicateCollection> {
        return this.storage.predicateCollection(name)
    }

    async collectionForEntityType(eDcr: EntityDcr, initFunc?: (col: EntityCollection) => void): Promise<EntityCollection> {
        initFunc = initFunc || eDcr.initializer
        const collectionName = eDcr.collectionName || eDcr.clazz.name;
        return this.storage.entityCollection(collectionName, initFunc, eDcr)
    }


    async createEntity<T extends AbstractEntity>(eDcr: EntityDcr, fields: Object, superSetAllowed = false, cutExtraFields = true): Promise<T> {
        fields = processTemplate(eDcr.template, fields, superSetAllowed, cutExtraFields, eDcr.clazz.name)
        const record = fields
        const col = await this.collectionForEntityType(eDcr)
        let id = await col.append(record)
        return <T>this.makeEntity(eDcr.clazz, id, record)
    }

    async loadEntity<T extends AbstractEntity>(entityId: any, eDcr: EntityDcr, ...projection: ProjectionItem[]): Promise<T> {
        if (!entityId)
            throw new LoggedException('No entity id!')
        let e = <T>this.makeEntity(eDcr.clazz, entityId)
        return e.populate(...projection)
    }

}

function expandPredicate(predicateDcr: PredicateDcr): string[] {
    if (!predicateDcr)
        return null
    let childrenNames = Object.keys(predicateDcr.children.map(dcr => dcr.name) || {})
    return [...childrenNames, predicateDcr.name]
}

