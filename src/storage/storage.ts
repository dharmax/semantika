import {ChangeStream, ClientSession, Cursor, IndexOptions, MongoCountPreferences, SessionOptions} from "mongodb"

import {FilterFunction, IReadOptions, IReadResult, SortSpec} from '../types'
import {BasicCollection} from "./basic-collection";
import {EntityDcr} from "../descriptors";
import {Mutex} from "../utils/mutex";
import {EntityCollection, PredicateCollection} from "./semantic-collections";

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

export abstract class AbstractStorage {

    entityCollection(collectionName: string, initFunc: (col: EntityCollection) => void, eDcr: EntityDcr): Promise<EntityCollection> {
        return collectionForName(this, collectionName, false, initFunc, eDcr.clazz)
    }

    predicateCollection(name?: string): Promise<PredicateCollection> {
        return collectionForName(this, name || '_predicates', true, predicateInitFunction)
    }

    basicCollection(collectionName: string, initFunc?: (col: BasicCollection) => void): Promise<BasicCollection> {
        return collectionForName(this, collectionName, false, initFunc)
    }

    abstract getPhysicalCollection(name: string, forPredicates: boolean, clazz: Function): Promise<ICollection>;


    abstract setQueryDictionary(dictionary: QueryDictionary): void;

    abstract startSession(options?: SessionOptions): Promise<StorageSession>;

    abstract purgeDatabase(): Promise<any>;

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
}


export const StandardFields: string[] = ['_created', '_lastUpdate', '_version']


export enum StreamFormats { records, entities, strings}


const collectionMutex = new Mutex();
const collections: { [name: string]: ICollection } = {}


async function collectionForName<T extends ICollection>(storage: AbstractStorage, name: string, forPredicates = false, initFunc?: (col: ICollection) => void, clazz?: Function): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        collectionMutex.lock(() => {
            let col = collections[name]
            if (col) {
                collectionMutex.release()
                resolve(col as T)
            } else {
                storage.getPhysicalCollection(name, forPredicates, clazz).then(c => {
                    initFunc && initFunc(c)
                    resolve(c as T);
                }).catch((e) => {
                    reject(e)
                }).finally(collectionMutex.release)
            }
        })
    })

}

const predicateInitFunction = col => {
    col.ensureIndex({
        predicateName: 1,
        sourceId: 1,
        targetType: 1
    }, {})
    col.ensureIndex({
        predicateName: 1,
        targetId: 1,
        sourceType: 1
    }, {})
    col.ensureIndex({
        sourceId: 1,
        keys: 1
    }, {})
    col.ensureIndex({
        targetId: 1,
        keys: 1
    }, {})
    col.ensureIndex({
        sourceId: 1,
        targetId: 1,
        predicateName: 1
    }, {})
}