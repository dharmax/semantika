import {ArtifactCollection} from "./artifact-collection";
import {EntityDcr} from "./descriptors";
import {IFindOptions, IPhysicalCollection, StreamFormats} from "./storage";
import {ID_SEPARATOR} from "./utils/constants";
import {Cursor} from "mongodb";
import {AbstractEntity} from "./abstract-entity";
import {IReadOptions, IReadResult} from "./types";

export class EntityCollection extends ArtifactCollection {

    constructor(private entityDcr: EntityDcr, collection: IPhysicalCollection) {
        super(collection)
    }

    createId() {
        return `${this.semanticPackage.name}${ID_SEPARATOR}${this.entityDcr.name}${ID_SEPARATOR}${this.physicalCollection.createId()}`
    }

    get semanticPackage() {
        return this.entityDcr.semanticPackage
    }


    async findSomeStream<T>(query, options: IFindOptions, format = StreamFormats.strings): Promise<Cursor<T>> {
        if (format !== StreamFormats.entities)
            return this.physicalCollection.findSomeStream(query, options, format)
        // @ts-ignore
        const cursor = await this.physicalCollection.find(...arguments)

        return cursor.stream({
            transform: rec => {
                return options.asDto ? rec : this.semanticPackage.makeEntity(this.entityDcr, rec._id, rec)
            }
        })

    }

    async findSome<T>(query, options: IFindOptions = {}): Promise<T[]> {

        // @ts-ignore
        const arrayP = await super.findSome(...arguments)

        let result = options.asDto ? arrayP : arrayP.map(rec => this.semanticPackage.makeEntity(this.entityDcr, rec['_id'], rec))

        if (options.filterFunction)
            result = await options.filterFunction(result)

        return result as unknown as T[]
    }

    async findById<T extends AbstractEntity | Object>(_id: string, projection?: string[]): Promise<T> {
        const record = await this.physicalCollection.findById(_id, projection)
        if (!record)
            return null
        // @ts-ignore
        return <T>this.semanticPackage.makeEntity(this.entityDcr, record._id, record)
    }

    async load<T extends AbstractEntity>(opt: IReadOptions, query?: Object): Promise<IReadResult> {
        const result = await super.load(opt, query);
        result.items = result.items.map(record => <T>this.semanticPackage.makeEntity(this.entityDcr, record._id, record))
        return result
    }

    async findOne<T extends AbstractEntity>(query, projection?: string[]): Promise<T> {
        const record = await super.findOne(query, projection);
        if (!record)
            return null

        let result:T = this.semanticPackage.makeEntity(this.entityDcr, record['_id'], record)

        return result as T
    }

    async* findGenerator(query, options: IFindOptions = {}): AsyncGenerator<AbstractEntity | Object> {
        const cursor = await this.physicalCollection.find(query, options)
        while (await cursor.hasNext()) {
            const record = await cursor.next()
            const entity = this.semanticPackage.makeEntity(undefined, undefined, record)
            yield entity
        }
    }


}