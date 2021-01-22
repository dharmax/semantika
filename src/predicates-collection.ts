import {AbstractEntity} from "./abstract-entity";
import {ArtifactCollection} from "./artifact-collection";
import {SemanticPackage} from "./semantic-package";
import {IPhysicalCollection} from "./storage";
import {ID_SEPARATOR} from "./utils/constants";

export class PredicateCollection extends ArtifactCollection {

    constructor(readonly semanticPackage: SemanticPackage, collection: IPhysicalCollection) {
        super(collection)
    }

    createId(): string {
        return `${this.semanticPackage.name}${ID_SEPARATOR}${this.physicalCollection.createId()}`
    }
}

export interface IPredicateRecord {
    predicateName: string
    sourceId: string
    sourceType: string
    targetId: string
    targetType: string
    payload: any
    _id?: string
    _created?
    peerEntity?: AbstractEntity
    peerIsSource?: boolean

    [peerKey: string]: any
}