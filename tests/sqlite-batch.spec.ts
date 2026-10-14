import {afterEach, beforeEach, expect, test} from "bun:test";
import {Database} from "bun:sqlite";
import {SqliteStore} from "../src/storage/sqlite-store/sqlite-store";
import type {SqliteBasicCollection} from "../src/storage/sqlite-store/sqlite-basic-collection";

let db: Database;
let storage: SqliteStore;
let collection: SqliteBasicCollection;
beforeEach(async () => {
    db = new Database(":memory:");
    storage = new SqliteStore(db);
    await storage.getPhysicalCollection("rules");
    collection = storage.makeBasicCollection("rules") as SqliteBasicCollection;
    collection.ensureIndex({name: 1}, {unique: true});
    await collection.append({_id: "A", name: "original"});
});
afterEach(() => db.close());

test("batch commits fresh records with optimistic versions and preserves supplied objects", async () => {
    const original = await collection.findById<{name: string; _version: number}>("A");
    const record = {name: "changed"};
    const rows = storage.applyBatch([
        {collectionName: "rules", id: "A", expectedVersion: 1, record},
        {collectionName: "rules", id: "B", expectedVersion: null, record: {name: "new"}}
    ]);
    expect(rows.map(row => row._version)).toEqual([2, 1]);
    expect(original).toMatchObject({name: "original", _version: 1});
    expect(record).toEqual({name: "changed"});
    expect(await collection.findById("A")).toMatchObject({name: "changed", _version: 2});
});

test("real database failure rolls back all entities, versions and unique-index state", async () => {
    await storage.getPhysicalCollection("audit");
    db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    expect(() => storage.applyBatch([
        {collectionName: "rules", id: "A", expectedVersion: 1, record: {name: "changed"}},
        {collectionName: "rules", id: "B", expectedVersion: null, record: {name: "inserted"}},
        {collectionName: "audit", id: "FAIL", expectedVersion: null, record: {action: "edit"}}
    ])).toThrow("injected failure");
    expect(await collection.findById("A")).toMatchObject({name: "original", _version: 1});
    expect(await collection.findById("B")).toBeNull();
    expect(await collection.findSome({name: "changed"})).toEqual([]);
    expect(await collection.findSome({name: "original"})).toHaveLength(1);
    expect(db.query("SELECT count(*) AS n FROM audit").get()).toEqual({n: 0});
    await collection.append({_id: "B", name: "changed"});
    expect(await collection.count({})).toBe(2);
});

test("stale concurrent revisions reject the entire batch", async () => {
    await collection.updateDocument("A", {name: "other editor"}, 1);
    expect(() => storage.applyBatch([
        {collectionName: "rules", id: "B", expectedVersion: null, record: {name: "new"}},
        {collectionName: "rules", id: "A", expectedVersion: 1, record: {name: "stale"}}
    ])).toThrow("Stale batch revision");
    expect(await collection.findById("B")).toBeNull();
    expect(await collection.findById("A")).toMatchObject({name: "other editor", _version: 2});
});

test("unique-index violations roll back earlier deletes and updates", async () => {
    await collection.append({_id: "B", name: "occupied"});
    expect(() => storage.applyBatch([
        {collectionName: "rules", id: "A", expectedVersion: 1, record: null},
        {collectionName: "rules", id: "C", expectedVersion: null, record: {name: "occupied"}}
    ])).toThrow();
    expect(await collection.findById("A")).toMatchObject({name: "original", _version: 1});
    expect(await collection.findById("C")).toBeNull();
});

test("nested transactions cannot expose uncommitted batch results", async () => {
    db.exec("BEGIN");
    expect(() => storage.applyBatch([{collectionName: "rules", id: "B", expectedVersion: null, record: {name: "new"}}]))
        .toThrow("independent native SQLite transaction");
    db.exec("ROLLBACK");
    expect(await collection.findById("B")).toBeNull();
});

test("duplicate identities and invalid revisions fail before any writes", async () => {
    const item = {collectionName: "rules", id: "A", expectedVersion: 1, record: {name: "edit"}};
    expect(() => storage.applyBatch([item, item])).toThrow("Duplicate batch identity");
    expect(() => storage.applyBatch([{...item, expectedVersion: 0}])).toThrow("exact positive version");
    expect(() => storage.applyBatch([{...item, collectionName: 'rules"; DROP TABLE rules; --'}])).toThrow();
    expect(await collection.findById("A")).toMatchObject({name: "original", _version: 1});
});
