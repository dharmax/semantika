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
    it("loads a declarative multi-parent taxonomy idempotently", async () => {
        const storage = new SqliteStore(":memory:");
        await storage.connect();
        const sp = new SemanticPackage("tree", ontology, storage);
        await sp.ready();
        const tree = {
            Technology: {
                $abstract: true,
                Backend: {Database: {$synonym: "data store"}},
                Storage: {Database: {}}
            }
        };
        await sp.tags.defineTaxonomy(tree);
        await sp.tags.defineTaxonomy(tree);
        expect(sp.tags.all()).toHaveLength(4);
        expect(sp.tags.get("data store")).toBe(sp.tags.get("Database"));
        expect([...sp.tags.get("Database")!.parents].map(t => t.name).sort()).toEqual(["Backend", "Storage"]);
        sp.tags.get("Database")!.parents.clear();
        expect(sp.tags.get("Database")!.parents.size).toBe(2);
        await storage.close();
    });

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

    it("rejects new orphan tag assignments while allowing registered aliases", async () => {
        const storage = new SqliteStore(":memory:");
        await storage.connect();
        const sp = new SemanticPackage("registered-only", ontology, storage);
        await sp.ready();
        await sp.tags.define("Known", {synonym: "alias"});
        const doc = await sp.createEntity<Note>(Note.dcr, {title: "known"});
        await expect(doc.tag("missing")).rejects.toThrow("Unknown tag");
        await expect(sp.createEntity<Note>(Note.dcr, {title: "bad"}, false, true, ["missing"])).rejects.toThrow("Unknown tag");
        const other = await sp.createEntity<Note>(Note.dcr, {title: "other"});
        await expect(sp.createPredicate(doc, links, other, {}, {}, ["missing"])).rejects.toThrow("Unknown tag");
        await doc.tag("alias");
        expect(doc.tagList).toEqual(["Known"]);
        await storage.close();
    });

    it("keeps persisted antonym ownership separate from the symmetric runtime view", async () => {
        const storage = new SqliteStore(":memory:");
        await storage.connect();
        const sp = new SemanticPackage("antonym-owner", ontology, storage);
        await sp.ready();
        await sp.tags.define("A");
        await sp.tags.define("B", {antonym: "A"});
        await sp.tags.define("C");
        await sp.tags.get("A")!.addAntonym("C");
        expect(sp.tags.get("A")!.isAntonymOf("B")).toBe(true);
        expect(sp.tags.get("A")!.isAntonymOf("C")).toBe(true);
        await sp.tags.get("A")!.removeAntonym("B");
        expect(sp.tags.get("A")!.isAntonymOf("B")).toBe(false);
        expect(sp.tags.get("A")!.isAntonymOf("C")).toBe(true);
        await storage.close();
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
