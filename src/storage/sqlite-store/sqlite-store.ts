import {AbstractStorage, ICollection, IPhysicalCollection, StorageSession} from "../storage.js";
import {EntityDcr} from "../../descriptors.js";
import {SqliteBasicCollection} from "./sqlite-basic-collection.js";
import {SemanticPackage} from "../../semantic-package.js";
import {EntityCollection} from "../../entities-collection.js";
import {PredicateCollection} from "../../predicates-collection.js";

export class SqliteStore extends AbstractStorage {
    public db: any;
    private dbPath: string;

    constructor(target?: string | any) {
        super();
        if (typeof target === "string" || !target) {
            this.dbPath = target || ":memory:";
            this.initDatabase(this.dbPath);
        } else {
            this.db = target;
            this.dbPath = ":instance:";
        }
    }

    private initDatabase(dbPath: string) {
        // 1. Try bun:sqlite
        try {
            // @ts-ignore
            const { Database } = require("bun:sqlite");
            if (Database) {
                this.db = new Database(dbPath);
                this.db.exec("PRAGMA journal_mode = WAL;");
                this.db.exec("PRAGMA synchronous = NORMAL;");
                this.db.exec("PRAGMA busy_timeout = 5000;");
                return;
            }
        } catch {}

        // 2. Try node:sqlite (Node.js 22+)
        try {
            // @ts-ignore
            const { DatabaseSync } = require("node:sqlite");
            if (DatabaseSync) {
                this.db = new DatabaseSync(dbPath);
                this.db.exec("PRAGMA journal_mode = WAL;");
                this.db.exec("PRAGMA synchronous = NORMAL;");
                this.db.exec("PRAGMA busy_timeout = 5000;");
                return;
            }
        } catch {}

        // 3. Try better-sqlite3
        try {
            // @ts-ignore
            const Database = require("better-sqlite3");
            if (Database) {
                this.db = new Database(dbPath);
                this.db.pragma("journal_mode = WAL");
                return;
            }
        } catch {}

        throw new Error("No SQLite driver found. Please run on Bun or Node.js with node:sqlite or better-sqlite3 installed.");
    }

    async connect(): Promise<boolean> {
        if (!this.db) {
            this.initDatabase(this.dbPath);
        }
        return true;
    }


    /** Atomically persist prevalidated records. Collections must already be initialized.
     * expectedVersion=null asserts absence; a positive version asserts the current record.
     * This method never awaits or changes caller-owned entities. Returned records are fresh DTOs.
     */
    applyBatch(changes: ReadonlyArray<{
        collectionName: string; id: string; expectedVersion: number | null;
        record: Record<string, unknown> | null;
    }>): Array<Record<string, unknown>> {
        const activeTransaction = this.db.inTransaction ?? this.db.isTransaction;
        if (activeTransaction !== false) throw new Error("Batch requires an independent native SQLite transaction.");
        const keys = new Set<string>();
        const prepared = changes.map(change => {
            if (!/^[a-zA-Z0-9_-]+$/.test(change.collectionName) || !change.id)
                throw new Error("Invalid batch collection or identity.");
            if (change.expectedVersion !== null && (!Number.isSafeInteger(change.expectedVersion) || change.expectedVersion < 1))
                throw new Error("Batch requires an exact positive version or explicit absence.");
            if (change.record === null && change.expectedVersion === null)
                throw new Error("Deletion requires an existing revision.");
            const key = JSON.stringify([change.collectionName, change.id]);
            if (keys.has(key)) throw new Error("Duplicate batch identity.");
            keys.add(key);
            const data = {...change.record};
            for (const field of ["id", "_id", "_version", "_created", "_lastUpdate"]) delete data[field];
            return {...change, data: JSON.stringify(data)};
        });
        const result: Array<Record<string, unknown>> = [];
        this.db.exec("SAVEPOINT semantika_batch");
        try {
            for (const change of prepared) {
                const table = '"' + change.collectionName + '"';
                const old = this.db.prepare(`SELECT _version, _created FROM ${table} WHERE _id = ?`).get(change.id);
                if ((old?._version ?? null) !== change.expectedVersion)
                    throw new Error("Stale batch revision for " + change.id);
                const now = new Date().toISOString();
                if (change.record === null) {
                    this.db.prepare(`DELETE FROM ${table} WHERE _id = ?`).run(change.id);
                } else {
                    const version = (old?._version ?? 0) + 1;
                    const created = old?._created ?? now;
                    if (old) this.db.prepare(`UPDATE ${table} SET data = ?, _version = ?, _lastUpdate = ? WHERE _id = ?`)
                        .run(change.data, version, now, change.id);
                    else this.db.prepare(`INSERT INTO ${table} (_id, _version, _created, _lastUpdate, data) VALUES (?, ?, ?, ?, ?)`)
                        .run(change.id, version, created, now, change.data);
                    result.push({...JSON.parse(change.data), _id: change.id, _version: version, _created: created, _lastUpdate: now});
                }
            }
            this.db.exec("RELEASE SAVEPOINT semantika_batch");
            return result;
        } catch (error) {
            this.db.exec("ROLLBACK TO SAVEPOINT semantika_batch");
            this.db.exec("RELEASE SAVEPOINT semantika_batch");
            throw error;
        }
    }

    async startSession(): Promise<StorageSession> {
        return {
            endSession: async () => {},
            withTransaction: async (fn: any) => fn()
        } as any;
    }

    async purgeDatabase(): Promise<any> {
        const stmt = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        const tables = stmt.all ? stmt.all() : stmt.all();
        for (const t of tables) {
            const tableName = t.name;
            this.db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
        }
        return true;
    }

    async close(): Promise<void> {
        if (this.db && typeof this.db.close === "function") {
            this.db.close();
        }
    }

    async getPhysicalCollection(name: string, _forPredicates?: boolean): Promise<IPhysicalCollection> {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS "${name}" (
                _id TEXT PRIMARY KEY,
                _version INTEGER NOT NULL DEFAULT 1,
                _created TEXT NOT NULL,
                _lastUpdate TEXT NOT NULL,
                data TEXT NOT NULL
            )
        `);
        return name;
    }

    makeEntityCollection(physicalCollection: IPhysicalCollection, eDcr: EntityDcr, initFunc: (col: EntityCollection) => void): EntityCollection {
        const c = new EntityCollection(eDcr, this.makeBasicCollection(physicalCollection));
        initFunc && initFunc(c);
        return c;
    }

    makePredicateCollection(semanticPackage: SemanticPackage, physicalCollection: IPhysicalCollection): PredicateCollection {
        return new PredicateCollection(semanticPackage, this.makeBasicCollection(physicalCollection));
    }

    makeBasicCollection(physicalCollection: IPhysicalCollection, initFunc?: (col: SqliteBasicCollection) => void): ICollection {
        const c = new SqliteBasicCollection(this.db, physicalCollection as string);
        initFunc && initFunc(c);
        return c;
    }
}
