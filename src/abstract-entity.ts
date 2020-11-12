import {all, map, props} from 'bluebird'
import {SemanticPackage} from "./semantic-package";
import {processTemplate} from "./utils/template-processor";
import {ProjectionItem, ProjectionPredicateItem} from "./projection";
import {StandardFields} from "./storage/storage";
import {IFindPredicatesOptions, IReadOptions, IReadResult} from "./types";
import {Predicate} from "./model-manager";
import {EntityDcr, PredicateDcr} from "./descriptors";
import {logger} from "./utils/logger";

declare class User {

    static createFromDB(User: User, uid: any)
}

export abstract class AbstractEntity {

    private _version: number
    private permissionOwners

    /**
     *
     * Optional non default name for the entities associated collection
     */
    // static readonly collectionName = 'PodCollection'


    constructor(readonly semanticPackage: SemanticPackage, readonly id) {
    }


    // noinspection JSUnusedGlobalSymbols
    equals(entity: AbstractEntity): boolean {
        return this === entity || this.id === entity.id || this.id.toString() == entity.id.toString()
    }

    abstract getContainers(): Promise<AbstractEntity[]>

    typeName() {
        return this.constructor.name
    }

    get descriptor(): EntityDcr {
        return this.semanticPackage.ontology.edcr(this.typeName())
    }

    get version() {
        return this._version
    }

    get template() {
        const t = this.constructor['getTemplate']
        return t && t() || null
    }

    async getAssociatedCollection() {
        return this.semanticPackage.collectionForEntityType(this.descriptor)
    }

    async getPermissionOwners(): Promise<{ role, userId, userInfo }[]> {
        return map(this.semanticPackage.findPredicates(true, 'has-role-in', this.id, {
            peerType: 'User',
            projection: ['name', 'pictureUrl', 'city']
        }), async p => {
            return {
                role: p.payload,
                userId: p.sourceId,
                userInfo: await p.getSource('name', 'email')
            }
        })
    }

    /**
     * Updates the specific fields-values of this entity in the memory and the database. Uses optimistic locking.
     * @param fieldsToUpdate the object with the field to change and their new values
     * @param superSetAllowed set to true if you allow inclusion of fields that aren't in the Entity's template
     * @param cutExtraFields in case superSetAllowed is false, it tells the method whether to fail in case of extra fields or to just warn.
     * @return the updated entity (this) or null on failure
     */
    async update<T extends AbstractEntity>(fieldsToUpdate: Object, superSetAllowed = false, cutExtraFields = false, rawOperations = {}): Promise<T> {
        const col = await this.getAssociatedCollection()
        const fields = processTemplate(this.template, fieldsToUpdate, superSetAllowed, cutExtraFields, this.typeName(), true)
        const res = await col.updateDocument(this.id, fields, this._version, rawOperations)
        if (res) {
            Object.assign(this, fields, {_version: this._version + 1})
            // @ts-ignore
            return this
        }
        return null
    }

    /**
     * populate and returns the specific field's value
     * @param field field name
     */
    async getField<T>(field: string): Promise<T> {
        await this.getFields(field)
        return this[field]
    }

    /**
     * populate with the specified fields and return their values
     * @param fields the list of fields or non, for the automatic usage of the fields mentioned in the entity's template.
     * @return a map of the values requested
     */
    async getFields(...fields: string[]): Promise<{ [name: string]: any }> {
        const missingFields = fields.filter(f => !this[f])
        const gt = this.template
        if (gt) {
            const templateFieldNames = new Set(Object.keys(gt))
            for (let f of fields) {
                if (!templateFieldNames.has(f) && !StandardFields.includes(f))
                    logger.warn(`Field ${f} doesn't appear in the template of ${this.typeName()} entity`)
            }
        }
        await this.populate(...missingFields)
        return fields.reduce((a, f) => {
            a[f] = this[f]
            return a
        }, {})
    }

    async refresh<T extends AbstractEntity>() {

        // @ts-ignore
        const e = await this.constructor.createFromDB(this.constructor, this.id, ...Object.keys(this))
        Object.assign(this, e)
        return this
    }


    populateAll<T extends AbstractEntity>(): Promise<T> {
        return this.populate(...Object.keys(this.template))
    }

    async fullDto<T>(options?: unknown): Promise<T> {
        const data = await this.getFields(...Object.keys(this.template), '_created', '_lastUpdate')
        data.id = this.id
        data._entityType = this.typeName()
        return data as T;
    }

    async populate<E extends AbstractEntity>(...projection: ProjectionItem[]): Promise<E> {
        const col = await this.getAssociatedCollection()
        const self = this
        const predicateProjections = projection && projection.filter(p => typeof p === 'object') as ProjectionPredicateItem[]
        let fieldsProjection = projection && projection.filter(p => typeof p === 'string') as string[]
        let results: any = await props({
            data: await col.findById(this.id, fieldsProjection && fieldsProjection.length && fieldsProjection || undefined),
            permissionOwners: self.permissionOwners || await this.getPermissionOwners()
        })
        if (!results.data)
            return undefined
        Object.assign(this, results.data)
        this.permissionOwners = results.permissionOwnersen
        await this.populateRelated(predicateProjections)

        // @ts-ignore
        return this
    }

    private async populateRelated(predicateSpecs: ProjectionPredicateItem[]): Promise<AbstractEntity> {
        for (let ps of predicateSpecs) {
            const preds = ps.in ?
                await this.incomingPreds(ps.pName, {projection: ps.projection as string[]})
                : await this.outgoingPreds(ps.pName, {projection: ps.projection as string[]})
            this[ps.pName] = preds
        }
        return this
    }

    /**
     * Truly deletes an entity along with the predicates connected to it. Use with caution.
     * @returns {Promise<{entityId: any}>}
     */
    async erase() {
        let col = await this.getAssociatedCollection()
        let deleteEntity = col.deleteById(this.id)
        await all([
            this.semanticPackage.deleteAllEntityPredicates(this.id),
            deleteEntity
        ])
        return {
            entityId: this.id,
        }
    }

    /**
     * This method is part of the notification logic. The notification service uses it to see to whom to notify about
     * something.
     * @return the id-s of users which are interesting in events that happens to this specific entity
     * @param eventType the event type
     */
    async getInterestedParties(eventType: string): Promise<User[]> {

        // this is the default logic: it returns all the permission holders on the entities, per any eventType

        let userIds = (await this.getPermissionOwners()).map(po => po.userId)

        let containers = await this.getContainers()
        containers && containers.forEach(async c => userIds.push(...(await c.getInterestedParties(eventType))))

        return Promise.all(userIds.map(uid => <Promise<User>>this.semanticPackage.loadEntity('User', uid)))
    }

    async outgoingPreds(predicate: string | PredicateDcr, opts: IFindPredicatesOptions = {}): Promise<Predicate[]> {
        return this.semanticPackage.findPredicates(false, predicate, this.id, opts)
    }

    async incomingPreds(predicate: string | PredicateDcr, opts: IFindPredicatesOptions = {}): Promise<Predicate[]> {
        return this.semanticPackage.findPredicates(true, predicate, this.id, opts)
    }

    async outgoingPredsPaging(predicate: string | PredicateDcr, opts: IFindPredicatesOptions = {}, pagination: IReadOptions): Promise<IReadResult> {
        return this.semanticPackage.pagePredicates(false, predicate, this.id, opts, pagination)
    }


    async incomingPredsPaging(predicate: string | PredicateDcr, opts: IFindPredicatesOptions = {}, pagination: IReadOptions): Promise<IReadResult> {
        return this.semanticPackage.pagePredicates(true, predicate, this.id, opts, pagination)
    }

    // /**
    //  * This is a sophisticated value inheritance support. If the value is an object, it allow inner-field-level value inheritance
    //  * @param fieldName
    //  * @param accumulate - should it accumulate inner-fields for object value ?
    //  * @param childVal - inner use only
    //  */
    //
    // async getFieldRecursive(fieldName: string, accumulate = false, childVal = {}) {
    //     let val = await this.getField(fieldName)
    //     if (accumulate) {
    //         const parent = await this.getParent()
    //         val = Object.assign(val, childVal)
    //         return parent ? await parent.getFieldRecursive(fieldName, accumulate, val) : val
    //
    //     } else {
    //         if (val)
    //             return val
    //
    //         const parent = await this.getParent()
    //         return parent ? await parent.getFieldRecursive(fieldName, accumulate) : undefined
    //     }
    //
    // }
    // //
    // protected async getParent<T extends AbstractEntity>(): Promise<T> {
    //     return this.parent || this.incomingPreds('parent-of').then(p => p.length && p[0].getSource()).then(t => this.parent = <T>t || undefined)
    // }
    //
    // protected async getAllAncestors<T extends AbstractEntity>(): Promise<T[]> {
    //
    //     const parent: T = <T>await this.getParent()
    //     if (!parent)
    //         return []
    //     return [parent].concat(<T[]>await parent.getAllAncestors())
    // }

    async unsetParent() {
        return this.incomingPreds('parent-of').then(preds =>
            preds && Promise.all(preds.map(p => p.erase())))
    }

    // async setParent<T extends AbstractEntity>(parent: T) {
    //
    //     await this.unsetParent()
    //
    //     // prevent circularity
    //     const parentAncestors = await parent.getAllAncestors()
    //     parentAncestors.forEach(entity => {
    //         if (entity.id === this.id)
    //             throw new LoggedException('Circular retailer parenthood attempted')
    //     })
    //
    //     return this.semanticPackage.createPredicate(parent, 'parent-of', this)
    // }

    async query(_iDepth, _oDepth) {

        await this.fullDto()
        return populateConnections(this, _iDepth, _oDepth)

        async function populateConnections(entity: AbstractEntity, iDepth, oDepth) {
            if (iDepth) {
                const predicates: Predicate[] = await entity.incomingPreds(undefined, {peerType: '*'})
                for (const p of predicates)
                    p['peerEntity'] = await populateConnections(p.peer, iDepth - 1, 0)

                entity['_incoming'] = predicates
            }
            if (oDepth) {
                const predicates: Predicate[] = await entity.outgoingPreds(undefined, {peerType: '*'})
                for (const p of predicates)
                    p['peerEntity'] = await populateConnections(p.peer, 0, oDepth - 1)

                entity['_outgoing'] = predicates
            }

            return entity
        }
    }

}


