import {describe, expect, it} from "bun:test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {InMemoryVectorStore, SemanticPackage, SqliteStore} from "../src/index.js";

const words = ["gpu", "server", "accelerator", "archive"];
const embedder = {
    async embed(text: string): Promise<number[]> {
        const normalized = text.toLowerCase();
        return words.map(word => normalized.includes(word) ? 1 : 0).concat(0.01);
    }
};

describe("tag search lifecycle", () => {
    it("does not let derived-index failure falsify committed semantic state", async () => {
        const storage = new SqliteStore(":memory:");
        await storage.connect();
        const sp = new SemanticPackage("degraded", {entityDcrs: [], predicateDcrs: []}, storage);
        await sp.ready();
        await sp.tags.define("Compute", {description: "gpu"});
        const vectors = new InMemoryVectorStore();
        let fail = false;
        const sometimesFailingEmbedder = {
            async embed(text: string) {
                if (fail) throw new Error("embed unavailable");
                return embedder.embed(text);
            }
        };
        await sp.tags.configureSearch({vectorStore: vectors, embeddingProvider: sometimesFailingEmbedder});
        fail = true;
        await expect(sp.tags.update("Compute", {description: "archive"})).resolves.toBe(sp.tags.get("Compute"));
        expect(sp.tags.get("Compute")!.description).toBe("archive");
        expect(await sp.tags.search("gpu server")).toEqual([]);
        fail = false;
        await sp.tags.configureSearch({vectorStore: vectors, embeddingProvider: sometimesFailingEmbedder});
        expect((await sp.tags.search("archive", {minScore: 0.9}))[0].tag).toBe(sp.tags.get("Compute"));
        await storage.close();
    });

    it("publishes search configuration only after a complete initial index", async () => {
        const storage = new SqliteStore(":memory:");
        await storage.connect();
        const sp = new SemanticPackage("atomic-config", {entityDcrs: [], predicateDcrs: []}, storage);
        await sp.ready();
        await sp.tags.define("Compute", {description: "gpu server"});
        const vectors = new InMemoryVectorStore();
        const broken = {embed: async () => { throw new Error("no embeddings"); }};
        await expect(sp.tags.configureSearch({vectorStore: vectors, embeddingProvider: broken})).rejects.toThrow("no embeddings");
        expect(await sp.tags.search("gpu server")).toEqual([]);
        await sp.tags.configureSearch({vectorStore: vectors, embeddingProvider: embedder});
        expect((await sp.tags.search("gpu server", {minScore: 0.9}))[0].tag).toBe(sp.tags.get("Compute"));
        await storage.close();
    });

    it("isolates tag vectors by semantic package when a vector store is shared", async () => {
        const storage = new SqliteStore(":memory:");
        await storage.connect();
        const vectors = new InMemoryVectorStore();
        const a = new SemanticPackage("package-a", {entityDcrs: [], predicateDcrs: []}, storage);
        const b = new SemanticPackage("package-b", {entityDcrs: [], predicateDcrs: []}, storage);
        await Promise.all([a.ready(), b.ready()]);
        await a.tags.define("Compute", {description: "gpu server"});
        await b.tags.define("Compute", {description: "archive"});
        await a.tags.configureSearch({vectorStore: vectors, embeddingProvider: embedder});
        await b.tags.configureSearch({vectorStore: vectors, embeddingProvider: embedder});
        expect(vectors.size).toBe(2);
        expect((await a.tags.search("gpu server", {minScore: 0.9}))[0].tag).toBe(a.tags.get("Compute"));
        expect((await b.tags.search("archive", {minScore: 0.9}))[0].tag).toBe(b.tags.get("Compute"));
        await storage.close();
    });

    it("drops an explicit vector when semantic text changes", async () => {
        const storage = new SqliteStore(":memory:");
        await storage.connect();
        const sp = new SemanticPackage("explicit", {entityDcrs: [], predicateDcrs: []}, storage);
        await sp.ready();
        await sp.tags.define("Compute", {description: "gpu", embedding: [1, 0, 0, 0, 0.01]});
        const vectors = new InMemoryVectorStore();
        await sp.tags.configureSearch({vectorStore: vectors, embeddingProvider: embedder});
        await sp.tags.update("Compute", {description: "archive"});
        expect((await vectors.get("explicit::Compute"))!.vector).toEqual(await embedder.embed("Compute\narchive"));
        expect(sp.tags.get("Compute")!.embedding).toBeUndefined();
        await storage.close();
    });

    it("reindexes persisted tags, refreshes semantic text and never creates tags from queries", async () => {
        const dir = await mkdtemp(join(tmpdir(), "semantika-search-"));
        const path = join(dir, "tags.db");
        try {
            const storage = new SqliteStore(path);
            await storage.connect();
            const first = new SemanticPackage("search", {entityDcrs: [], predicateDcrs: []}, storage);
            await first.ready();
            await first.tags.define("Compute", {description: "gpu server", displayName: "Compute Node"});
            await first.tags.define("Unused");
            await storage.close();

            const reopenedStore = new SqliteStore(path);
            await reopenedStore.connect();
            const sp = new SemanticPackage("search", {entityDcrs: [], predicateDcrs: []}, reopenedStore);
            const vectors = new InMemoryVectorStore();
            await sp.tags.configureSearch({vectorStore: vectors, embeddingProvider: embedder});
            expect(vectors.size).toBe(2);
            const compute = sp.tags.get("Compute")!;
            expect((await sp.tags.search("Compute Node", {limit: 1}))[0]).toMatchObject({tag: compute, match: "exact"});
            expect((await sp.tags.search("gpu server", {minScore: 0.9}))[0]).toMatchObject({tag: compute, match: "semantic"});

            const size = sp.tags.all().length;
            await sp.tags.search("totally unknown phrase");
            expect(sp.tags.all().length).toBe(size);
            expect(sp.tags.has("totally unknown phrase")).toBe(false);
            await vectors.upsert("ghost", await embedder.embed("archive"));
            expect(await sp.tags.search("archive", {minScore: 0.9})).toEqual([]);

            expect(await sp.tags.search("accelerator hardware", {minScore: 0.5})).toEqual([]);
            await sp.tags.update("Compute", {synonyms: {en: ["accelerator"]}});
            expect((await sp.tags.search("accelerator hardware", {minScore: 0.5}))[0].tag).toBe(compute);
            await sp.tags.update("Compute", {description: "archive"});
            expect((await sp.tags.search("archive files", {minScore: 0.5}))[0].tag).toBe(compute);

            await sp.tags.remove("Unused");
            expect(await vectors.get("search::Unused")).toBeNull();
            await sp.tags.remove("Compute");
            expect(await vectors.get("search::Compute")).toBeNull();
            expect(await sp.tags.search("archive files", {minScore: 0.5})).toEqual([]);
            await reopenedStore.close();
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });
});
