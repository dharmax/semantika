import {describe, expect, it} from "bun:test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AbstractEntity, EntityDcr, PredicateDcr, SemanticPackage, SqliteStore} from "../src/index.js";

class Note extends AbstractEntity {
    static readonly dcr = new EntityDcr(Note, {title: "untitled"});
}
const links = new PredicateDcr("links");
const ontology = {entityDcrs: [Note.dcr], predicateDcrs: [links]};

describe("durable tag registry", () => {
    it("rehydrates aliases, ancestry, constraints and safe deletion from file-backed SQLite", async () => {
        const dir = await mkdtemp(join(tmpdir(), "semantika-tags-"));
        const path = join(dir, "tags.db");
        try {
            const firstStore = new SqliteStore(path);
            await firstStore.connect();
            const first = new SemanticPackage("durable", ontology, firstStore);
            expect(() => first.tags.all()).toThrow("not ready");
            await first.ready();
            await first.tags.define("Status", {abstract: true, exclusive: true});
            await first.tags.define("Draft", {parent: "Status"});
            await first.tags.define("Published", {
                parent: "Status", synonym: "released", displayName: {fr: "Publié"}
            });
            await first.tags.define("Active");
            await first.tags.define("Inactive", {antonym: "Active"});
            await expect(first.tags.define("Collision", {synonym: "RELEASED"})).rejects.toThrow("conflicts");
            expect(first.tags.has("Collision")).toBe(false);
            const doc = await first.createEntity<Note>(Note.dcr, {title: "draft"});
            await doc.tag("Draft");
            const version = (doc as any)._version;
            await expect(doc.tag("Published")).rejects.toThrow("Exclusive tag violation");
            await expect(first.tags.remove("Draft")).rejects.toThrow("assigned");
            await firstStore.close();

            const reopenedStore = new SqliteStore(path);
            await reopenedStore.connect();
            const reopened = new SemanticPackage("durable", ontology, reopenedStore);
            expect(() => reopened.tags.get("released")).toThrow("not ready");
            await reopened.ready();
            await reopened.ready();
            expect(reopened.tags.get("released")).toBe(reopened.tags.get("Published"));
            expect(reopened.tags.get("Publié")).toBe(reopened.tags.get("Published"));
            expect(reopened.tags.get("Published")!.isDescendantOf("Status")).toBe(true);
            expect(reopened.tags.get("Status")!.abstract).toBe(true);
            expect(reopened.tags.get("Status")!.exclusive).toBe(true);
            expect(reopened.tags.get("Active")!.isAntonymOf("Inactive")).toBe(true);
            const loaded = await reopened.loadEntityById<Note>(doc.id);
            expect(loaded.hasTag("Status")).toBe(true);
            await expect(loaded.tag("Status")).rejects.toThrow("abstract");
            await expect(loaded.tag("Published")).rejects.toThrow("Exclusive");
            await loaded.tag("Published", {replace: true});
            expect(loaded.tagList).toEqual(["Published"]);
            expect((loaded as any)._version).toBe(version + 1);
            await reopened.tags.remove("Draft");
            expect(reopened.tags.has("Draft")).toBe(false);
            await reopenedStore.close();
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });

    it("replaces only existing exclusive siblings and rejects other conflicts", async () => {
        const storage = new SqliteStore(":memory:");
        await storage.connect();
        const sp = new SemanticPackage("boundaries", ontology, storage);
        await sp.ready();
        await sp.tags.define("Status", {abstract: true, exclusive: true});
        await sp.tags.define("Draft", {parent: "Status"});
        await sp.tags.define("Published", {parent: "Status"});
        await sp.tags.define("Featured");
        await sp.tags.define("Security");
        await sp.tags.define("Forbidden", {antonym: "Security"});
        const doc = await sp.createEntity<Note>(Note.dcr, {title: "one"});
        await doc.tag("Draft", "Security");
        const before = (doc as any)._version;
        await expect(doc.tag("Published", "Draft", {replace: true})).rejects.toThrow("Exclusive");
        await expect(doc.tag("Published", "Forbidden", {replace: true})).rejects.toThrow("Antonym");
        await expect(doc.tag("Status", {replace: true})).rejects.toThrow("abstract");
        expect(doc.tagList).toEqual(["Draft", "Security"]);
        expect((doc as any)._version).toBe(before);
        await doc.tag("Published", "Featured", {replace: true});
        expect(doc.tagList).toEqual(["Security", "Published", "Featured"]);
        expect((doc as any)._version).toBe(before + 1);
        await storage.close();
    });
});
