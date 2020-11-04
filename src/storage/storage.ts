import {ChangeStream, ClientSession, Cursor, IndexOptions, MongoCountPreferences, SessionOptions} from "mongodb"

import {FilterFunction, IReadOptions, IReadResult, SortSpec} from '../types'
import {BasicCollection} from "./basic-collection";
import {EntityDcr} from "../descriptors";

export type StorageSession = ClientSession
export type QueryDictionary = { [name: string]: (...params: any[]) => Object }

export {Cursor} from 'mongodb'

export interface ICollection {
    readonly name: string;

    watch(callback: (change: ChangeStream) => Promise<boolean>, ...args): void;

    updateDocumentUnsafe(_id: string, fields: Object): Promise<boolean>;

    updateDocument(_id: string, fields: Object, version?: number, rawOperations: Object): Promise<any>;

    findById<T extends Object>(_id: string, projection?: string[]): Promise<T>;

    find(query, options: IFindOptions): Promise<Cursor>;

    findGenerator(query, options: IFindOptions): AsyncGenerator<Object>;

    distinct(field: string, query, options: IFindOptions): Promise<any>;

    findSome<T>(query, options: IFindOptions): Promise<T[]>;

    findSomeStream<T>(query, options: IFindOptions, format): Promise<Cursor<T>>;

    count(query, opts?: MongoCountPreferences): Promise<number>;

    findOne<T>(query, projection?: string[]): Promise<T>;

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

export interface IStorage {
    setQueryDictionary(dictionary: QueryDictionary): void;

    startSession(options?: SessionOptions): Promise<StorageSession>;

    collection(name: string, initFunc?: (col: ICollection) => void, eDcr?: EntityDcr): Promise<ICollection>;

    purgeDatabase(): Promise<any>;

    initCollection(name: string, forPredicates: boolean, clazz?: Function): Promise<ICollection>;

    /**
     * to be used only internally by Storage
     * @param name
     * @param forPredicates set to true to make it a special predicates collection
     * @param clazz the associated JS class. Optional.
     * @returns {BasicCollection}
     */
    createCollection(name: string, forPredicates: boolean, clazz?: Function): Promise<BasicCollection>;
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
    sort?:SortSpec
}


export const StandardFields: string[] = ['_created', '_lastUpdate', '_version']



export enum StreamFormats { records, entities, strings}

