import {AbstractEntity} from "../abstract-entity";
import {Cursor, ICollection, IFindOptions, StreamFormats} from "./storage";
import {MongoBasicCollection} from "./mongo-basic-collection";
import {SemanticPackage} from "../semantic-package";
import {ID_SEPARATOR} from "../utils/constants";
import {EntityDcr} from "../descriptors";
import {IReadOptions, IReadResult} from "../types";


export abstract class ArtifactCollection implements ICollection {
    protected constructor(protected basicCollection: MongoBasicCollection) {
    }

    readonly name: string;

    append(doc: Object & { _id? }) {
        doc._id = this.createId()
        return this.basicCollection.append(doc)
    }

    count(query, opts?): Promise<number> {
        return this.basicCollection.count(query, opts)
    }

    abstract createId(): string

    deleteById(_id: string): Promise<boolean> {
        return this.basicCollection.deleteById(_id)
    }

    deleteByQuery(query: any): Promise<any> {
        return this.basicCollection.deleteByQuery(query)
    }

    distinct(field: string, query, options: IFindOptions): Promise<any> {
        return this.basicCollection.distinct(field, query, options)
    }

    ensureIndex(keys: Object, options?): any {
        return this.basicCollection.ensureIndex(keys, options)
    }

    find(query, options: IFindOptions): Promise<Cursor> {
        return this.basicCollection.find(query, options)
    }

    findById<T extends Object>(_id: string, projection?: string[]): Promise<T> {
        // @ts-ignore
        return this.basicCollection.findById(...arguments)
    }

    findGenerator(query, options: IFindOptions): AsyncGenerator<Object> {
        // @ts-ignore
        return this.basicCollection.findGenerator(...arguments)
    }

    findOne<T>(query, projection?: string[]): Promise<T> {
        // @ts-ignore
        return this.basicCollection.findOne(...arguments)
    }

    findOneAndModify(criteria: any, change: Object): Promise<any> {
        // @ts-ignore
        return this.basicCollection.findOneAndModify(...arguments)
    }

    findSome<T>(query, options?: IFindOptions): Promise<T[]> {
        // @ts-ignore
        return this.basicCollection.findSome(...arguments)
    }

    findSomeStream<T>(query, options: IFindOptions, format): Promise<Cursor<T>> {
        // @ts-ignore
        return this.basicCollection.findSomeStream(...arguments)
    }

    load<T>(opt: IReadOptions, query?: Object): Promise<IReadResult> {
        // @ts-ignore
        return this.basicCollection.load(...arguments)
    }

    updateDocument(_id: string, fields: Object, version?: number, rawOperations?: Object): Promise<any> {
        // @ts-ignore
        return this.basicCollection.updateDocument(...arguments)
    }

    updateDocumentUnsafe(_id: string, fields: Object): Promise<boolean> {
        // @ts-ignore
        return this.basicCollection.updateDocumentUnsafe(...arguments)
    }

    watch(callback: (change) => Promise<boolean>, ...args): void {
        // @ts-ignore
        return this.basicCollection.watch(...arguments)
    }

}

export class EntityCollection extends ArtifactCollection {

    constructor(private entityDcr: EntityDcr, collection: MongoBasicCollection) {
        super(collection)
    }

    createId() {
        return `${this.semanticPackage.name}${ID_SEPARATOR}${this.entityDcr.name}${ID_SEPARATOR}${this.basicCollection.createId()}`
    }

    get semanticPackage() {
        return this.entityDcr.semanticPackage
    }


    async findSomeStream<T>(query, options: IFindOptions, format = StreamFormats.strings): Promise<Cursor<T>> {
        if (format !== StreamFormats.entities)
            return this.basicCollection.findSomeStream(query, options, format)
        // @ts-ignore
        const cursor = await this.basicCollection.find(...arguments)

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
        const record = await this.basicCollection.findById(_id, projection)
        if (!record)
            return null
        // @ts-ignore
        return <T>this.semanticPackage.makeEntity(this.entityDcr, record._id, record)
    }

    async* findGenerator(query, options: IFindOptions = {}): AsyncGenerator<AbstractEntity | Object> {
        const cursor = await this.basicCollection.find(query, options)
        while (await cursor.hasNext()) {
            const record = await cursor.next()
            const entity = this.semanticPackage.makeEntity(undefined, undefined, record)
            yield entity
        }
    }


}

export class PredicateCollection extends ArtifactCollection {

    constructor(readonly semanticPackage: SemanticPackage, collection: MongoBasicCollection) {
        super(collection)
    }

    createId(): string {
        return `${this.semanticPackage.name}${ID_SEPARATOR}${this.basicCollection.createId()}`
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