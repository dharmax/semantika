import {FilterFunction, IReadOptions, IReadResult, SortSpec} from '../types.js';
import {EntityDcr} from "../descriptors.js";
import {SemanticPackage} from "../semantic-package.js";
import {EntityCollection} from "../entities-collection.js";
import {PredicateCollection} from "../predicates-collection.js";
import {AbstractEntity} from "../abstract-entity.js";

export type StorageSession = any;
export type QueryDictionary = { [name: string]: (...params: any[]) => Object };
export type Cursor<T = any> = any;

export interface ICollection {
    readonly name: string;

    watch(callback: (change: any) => Promise<boolean>, ...args: any[]): void;

    updateDocumentUnsafe(_id: string, fields: Object): Promise<boolean>;

    updateDocument(_id: string, fields: Object, version?: number, rawOperations?: Object): Promise<any>;

    findById<T extends Object>(_id: string, projection?: string[]): Promise<T>;

    find(query: any, options: IFindOptions): Promise<Cursor>;

    findGenerator(query: any, options: IFindOptions): AsyncGenerator<Object>;

    distinct(field: string, query: any, options?: IFindOptions): Promise<any>;

    findSome<T>(query: any, options?: IFindOptions): Promise<T[]>;

    findSomeStream<T>(query: any, options: IFindOptions, format?: StreamFormats): Promise<Cursor<T>>;

    count(query: any, opts?: any): Promise<number>;

    findOne<T extends AbstractEntity>(query: any, projection?: string[]): Promise<T>;

    load<T>(opt: IReadOptions, query?: Object): Promise<IReadResult>;

    /**
     * @param doc the record
     * @returns on success, the id of the new entry
     */
    append(doc: Object): Promise<string>;

    deleteById(_id: string): Promise<boolean>;

    deleteByQuery(query: any): Promise<any>;

    ensureIndex(keys: Object, options?: any): any;

    findOneAndModify(criteria: any, change: Object): Promise<any>;

    createId(): string;
}

export type IPhysicalCollection = any;

export abstract class AbstractStorage {
    queryDictionary: QueryDictionary = {};

    createCustomQuery(queryName: string, queryParameters: { [p: string]: any }) {
        if (!queryName) return null;
        const queryConstructor = this.queryDictionary[queryName];
        if (!queryConstructor) throw new Error(`No such query constructor ${queryName}`);
        return queryConstructor(queryParameters);
    }

    abstract makeEntityCollection(
        physicalCollection: IPhysicalCollection,
        eDcr: EntityDcr,
        initFunc: (col: EntityCollection) => void
    ): EntityCollection;

    abstract makePredicateCollection(
        semanticPackage: SemanticPackage,
        physicalCollection: IPhysicalCollection
    ): PredicateCollection;

    abstract makeBasicCollection(
        physicalCollection: IPhysicalCollection,
        initFunc?: (col: IPhysicalCollection) => void
    ): IPhysicalCollection;

    abstract getPhysicalCollection(name: string, forPredicates: boolean): Promise<IPhysicalCollection>;

    abstract startSession(options?: any): Promise<StorageSession>;

    abstract purgeDatabase(): Promise<any>;

    abstract close(): Promise<void>;
}

export class DuplicateKeyError extends Error {
    constructor(public readonly col: string, more?: string) {
        super(`duplicate key in collection ${col} ${more || ''}`);
        this.name = 'DuplicateKeyError';
    }
}

import type {TagQueryExpression} from '../tag-query.js';

export interface IFindOptions {
    batchSize?: number;
    limit?: number;
    from?: number;
    projection?: string[];
    filterFunction?: FilterFunction;
    sort?: SortSpec;
    asDto?: boolean;
    tagQuery?: TagQueryExpression;
    expandTaxonomy?: boolean;
}

export const StandardFields: string[] = ['_created', '_lastUpdate', '_version', '_parent', '_tags'];

export enum StreamFormats {
    records,
    entities,
    strings
}