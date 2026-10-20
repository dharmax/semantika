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


test("assertion-only entries condition a multi-collection outcome without rewriting the asserted row", async () => {
    await storage.getPhysicalCollection("proofs");
    const rows = storage.applyBatch([
        {collectionName: "rules", id: "A", expectedVersion: 1},
        {collectionName: "rules", id: "absent", expectedVersion: null},
        {collectionName: "proofs", id: "VERIFY", expectedVersion: null, record: {accepted: true}}
    ]);
    expect(rows).toHaveLength(1);
    expect(await collection.findById("A")).toMatchObject({name: "original", _version: 1});
    expect(await collection.findById("absent")).toBeNull();
    await collection.updateDocument("A", {name: "changed"}, 1);
    expect(() => storage.applyBatch([
        {collectionName: "proofs", id: "FALSE", expectedVersion: null, record: {accepted: true}},
        {collectionName: "rules", id: "A", expectedVersion: 1}
    ])).toThrow("Stale batch revision");
    expect(await storage.makeBasicCollection("proofs").findById("FALSE")).toBeNull();
});


test("public entity and predicate collection names identify the actual SQLite batch collections", async () => {
    const {SemanticPackage, EntityDcr, PredicateDcr, AbstractEntity} = await import("../src/index.js");
    class ContractEntity extends AbstractEntity {}
    const descriptor = new EntityDcr(ContractEntity, {}, "ContractEntity");
    const relation = new PredicateDcr("links");
    const sp = new SemanticPackage("batch-contract", {entityDcrs: [descriptor], predicateDcrs: [relation]}, storage);
    await sp.ready();
    const entities = await sp.collectionForEntityType(descriptor);
    const predicates = await sp.predicateCollection(relation);
    expect(typeof entities.name).toBe("string");
    expect(typeof predicates.name).toBe("string");
    const rows = storage.applyBatch([
        {collectionName: entities.name, id: "E", expectedVersion: null, record: {title: "entity"}},
        {collectionName: predicates.name, id: "P", expectedVersion: null, record: {
            sourceId: "E", sourceType: "ContractEntity", predicateName: "links", targetId: "E", targetType: "ContractEntity", payload: {}}}
    ]);
    expect(rows).toHaveLength(2);
    expect(await entities.findById("E")).toMatchObject({title: "entity"});
    expect(await predicates.findById("P")).toMatchObject({predicateName: "links"});
});

test("entities keep their owning package instance when another project uses the same package name", async () => {
    const {SemanticPackage, EntityDcr, AbstractEntity} = await import("../src/index.js");
    class IsolatedEntity extends AbstractEntity {}
    const descriptor = new EntityDcr(IsolatedEntity, {title: {validate: value => ({value})}}, "IsolatedEntity");
    const a = new SemanticPackage("instance-contract", {entityDcrs: [descriptor], predicateDcrs: []}, storage);
    await a.ready();
    const other = new SqliteStore(new Database(":memory:"));
    try {
        const b = new SemanticPackage("instance-contract", {entityDcrs: [descriptor], predicateDcrs: []}, other);
        await b.ready();
        const ca = await a.collectionForEntityType(descriptor), cb = await b.collectionForEntityType(descriptor);
        const id = ca.createId();
        const ra = storage.applyBatch([{collectionName: ca.name, id, expectedVersion: null, record: {title: "A"}}])[0];
        other.applyBatch([{collectionName: cb.name, id, expectedVersion: null, record: {title: "B"}}]);
        const entity = a.makeEntity(descriptor, id, ra);
        expect(entity.semanticPackage).toBe(a);
        await entity.update({title: "A changed"}, true, false);
        expect(await ca.findById(id)).toMatchObject({title: "A changed", _version: 2});
        expect(await cb.findById(id)).toMatchObject({title: "B", _version: 1});
        expect(() => JSON.stringify(entity)).not.toThrow();
    } finally { await other.close(); }
});
