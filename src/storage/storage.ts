import {ChangeStream, ClientSession, Cursor, IndexOptions, MongoCountPreferences, SessionOptions} from "mongodb"

import {FilterFunction, IReadOptions, IReadResult, SortSpec} from '../types'
import {EntityDcr} from "../descriptors";
import {SemanticPackage} from "../semantic-package";
import {EntityCollection} from "../entities-collection";
import {PredicateCollection} from "../predicates-collection";
import {AbstractEntity} from "../abstract-entity";

export type StorageSession = ClientSession
export type QueryDictionary = { [name: string]: (...params: any[]) => Object }

export {Cursor} from 'mongodb'

export interface ICollection {
    readonly name: string;

    watch(callback: (change: ChangeStream) => Promise<boolean>, ...args): void;

    updateDocumentUnsafe(_id: string, fields: Object): Promise<boolean>;

    updateDocument(_id: string, fields: Object, version?: number, rawOperations?: Object): Promise<any>;

    findById<T extends Object>(_id: string, projection?: string[]): Promise<T>;

    find(query, options: IFindOptions): Promise<Cursor>;

    findGenerator(query, options: IFindOptions): AsyncGenerator<Object>;

    distinct(field: string, query, options: IFindOptions): Promise<any>;

    findSome<T>(query, options: IFindOptions): Promise<T[]>;

    findSomeStream<T>(query, options: IFindOptions, format): Promise<Cursor<T>>;

    count(query, opts?: MongoCountPreferences): Promise<number>;

    findOne<T extends AbstractEntity>(query, projection?: string[]): Promise<T>;

    load<T>(opt: IReadOptions, query?: Object): Promise<IReadResult>;

    /**
     * @param doc the record
     * @returns on success, the id of the new entry
     */
    append(doc: Object): Promise<string>;

    deleteById(_id: string): Promise<boolean>;

    deleteByQuery(query: any): Promise<any>;

    ensureIndex(keys: Object, options?: IndexOptions): any;

    findOneAndModify(criteria: any, change: Object): Promise<any>;

    createId(): string;
}

export type IPhysicalCollection = any


export abstract class AbstractStorage {

    queryDictionary: QueryDictionary

    createCustomQuery( queryName:string, queryParameters:{[p:string]:any }) {
        if (!queryName)
            return null
        const queryConstructor = this.queryDictionary[queryName]
        if (!queryConstructor)
            throw new Error(`No such query constructor ${queryName}`)
        return queryConstructor(queryParameters)
    }

    abstract makeEntityCollection(physicalCollection: IPhysicalCollection, eDcr: EntityDcr, initFunc: (col: EntityCollection) => void): EntityCollection

    abstract makePredicateCollection(semanticPackage: SemanticPackage, physicalCollection: IPhysicalCollection): PredicateCollection

    abstract makeBasicCollection(physicalCollection: IPhysicalCollection, initFunc?: (col: IPhysicalCollection) => void): IPhysicalCollection

    abstract getPhysicalCollection(name: string, forPredicates: boolean): Promise<IPhysicalCollection>;

    abstract startSession(options?: SessionOptions): Promise<StorageSession>;

    abstract purgeDatabase(): Promise<any>;

    abstract close(): Promise<void>

}

export class DuplicateKeyError extends Error {
    constructor(public readonly col: string) {
        super('duplicate key in collection  ' + col)
    }   //
}

export interface IFindOptions {
    batchSize?: number
    limit?: number
    from?: number
    projection?: string[]
    filterFunction?: FilterFunction
    sort?: SortSpec
    asDto?: boolean
}


export const StandardFields: string[] = ['_created', '_lastUpdate', '_version', '_parent']


export enum StreamFormats { records, entities, strings}


