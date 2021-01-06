"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticPackage = void 0;
const logged_exception_1 = require("./utils/logged-exception");
const predicate_1 = require("./predicate");
const constants_1 = require("./utils/constants");
const ontology_1 = require("./ontology");
const template_processor_1 = require("./utils/template-processor");
const mutex_1 = require("./utils/mutex");
/**
 * A Semantic package represents and contains semantic artifacts and provides the API to manage them and query them.
 * Semantic packages can extend other semantic packages and thus logically be a super-set of their contents. Often
 * one semantic package is enough for an applicatin, but not always.
 *
 * @todo add an aggregation of inherited query results
 */
class SemanticPackage {
    /**
     * @param name name of semantic package
     * @param ontology the ontology associated with the SP
     * @param storage the storage for the semantic artifacts
     * @param parents optional parent semantic packages, that this one will extend
     */
    constructor(name, ontology, storage, parents = []) {
        this.name = name;
        this.storage = storage;
        this.parents = parents;
        this.ontology = new ontology_1.Ontology(this, ontology);
        this.collectionManager = new CollectionManager(this, storage);
    }
    /**
     * Internal
     * Create an entity instance from a record and possibly from id only. If it is not an entity, it just returns the record unchanged.
     * @param eDcr
     * @param id the id, if there's no id in the record
     * @param record the record by which to populate the entity
     */
    makeEntity(eDcr, id, record) {
        id = id || (record?._id || record?.id);
        if (!id)
            return null;
        const idSegments = id.split(constants_1.ID_SEPARATOR);
        if (!eDcr) {
            if (!id)
                throw new Error('Need at least a fully qualified ID');
            eDcr = this.ontology.edcr(idSegments[idSegments.length - 2]);
        }
        // TODO check parents' ontologies; manage both dcrs and concretes in SP
        if (!eDcr)
            return record;
        const rType = idSegments[idSegments.length - 2];
        if (rType && (rType !== eDcr.name))
            throw `Requested entity type ${eDcr.name} does not match entity's record of type ${rType}.`;
        // @ts-ignore
        let e = new eDcr.clazz(this, id);
        record && Object.assign(e, { id }, record);
        // record && Object.assign(e, {id, _etype: eDcr.name}, record)
        return e;
    }
    /**
     * internal
     * @param id
     * @param projection
     */
    async loadEntityById(id, ...projection) {
        const idSegments = id.split(constants_1.ID_SEPARATOR);
        const entityTypeName = idSegments[idSegments.length - 2];
        const eDcr = this.ontology.edcr(entityTypeName);
        if (!eDcr)
            throw new Error(`No such entity type ${eDcr}`);
        // @ts-ignore
        return this.loadEntity(id, eDcr, ...projection);
    }
    async predicateById(pid) {
        const pCol = await this.collectionManager.predicateCollection(pid);
        const record = await pCol.findById(pid, undefined);
        if (record)
            return new predicate_1.Predicate(this, record);
        for (let parent of this.parents) {
            let p = await parent.predicateById(pid);
            if (p)
                return p;
        }
        return null;
    }
    predicateCollection(pDcr) {
        return this.collectionManager.predicateCollection(pDcr);
    }
    basicCollection(name, initFunc) {
        return this.collectionManager.basicCollection(name, initFunc);
    }
    async createPredicate(source, pDcr, target, payload, selfKeys = {}) {
        const pCol = await this.predicateCollection(pDcr);
        const pred = {
            predicateName: pDcr.name,
            sourceId: source.id,
            sourceType: source.constructor.name,
            targetId: target.id,
            targetType: target.constructor.name,
            payload: payload,
            timestamp: Date.now()
        };
        await addKeys();
        const pid = await pCol.append(pred);
        pred['id'] = pred._id = pid;
        return new predicate_1.Predicate(this, pred);
        async function addKeys() {
            await addKeyForEntity('target', target);
            await addKeyForEntity('source', source);
            // validate and assign self-keys
            const recordKeys = Object.keys(pred);
            Object.keys(selfKeys).forEach(k => {
                if (recordKeys.includes(k))
                    throw new logged_exception_1.LoggedException(`Bad predicate self-key: ${k}`);
                pred[k] = selfKeys[k];
            });
            async function addKeyForEntity(sideName, e) {
                const fieldNames = pDcr.keys[sideName];
                if (!fieldNames || !fieldNames.length)
                    return;
                const fields = await e.getFields(...fieldNames);
                Object.entries(fields).forEach(([f, v]) => {
                    pred[`_${sideName}_${f}`] = v;
                });
            }
        }
    }
    async deletePredicate(predicate) {
        const pCol = await this.collectionManager.predicateCollection(predicate);
        return pCol.deleteById(predicate.id);
    }
    async deleteAllEntityPredicates(entityId) {
        // TODO this is db-dependent and also dependent on a single pred collection - should be improved
        const pcol = await this.collectionManager.predicateCollection();
        return pcol.deleteByQuery({
            $or: [
                { sourceId: entityId },
                { targetId: entityId },
            ]
        });
    }
    /**
     * This is the method by which predicates are searched and paged through
     * @param {boolean} incoming specify false for outgoing predicates
     * @param {string|PredicateDcr} predicate the name of the predicate
     * @param {string} entityId the entity id - it would be the source for outgoing predicates and the target for incoming
     * @param {IFindPredicatesOptions} opts
     * @return all the predicates adhering to the query, populated according to the provided options
     */
    async findPredicates(incoming, predicate, entityId, opts = {}) {
        // noinspection ES6MissingAwait
        return this.loadPredicates(incoming, predicate, entityId, opts, null);
    }
    /**
     * This is the method by which predicates are searched and paged through
     * @param {boolean} incoming specify false for outgoing predicates
     * @param {string|PredicateDcr} predicate the name of the predicate
     * @param {string} entityId the entity id - it would be the source for outgoing predicates and the target for incoming
     * @param {IFindPredicatesOptions} opts
     * @param {IReadOptions} pagination parameters. Null will return an array instead of IReadResult
     * @return all the predicates adhering to the query, populated according to the provided options and the pagination setting
     */
    async pagePredicates(incoming, predicate, entityId, opts = {}, pagination) {
        // noinspection ES6MissingAwait
        return this.loadPredicates(incoming, predicate, entityId, opts, pagination);
    }
    async loadPredicates(incoming, pred, entityId, opts = {}, pagination) {
        const self = this;
        const predicateDcr = typeof pred === "string" ? this.ontology.pdcr(pred) : pred;
        const pCol = await this.predicateCollection(predicateDcr);
        const predicateNames = expandPredicate(predicateDcr);
        let query = predicateNames ? {
            predicateName: { $in: predicateNames }
        } : {};
        const whichPeer = incoming ? 'source' : 'target';
        const whichSelf = !incoming ? 'source' : 'target';
        const selfId = whichSelf + 'Id';
        if (entityId)
            query[selfId] = entityId;
        if (opts.peerType && opts.peerType !== '*')
            query[whichPeer + 'Type'] = typeof opts.peerType == 'string' ? opts.peerType : { $in: opts.peerType };
        if (opts.peerId)
            query[whichPeer + 'Id'] = opts.peerId;
        const fieldProjection = (pagination && pagination.projection || []).concat(opts.projection || []);
        pagination && (delete pagination.projection);
        if (pagination) {
            let rr = await pCol.load(pagination, query);
            rr.items = await enrich(rr.items);
            return rr;
        }
        else {
            const predicates = await pCol.findSome(query);
            return await enrich(predicates);
        }
        async function enrich(predicates) {
            // if projection is specified or peer-type, we should populate the predicates with fields from the peer
            if (opts.projection || opts.peerType) {
                for (let pred of predicates) {
                    const peerType = pred[whichPeer + 'Type'];
                    if (opts.peerType && opts.peerType !== '*' && opts.peerType !== peerType)
                        continue;
                    pred.peerEntity = await self.loadEntityById(pred[whichPeer + "Id"], ...fieldProjection);
                }
            }
            return predicates.map(p => pagination && pagination.entityOnly ? p.peerEntity : new predicate_1.Predicate(self, p));
        }
    }
    /**
     * @param source either entity or its id
     * @param target either entity or its id
     * @param bidirectional check both directions of predicates
     * @param predicateName optionally look for specific predicate type
     * @return the list of predicates directly between these two entities
     */
    async predicatesBetween(source, target, bidirectional, predicateName) {
        if (!source || !target)
            return [];
        const predicates = await this.collectionManager.predicateCollection();
        const sourceId = source['id'] || source;
        const targetId = target['id'] || target;
        const query = {};
        if (bidirectional) {
            query.$or = [{ sourceId, targetId },
                { targetId: sourceId, sourceId: targetId }];
        }
        else {
            query.sourceId = sourceId;
            query.targetId = targetId;
        }
        predicateName && (query.predicateName = predicateName);
        return (await predicates.findSome(query)).map((rec) => new predicate_1.Predicate(this, rec));
    }
    /**
     * Return the collection for the entity type
     * @param eDcr denotes the entity type
     * @param initFunc if it's a new collection, you can give it an init function (e.g. for index creation)
     */
    async collectionForEntityType(eDcr, initFunc) {
        initFunc = initFunc || eDcr.initializer;
        return this.collectionManager.entityCollection(initFunc, eDcr);
    }
    /**
     * Creates a new entity.
     * @param eDcr the descriptor of the entity to be created
     * @param fields data
     * @param superSetAllowed set to true allow fields that don't appear in the template
     * @param cutExtraFields set to true to silently remove fields that don't appear in the template or throw an error
     */
    async createEntity(eDcr, fields, superSetAllowed = false, cutExtraFields = true) {
        fields = template_processor_1.processTemplate(eDcr.template, fields, superSetAllowed, cutExtraFields, eDcr.clazz.name);
        const record = fields;
        const col = await this.collectionForEntityType(eDcr);
        let id = await col.append(record);
        return this.makeEntity(eDcr, id, record);
    }
    async loadEntity(entityId, eDcr, ...projection) {
        if (!entityId)
            throw new logged_exception_1.LoggedException('No entity id!');
        let e = this.makeEntity(eDcr, entityId);
        return e.populate(...projection);
    }
}
exports.SemanticPackage = SemanticPackage;
/**
 * expand a given predicate dcr to the list dcr names that include the inherited predicates
 * @param predicateDcr
 */
function expandPredicate(predicateDcr) {
    if (!predicateDcr)
        return null;
    let childrenNames = Object.keys(predicateDcr.children.map(dcr => dcr.name) || {});
    return [...childrenNames, predicateDcr.name];
}
/**
 * Create the collections lazily
 */
class CollectionManager {
    constructor(semanticPackage, storage) {
        this.semanticPackage = semanticPackage;
        this.storage = storage;
        this.collectionMutex = new mutex_1.Mutex();
        this.collections = {};
    }
    entityCollection(initFunc, eDcr) {
        const collectionName = this.semanticPackage.name + constants_1.ID_SEPARATOR + (eDcr.collectionName || eDcr.clazz.name);
        return this.collectionForName(collectionName, false, c => this.storage.makeEntityCollection(c, eDcr, initFunc));
    }
    basicCollection(name, initFunc) {
        const collectionName = this.semanticPackage.name + constants_1.ID_SEPARATOR + name;
        return this.collectionForName(collectionName, false, c => this.storage.makeBasicCollection(c, initFunc));
    }
    async predicateCollection(p) {
        if (p && typeof p == 'string')
            return this.collectionForName(p, true, c => {
                const col = this.storage.makePredicateCollection(this.semanticPackage, c);
                predicateInitFunction(col);
                return col;
            });
        // @ts-ignore
        const pDcr = p?.constructor.name === 'PredicateDcr' ? p : p?.dcr;
        const collectionName = pDcr?.collectionName || (this.semanticPackage.name + constants_1.ID_SEPARATOR + '_Predicates');
        return this.collectionForName(collectionName, true, c => this.storage.makePredicateCollection(this.semanticPackage, c));
    }
    async collectionForName(name, forPredicate, wrapper) {
        return new Promise((resolve, reject) => {
            this.collectionMutex.lock(() => {
                let col = this.collections[name];
                if (col) {
                    this.collectionMutex.release();
                    resolve(col);
                }
                else {
                    this.storage.getPhysicalCollection(name, forPredicate).then(physicalCollection => {
                        const newCollection = wrapper(physicalCollection);
                        this.collections[name] = newCollection;
                        this.collectionMutex.release();
                        resolve(newCollection);
                    }).catch((e) => {
                        this.collectionMutex.release();
                        reject(e);
                    });
                }
            });
        });
    }
}
const predicateInitFunction = col => {
    col.ensureIndex({
        predicateName: 1,
        sourceId: 1,
        targetType: 1
    }, {});
    col.ensureIndex({
        predicateName: 1,
        targetId: 1,
        sourceType: 1
    }, {});
    col.ensureIndex({
        sourceId: 1,
        keys: 1
    }, {});
    col.ensureIndex({
        targetId: 1,
        keys: 1
    }, {});
    col.ensureIndex({
        sourceId: 1,
        targetId: 1,
        predicateName: 1
    }, {});
};
//# sourceMappingURL=semantic-package.js.map