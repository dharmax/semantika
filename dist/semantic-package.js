"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.SemanticPackage = void 0;
const logged_exception_1 = require("./utils/logged-exception");
const model_manager_1 = require("./model-manager");
const constants_1 = require("./utils/constants");
const ontology_1 = require("./ontology");
const template_processor_1 = require("./utils/template-processor");

class SemanticPackage {
    constructor(name, ontology, storage, parents = []) {
        this.name = name;
        this.storage = storage;
        this.parents = parents;
        this.ontology = new ontology_1.Ontology(this, ontology);
    }

    /**
     * Create an entity instance from a record and possibly from id only. If it is not an entity, it just returns the record unchanged.
     * @param clazz the entity class (the function)
     * @param id the id, if there's no id in the record
     * @param record the record by which to populate the entity
     */
    makeEntity(eDcr, id, record) {
        const idSegments = (id || record?._id).split(constants_1.ID_SEPARATOR);
        if (!eDcr) {
            id = id || record.id || record._id;
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
        record && Object.assign(e, {id}, record);
        // record && Object.assign(e, {id, _etype: eDcr.name}, record)
        return e;
    }

    async loadEntityById(id, ...projection) {
        const idSegments = id.split(constants_1.ID_SEPARATOR);
        const entityTypeName = idSegments[idSegments.length - 2];
        const eDcr = this.ontology.edcr(entityTypeName);
        if (!eDcr)
            throw new Error(`No such entity type ${eDcr}`);
        // @ts-ignore
        return this.loadEntity(id, eDcr, ...projection);
    }

    // noinspection JSUnusedGlobalSymbols
    async predicateById(pid) {
        const pCol = await this.storage.predicateCollection(this, name);
        const record = await pCol.findById(pid, undefined);
        if (record)
            return new model_manager_1.Predicate(this, record);
        for (let parent of this.parents) {
            let p = await parent.predicateById(pid);
            if (p)
                return p;
        }
        return null;
    }

    predicateCollection(pDcr) {
        if (pDcr.semanticPackage === this)
            return this.storage.predicateCollection(this, this.name + '_predications');
        else
            return pDcr.semanticPackage.predicateCollection(pDcr);
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
        return new model_manager_1.Predicate(this, pred);

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
        const pCol = await this.storage.predicateCollection(this, name);
        return pCol.deleteById(predicate.id);
    }

    async deleteAllEntityPredicates(entityId) {
        const pcol = await this.storage.predicateCollection(this, name);
        return pcol.deleteByQuery({
            $or: [
                {sourceId: entityId},
                {targetId: entityId},
            ]
        });
    }

    /**
     * This is the method by which predicates are searched and paged through
     * @param {boolean} incoming specify false for outgoing predicates
     * @param {string|PredicateDcr} predicate the name of the predicate
     * @param {string} entityId the entity id - it would be the source for outgoing predicates and the target for incoming
     * @param {IFindPredicatesOptions} opts
     * @returns {Promise<Object[]}
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
     * @returns {Promise<Object[] | IReadResult>}
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
            predicateName: {$in: predicateNames}
        } : {};
        const whichPeer = incoming ? 'source' : 'target';
        const whichSelf = !incoming ? 'source' : 'target';
        const selfId = whichSelf + 'Id';
        if (entityId)
            query[selfId] = entityId;
        if (opts.peerType && opts.peerType !== '*')
            query[whichPeer + 'Type'] = typeof opts.peerType == 'string' ? opts.peerType : {$in: opts.peerType};
        if (opts.peerId)
            query[whichPeer + 'Id'] = opts.peerId;
        const fieldProjection = (pagination && pagination.projection || []).concat(opts.projection || []);
        pagination && (delete pagination.projection);
        if (pagination) {
            let rr = await pCol.load(pagination, query);
            rr.items = await enrich(rr.items);
            return rr;
        } else {
            const predicates = await pCol.findSome(query);
            return await enrich(predicates);
        }

        async function enrich(predicates) {
            // if projection is specified or peer-type, we should populate the predicates with fields from the peer
            if (opts.projection || opts.peerType) {
                for (let pred of predicates) {
                    const peerType = pred[whichPeer + 'Type'];
                    if (opts.peerType && opts.peerType != '*' && opts.peerType != peerType)
                        continue;
                    pred.peerEntity = await self.loadEntityById(pred[whichPeer + "Id"], ...fieldProjection);
                }
            }
            return predicates.map(p => pagination && pagination.entityOnly ? p.peerEntity : new model_manager_1.Predicate(self, p));
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
        const predicates = await this.storage.predicateCollection(this);
        const sourceId = source['id'] || source;
        const targetId = target['id'] || target;
        const query = {};
        if (bidirectional) {
            query.$or = [{sourceId, targetId},
                {targetId: sourceId, sourceId: targetId}];
        } else {
            query.sourceId = sourceId;
            query.targetId = targetId;
        }
        predicateName && (query.predicateName = predicateName);
        return (await predicates.findSome(query)).map((rec) => new model_manager_1.Predicate(this, rec));
    }

    async collectionForEntityType(eDcr, initFunc) {
        initFunc = initFunc || eDcr.initializer;
        const collectionName = this.name + constants_1.ID_SEPARATOR + (eDcr.collectionName || eDcr.clazz.name);
        return this.storage.entityCollection(collectionName, initFunc, eDcr);
    }

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

function expandPredicate(predicateDcr) {
    if (!predicateDcr)
        return null;
    let childrenNames = Object.keys(predicateDcr.children.map(dcr => dcr.name) || {});
    return [...childrenNames, predicateDcr.name];
}

//# sourceMappingURL=semantic-package.js.map