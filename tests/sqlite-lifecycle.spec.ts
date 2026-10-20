import {expect, test} from "bun:test";
import {Database} from "bun:sqlite";
import {SqliteStore} from "../src/storage/sqlite-store/sqlite-store";
import {SemanticPackage} from "../src/semantic-package";
import {PredicateDcr} from "../src/descriptors";

test("completed collection and batch operations release statements before strict database close", async () => {
    const db = new Database(":memory:");
    const storage = new SqliteStore(db);
    try {
        await storage.getPhysicalCollection("items");
        const collection = storage.makeBasicCollection("items");
        await collection.append({_id: "A", name: "original"});
        await collection.findById("A");
        await collection.findSome({});
        await collection.distinct("name", {});
        await collection.count({});
        await collection.updateDocument("A", {name: "updated"}, 1);
        await collection.updateDocumentUnsafe("A", {name: "unsafe"});
        storage.applyBatch([{collectionName: "items", id: "B", expectedVersion: null, record: {name: "batch"}}]);
        storage.applyBatch([{collectionName: "items", id: "B", expectedVersion: 1, record: {name: "changed"}}]);
        storage.applyBatch([{collectionName: "items", id: "B", expectedVersion: 2, record: null}]);
        await expect(collection.append({_id: "A"})).rejects.toThrow();
        await collection.deleteById("A");
        await collection.deleteByQuery({});
        expect(() => db.close(true)).not.toThrow();
    } finally {
        db.close();
    }
});

test("an SQLite automatic rollback preserves the original failure and leaves no partial batch", async () => {
    const db = new Database(":memory:");
    const storage = new SqliteStore(db);
    try {
        await storage.getPhysicalCollection("items");
        const collection = storage.makeBasicCollection("items");
        await collection.append({_id: "A", name: "original"});
        db.exec("CREATE TRIGGER reject_insert BEFORE INSERT ON items BEGIN SELECT RAISE(ROLLBACK, 'original rollback failure'); END");
        expect(() => storage.applyBatch([
            {collectionName: "items", id: "A", expectedVersion: 1, record: {name: "changed"}},
            {collectionName: "items", id: "B", expectedVersion: null, record: {name: "rejected"}}
        ])).toThrow("original rollback failure");
        expect(await collection.findById("A")).toMatchObject({name: "original", _version: 1});
        expect(await collection.findById("B")).toBeNull();
    } finally {
        db.close();
    }
});

test("package construction starts no detached storage work; first predicate access owns descriptor indexes", async () => {
    const db = new Database(":memory:");
    const storage = new SqliteStore(db);
    const shared = new PredicateDcr("shared", [], {source: ["label"]});
    const custom = new PredicateDcr("custom", [], {target: ["category"]});
    custom.collectionName = "custom_relations";
    try {
        const sp = new SemanticPackage("lifecycle", {entityDcrs: [], predicateDcrs: [shared, custom]}, storage);
        expect(db.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
        const collection = await sp.predicateCollection(shared);
        expect(collection.name).toBe("lifecycle__Predicates");
        await sp.predicateCollection(custom);
        const indexes = db.query("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name);
        expect(indexes).toContain("idx_lifecycle__Predicates_sourceId_label_targetId");
        expect(indexes).toContain("idx_custom_relations_targetId_category_sourceId");
        expect(() => db.close(true)).not.toThrow();
        await Bun.sleep(0);
    } finally {
        db.close();
    }
});

test("a package with predicate keys can close immediately without pending hydration", async () => {
    const db = new Database(":memory:");
    const storage = new SqliteStore(db);
    new SemanticPackage("immediate-close", {
        entityDcrs: [], predicateDcrs: [new PredicateDcr("links", [], {source: ["label"]})]
    }, storage);
    db.close(true);
    await Bun.sleep(0);
});
