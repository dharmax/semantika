"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.AbstractEntity = void 0;
const bluebird_1 = require("bluebird");
const template_processor_1 = require("./utils/template-processor");
const storage_1 = require("./storage/storage");
const logger_1 = require("./utils/logger");
const logged_exception_1 = require("./utils/logged-exception");

class AbstractEntity {
    constructor(semanticPackage, id) {
        this.semanticPackage = semanticPackage;
        this.id = id;
    }

    /**
     * compare entities
     * @param entity
     */
    // noinspection JSUnusedGlobalSymbols
    equals(entity) {
        return this === entity || this.id === entity.id || this.id.toString() == entity.id.toString();
    }

    /**
     * @return entity's type name
     */
    typeName() {
        return this.constructor.name;
    }

    /**
     * @return entity's descriptor
     */
    get descriptor() {
        return this.semanticPackage.ontology.edcr(this.typeName());
    }

    /**
     * version (for the optimistic locking mechanism). Used internally.
     */
    get version() {
        return this._version;
    }

    /***
     * @return the template. Normally you'd never have to call that yourself.
     */
    get template() {
        const t = this.constructor['getTemplate'] || this.descriptor.template;
        return t && t() || null;
    }

    /**
     * @return the associated collection for those entity types
     *
     */
    async getAssociatedCollection() {
        return this.semanticPackage.collectionForEntityType(this.descriptor);
    }

    /**
     * Updates the specific fields-values of this entity in the memory and the database. Uses optimistic locking.
     * @param fieldsToUpdate the object with the field to change and their new values
     * @param superSetAllowed set to true if you allow inclusion of fields that aren't in the Entity's template
     * @param cutExtraFields in case superSetAllowed is false, it tells the method whether to fail in case of extra fields or to just warn.
     * @return the updated entity (this) or null on failure
     */
    async update(fieldsToUpdate, superSetAllowed = false, cutExtraFields = false, rawOperations = {}) {
        const col = await this.getAssociatedCollection();
        const fields = template_processor_1.processTemplate(this.template, fieldsToUpdate, superSetAllowed, cutExtraFields, this.typeName(), true);
        const res = await col.updateDocument(this.id, fields, this._version, rawOperations);
        if (res) {
            Object.assign(this, fields, {_version: this._version + 1});
            // @ts-ignore
            return this;
        }
        return null;
    }
    /**
     * populate and returns the specific field's value
     * @param field field name
     */
    async getField(field) {
        await this.getFields(field);
        return this[field];
    }
    /**
     * populate with the specified fields and return their values
     * @param fields the list of fields or non, for the automatic usage of the fields mentioned in the entity's template.
     * @return a map of the values requested
     */
    async getFields(...fields) {
        const missingFields = fields.filter(f => !this[f]);
        const gt = this.template;
        if (gt) {
            const templateFieldNames = new Set(Object.keys(gt));
            for (let f of fields) {
                if (!templateFieldNames.has(f) && !storage_1.StandardFields.includes(f))
                    logger_1.logger.warn(`Field ${f} doesn't appear in the template of ${this.typeName()} entity`);
            }
        }
        await this.populate(...missingFields);
        return fields.reduce((a, f) => {
            a[f] = this[f];
            return a;
        }, {});
    }

    /**
     * Re-read this entity from the database
     */
    async refresh() {
        const e = await this.semanticPackage.loadEntity(this.id, this.descriptor, ...Object.keys(this));
        Object.assign(this, e);
        return this;
    }

    /**
     * populate all the fields defined in the template
     */
    populateAll() {
        return this.populate(...Object.keys(this.template));
    }

    /**
     * This method is sometimes so it would return data that the application logic considers as a "full object", which
     * may mean, it also gathers data from related entities and predicates, etc, etc.
     * @return a DTO with all the entities data, including the basic meta data, by default.
     * @param options optional options :)
     */
    async fullDto(options) {
        const data = await this.getFields(...Object.keys(this.template), '_created', '_lastUpdate');
        data.id = this.id;
        data._entityType = this.typeName();
        return data;
    }

    /**
     * populate the field listed as well as fields projected from predicates (fields that are not in the entity's template,
     * but are in connected predicates, which the projection refer to them).
     * @param projection field names
     */
    async populate(...projection) {
        const col = await this.getAssociatedCollection();
        const predicateProjections = projection && projection.filter(p => typeof p === 'object');
        let fieldsProjection = projection && projection.filter(p => typeof p === 'string');
        const fields = await col.findById(this.id, fieldsProjection && fieldsProjection.length && fieldsProjection || undefined);
        if (!fields)
            return null;
        Object.assign(this, fields);
        await this.populateRelated(predicateProjections);
        // @ts-ignore
        return this;
    }
    async populateRelated(predicateSpecs) {
        for (let ps of predicateSpecs) {
            const preds = ps.in ?
                await this.incomingPreds(ps.pName, {projection: ps.projection})
                : await this.outgoingPreds(ps.pName, {projection: ps.projection});
            this[ps.pName] = preds;
        }
        return this;
    }
    /**
     * Truly deletes an entity along with the predicates connected to it. Use with caution.
     * @returns {Promise<{entityId: any}>}
     */
    async erase() {
        let col = await this.getAssociatedCollection();
        let deleteEntity = col.deleteById(this.id);
        await bluebird_1.all([
            this.semanticPackage.deleteAllEntityPredicates(this.id),
            deleteEntity
        ]);
        return {
            entityId: this.id,
        };
    }

    /**
     * Convenient method for shorter reference to query methods
     */
    get p() {
        const self = this;
        return {
            i: self.incomingPreds,
            ip: self.incomingPredsPaging,
            o: self.outgoingPreds,
            op: self.outgoingPredsPaging
        };
    }

    /**
     * return the outgoing connections of the given type. Could also include the peer, if that's asked for. Predicate
     * hierarchy is taken into account.
     * @param predicate the predicate name or dcr
     * @param opts query options, including enrichment information
     */
    async outgoingPreds(predicate, opts = {}) {
        return this.semanticPackage.findPredicates(false, predicate, this.id, opts);
    }

    /**
     * return the incoming  connections of the given type. Could also include the peer, if that's asked for.
     * Predicate hierarchy is taken into account.
     * @param predicate the predicate name or dcr
     * @param opts query options, including enrichment information
     */
    async incomingPreds(predicate, opts = {}) {
        return this.semanticPackage.findPredicates(true, predicate, this.id, opts);
    }

    /**
     * Like outgoingPreds but with pagination
     * @param predicate
     * @param opts
     * @param pagination pagination parameters
     */
    async outgoingPredsPaging(predicate, opts = {}, pagination) {
        return this.semanticPackage.pagePredicates(false, predicate, this.id, opts, pagination);
    }

    /**
     * Like incomingPreds but with pagination
     * @param predicate
     * @param opts
     * @param pagination pagination parameters
     */
    async incomingPredsPaging(predicate, opts = {}, pagination) {
        return this.semanticPackage.pagePredicates(true, predicate, this.id, opts, pagination);
    }

    /**
     * @return the parent entity if there is one
     */
    async getParent() {
        if (typeof this._parent == 'string') {
            this._parent = await this.semanticPackage.loadEntity(this._parent);
        }
        return this._parent;
    }

    /**
     * This is a sophisticated value inheritance support. If the value is an object, it allow inner-field-level value inheritance
     * @param fieldName
     * @param accumulate - should it accumulate inner-fields for object value ?
     * @param childVal - inner use only
     */
    async getFieldRecursive(fieldName, accumulate = false, childVal = {}) {
        let val = await this.getField(fieldName);
        const parent = await this.getParent();
        if (accumulate) {
            val = Object.assign(val, childVal);
            return parent ? await parent.getFieldRecursive(fieldName, accumulate, val) : val;
        } else {
            if (val)
                return val;
            return parent ? await parent.getFieldRecursive(fieldName, accumulate) : undefined;
        }
    }

    async getAllAncestors() {
        const parent = await this.getParent();
        if (!parent)
            return [];
        // @ts-ignore
        return [parent, ...(await this.parent.getAllAncestors())];
    }

    /**
     * Set a parent entity to this entity
     * @param parent
     */
    async setParent(parent) {
        // prevent circularity
        const parentAncestors = await parent.getAllAncestors();
        parentAncestors.forEach(entity => {
            if (entity.id === this.id)
                throw new logged_exception_1.LoggedException('Circular retailer parenthood attempted');
        });
        return await this.update({_parent: parent.id});
    }

    /**
     * Normally used for database front end etc.
     * @param _iDepth
     * @param _oDepth
     */
    async drill(_iDepth, _oDepth) {
        await this.fullDto();
        return populateConnections(this, _iDepth, _oDepth);

        async function populateConnections(entity, iDepth, oDepth) {
            if (iDepth) {
                const predicates = await entity.incomingPreds(undefined, {peerType: '*'});
                for (const p of predicates)
                    p['peerEntity'] = await populateConnections(p.peer, iDepth - 1, 0);
                entity['_incoming'] = predicates;
            }
            if (oDepth) {
                const predicates = await entity.outgoingPreds(undefined, {peerType: '*'});
                for (const p of predicates)
                    p['peerEntity'] = await populateConnections(p.peer, 0, oDepth - 1);
                entity['_outgoing'] = predicates;
            }
            return entity;
        }
    }
}
exports.AbstractEntity = AbstractEntity;
//# sourceMappingURL=abstract-entity.js.map