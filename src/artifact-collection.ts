import {ICollection, IFindOptions, IPhysicalCollection} from "./storage";
import {Cursor} from "mongodb";
import {IReadOptions, IReadResult} from "./types";
import {SemanticPackage} from "./semantic-package";

export abstract class ArtifactCollection implements ICollection {
    protected constructor(protected physicalCollection: IPhysicalCollection) {
    }

    readonly name: string;

    append(doc: Object & { _id? }) {
        doc._id = this.createId()
        return this.physicalCollection.append(doc)
    }

    count(query, opts?): Promise<number> {
        return this.physicalCollection.count(query, opts)
    }

    abstract createId(): string

    deleteById(_id: string): Promise<boolean> {
        return this.physicalCollection.deleteById(_id)
    }

    deleteByQuery(query: any): Promise<any> {
        return this.physicalCollection.deleteByQuery(query)
    }

    distinct(field: string, query, options: IFindOptions): Promise<any> {
        return this.physicalCollection.distinct(field, query, options)
    }

    ensureIndex(keys: Object, options?): any {
        return this.physicalCollection.ensureIndex(keys, options)
    }

    find(query, options: IFindOptions): Promise<Cursor> {
        return this.physicalCollection.find(query, options)
    }

    findById<T extends Object>(_id: string, projection?: string[]): Promise<T> {
        // @ts-ignore
        return this.physicalCollection.findById(...arguments)
    }

    findGenerator(query, options: IFindOptions): AsyncGenerator<Object> {
        // @ts-ignore
        return this.physicalCollection.findGenerator(...arguments)
    }

    findOne<T>(query, projection?: string[]): Promise<T> {
        // @ts-ignore
        return this.physicalCollection.findOne(...arguments)
    }

    findOneAndModify(criteria: any, change: Object): Promise<any> {
        // @ts-ignore
        return this.physicalCollection.findOneAndModify(...arguments)
    }

    findSome<T>(query, options?: IFindOptions): Promise<T[]> {
        // @ts-ignore
        return this.physicalCollection.findSome(...arguments)
    }

    findSomeStream<T>(query, options: IFindOptions, format): Promise<Cursor<T>> {
        // @ts-ignore
        return this.physicalCollection.findSomeStream(...arguments)
    }

    load<T>(opt: IReadOptions, query?: Object): Promise<IReadResult> {
        // @ts-ignore
        const customQuery = this.semanticPackage.storage.createCustomQuery(opt.queryName, opt.queryParams)
        if (query) {
            if (customQuery)
                query = Object.assign(customQuery, query)
        } else
            query = customQuery

        return this.physicalCollection.load(opt, query)
    }

    updateDocument(_id: string, fields: Object, version?: number, rawOperations?: Object): Promise<any> {
        // @ts-ignore
        return this.physicalCollection.updateDocument(...arguments)
    }

    updateDocumentUnsafe(_id: string, fields: Object): Promise<boolean> {
        // @ts-ignore
        return this.physicalCollection.updateDocumentUnsafe(...arguments)
    }

    watch(callback: (change) => Promise<boolean>, ...args): void {
        // @ts-ignore
        return this.physicalCollection.watch(...arguments)
    }

    abstract get semanticPackage(): SemanticPackage
}