import {AbstractEntity} from "../abstract-entity";
import {Cursor, IFindOptions, StreamFormats} from "./storage";
import {BasicCollection} from "./basic-collection";
import {SemanticPackage} from "../semantic-package";
import {ID_SEPARATOR} from "../utils/constants";
import {SemanticArtifact} from "./semantic-artifact";
import {EntityDcr} from "../descriptors";


export class EntityCollection extends BasicCollection implements SemanticArtifact {

    constructor(private entityDcr: EntityDcr, collection) {
        super(collection)
    }

    createId() {
        return `${this.entityDcr.name}${ID_SEPARATOR}${super.createId()}`
    }

    get semanticPackage() {
        return this.entityDcr.semanticPackage
    }

    async findSomeStream<T>(query, options: IFindOptions, format = StreamFormats.strings): Promise<Cursor<T>> {
        if (format !== StreamFormats.entities)
            return super.findSomeStream(query, options, format)
        // @ts-ignore
        const cursor = await this.find(...arguments)

        return cursor.stream({
            transform: rec => {
                return this.semanticPackage.makeEntity(this.entityDcr, rec._id, rec)
            }
        })

    }


    async findSome<T>(query, options: IFindOptions = {}): Promise<T[]> {

        // @ts-ignore
        const arrayP = await super.findSome(...arguments)

        let result = arrayP.map(rec => this.semanticPackage.makeEntity(this.entityDcr, rec['_id'], rec))

        if (options.filterFunction)
            result = await options.filterFunction(result)

        return result as unknown as T[]
    }

    async findById<T extends AbstractEntity | Object>(_id: string, projection?: string[]): Promise<T> {
        const record = await super.findById(_id, projection)
        if (!record)
            return null
        // @ts-ignore
        return <T>this.semanticPackage.makeEntity(this.entityDcr, record._id, record)
    }

    async* findGenerator(query, options: IFindOptions = {}): AsyncGenerator<AbstractEntity | Object> {
        const cursor = await this.find(query, options)
        while (await cursor.hasNext()) {
            const record = await cursor.next()
            const entity = this.semanticPackage.makeEntity(undefined, undefined, record)
            yield entity
        }
    }


}

export class PredicateCollection extends BasicCollection implements SemanticArtifact {

    constructor(readonly semanticPackage: SemanticPackage, collection) {
        super(collection)
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