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
