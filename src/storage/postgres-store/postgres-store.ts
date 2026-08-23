import {AbstractStorage, ICollection, IPhysicalCollection, StorageSession} from "../storage.js";
import {EntityDcr} from "../../descriptors.js";
import {PostgresBasicCollection} from "./postgres-basic-collection.js";
import {SemanticPackage} from "../../semantic-package.js";
import {EntityCollection} from "../../entities-collection.js";
import {PredicateCollection} from "../../predicates-collection.js";

export class PostgresStore extends AbstractStorage {
    public pool: any;

    constructor(configOrPool: any) {
        super();
        if (configOrPool && typeof configOrPool.query === "function") {
            this.pool = configOrPool;
        } else {
            try {
                // @ts-ignore
                const { Pool } = require("pg");
                this.pool = new Pool(configOrPool);
            } catch {
                throw new Error("PostgreSQL driver not found. Please install 'pg' to use PostgresStore: `npm install pg`");
            }
        }
    }

    async connect() {
        const client = await this.pool.connect();
        client.release();
        return true;
    }

    async startSession(): Promise<StorageSession> {
        const client = await this.pool.connect();
        return client;
    }

    async purgeDatabase() {
        const res = await this.pool.query(`
            DO $$ DECLARE
                r RECORD;
            BEGIN
                FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
                    EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
                END LOOP;
            END $$;
        `);
        return res;
    }

    async close() {
        return this.pool.end();
    }

    async getPhysicalCollection(name: string): Promise<IPhysicalCollection> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS "${name}" (
                _id TEXT PRIMARY KEY,
                _version INT NOT NULL DEFAULT 1,
                _created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                _lastUpdate TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                data JSONB NOT NULL
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

    makeBasicCollection(physicalCollection: IPhysicalCollection, initFunc?: (col: PostgresBasicCollection) => void): ICollection {
        const c = new PostgresBasicCollection(this.pool, physicalCollection as string);
        initFunc && initFunc(c);
        return c;
    }
}
