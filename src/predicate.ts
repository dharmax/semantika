import {AbstractEntity} from "./abstract-entity";
import {LoggedException} from "./utils/logged-exception";
import {IPredicateRecord, PredicateCollection} from "./storage";
import {SemanticPackage} from "./semantic-package";

/**
 * Represents a semantic relation between two semantic parts (entities). This class is not to be extended. The predicate's
 * descriptor gives the predicate its semantic meaning. A predicate may have a payload of user-data. The term "peer" reference
 * to a connected artifact. It is possible to define (using the descriptor) peer (target or source) fields that would be copied
 * automatically to the predicate record, in order to support functionality like index supported filtering, etc.
 */
export class Predicate implements IPredicateRecord {

    private _version: number
    readonly _id: string
    private readonly semanticPackageName: string
    predicateName: string
    sourceId: string
    sourceType: string
    targetId: string
    targetType: string
    payload: any

    // those are fields that are reflections of peers (see descriptors)
    [peerKey: string]: any

    private sourceEntity: AbstractEntity
    private targetEntity: AbstractEntity

    constructor(semanticPackage: SemanticPackage, record: IPredicateRecord) {
        this.semanticPackageName = semanticPackage.name
        this._id = record._id || record['id']
        delete record['id']
        Object.assign(this, record)
        this.sourceEntity = record.peerIsSource && record.peerEntity
        this.targetEntity = !record.peerIsSource && record.peerEntity
    }

    get semanticPackage() {
        return SemanticPackage.findSemanticPackage(this.semanticPackageName)
    }

    get dcr() {
        return this.semanticPackage.ontology.pdcr(this.predicateName)
    }

    get id() {
        return this['_id']
    }

    get peer(): AbstractEntity {
        return this['peerEntity']
    }

    async getSource<T extends AbstractEntity>(...projection: string[]): Promise<T> {
        if (!this.sourceEntity) {
            const peerClass = this.semanticPackage.ontology.edcr(this.sourceType).clazz
            let sCol = await this.storage.collectionForEntityType(peerClass)
            this.sourceEntity = <AbstractEntity>(await sCol.findById(this.sourceId, projection))
        }

        return <T><unknown>this.sourceEntity
    }

    async getTarget(...projection: string[]) {
        if (!this.targetEntity) {
            const peerClass = this.semanticPackage.ontology.edcr(this.targetType).clazz
            let peerCollection = await this.storage.collectionForEntityType(peerClass)
            this.targetEntity = <AbstractEntity>(await peerCollection.findById(this.targetId, projection))
        }
        return this.targetEntity
    }

    async change(fields) {
        let pCol: PredicateCollection = await this.semanticPackage.predicateCollection(this.dcr)
        return pCol.updateDocument(this._id, fields, this._version)
    }

    erase(): any {
        return this.semanticPackage.deletePredicate(this)
    }
}


export async function idAndType2entity<T extends AbstractEntity>(id: string, type: string): Promise<T> {
    const eDcr = this.getOntology().edcr(type)
    if (!eDcr)
        throw new LoggedException(`Entity type ${type} isn't part of the system's ontology`)

    const entityClass = eDcr.clazz
    return entityClass['createFromDB'](entityClass, id)

}
