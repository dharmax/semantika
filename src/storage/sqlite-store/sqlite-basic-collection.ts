import {generate} from "short-uuid";
import {DuplicateKeyError, ICollection, IFindOptions, IPhysicalCollection, StreamFormats} from "../storage.js";
import {IReadOptions, IReadResult} from "../../types.js";
import {LoggedException} from "../../utils/logged-exception.js";

export class SqliteBasicCollection implements IPhysicalCollection, ICollection {
    constructor(private db: any, private tableName: string) {}

    get name() {
        return this.tableName;
    }

    watch(callback: (change: any) => Promise<boolean>, ..._args: any[]): void {
        console.warn("Watch is not natively supported in SQLite; polling or pubsub events recommended.");
    }

    private getRow(id: string): any {
        const stmt = this.db.prepare(`SELECT * FROM "${this.tableName}" WHERE _id = ?`);
        return stmt.get ? stmt.get(id) : stmt.all(id)[0];
    }

    async updateDocumentUnsafe(_id: string, fields: Object): Promise<boolean> {
        const existing = this.getRow(_id);
        if (!existing) return false;

        const currentData = JSON.parse(existing.data || "{}");
        const mergedData = { ...currentData, ...fields };
        delete mergedData._id;
        delete mergedData.id;

        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            UPDATE "${this.tableName}"
            SET data = ?, _lastUpdate = ?
            WHERE _id = ?
        `);
        const res = stmt.run(JSON.stringify(mergedData), now, _id);
        return (res.changes ?? res.rowCount ?? 1) > 0;
    }

    async updateDocument(_id: string, fields: Object, version?: number, _rawOperations: Object = {}): Promise<any> {
        const existing = this.getRow(_id);
        if (!existing) {
            throw new LoggedException(`Record not found with id ${_id} in collection ${this.tableName}`);
        }

        const expectedVersion = version !== undefined ? version : (fields as any)["_version"];
        if (expectedVersion !== undefined && existing._version !== expectedVersion) {
            throw new LoggedException(
                `Optimistic locking exception on collection ${this.name}: ver ${existing._version} instead of ${expectedVersion}`
            );
        }

        const currentData = JSON.parse(existing.data || "{}");
        const mergedData = { ...currentData, ...fields };
        delete mergedData._id;
        delete mergedData.id;
        delete mergedData._version;

        const nextVersion = existing._version + 1;
        const now = new Date().toISOString();

        const stmt = this.db.prepare(`
            UPDATE "${this.tableName}"
            SET data = ?, _version = ?, _lastUpdate = ?
            WHERE _id = ? AND _version = ?
        `);
        const res = stmt.run(JSON.stringify(mergedData), nextVersion, now, _id, existing._version);
        if ((res.changes ?? res.rowCount ?? 0) === 0) {
            throw new LoggedException(`Optimistic locking failed on collection ${this.name} for ${_id}`);
        }

        return true;
    }

    async findById<T extends Object>(_id: string, projection?: string[]): Promise<T> {
        return this.findOne({ _id }, projection);
    }

    private buildWhereClause(query: any, params: any[]): string {
        if (!query || Object.keys(query).length === 0) return "";

        const conditions: string[] = [];

        if (query.$or && Array.isArray(query.$or)) {
            const orClauses = query.$or.map((subQuery: any) => {
                const subConditions: string[] = [];
                for (const [key, val] of Object.entries(subQuery)) {
                    subConditions.push(this.buildFieldCondition(key, val, params));
                }
                return `(${subConditions.join(" AND ")})`;
            });
            conditions.push(`(${orClauses.join(" OR ")})`);
        }

        for (const [key, val] of Object.entries(query)) {
            if (key === "$or") continue;
            conditions.push(this.buildFieldCondition(key, val, params));
        }

        return conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    }

    private buildFieldCondition(key: string, val: any, params: any[]): string {
        const isCoreColumn = ["_id", "_version", "_created", "_lastUpdate"].includes(key);
        const colExpr = isCoreColumn ? `"${key}"` : `json_extract(data, '$.' || '${key}')`;

        if (key === "_tags" || key === "tags") {
            if (typeof val === "string") {
                params.push(val);
                return `EXISTS (SELECT 1 FROM json_each(data, '$._tags') WHERE value = ?)`;
            }
            if (val && typeof val === "object") {
                if ("$in" in val && Array.isArray(val.$in)) {
                    if (val.$in.length === 0) return "1 = 0";
                    const placeholders = val.$in.map(() => "?").join(", ");
                    params.push(...val.$in);
                    return `EXISTS (SELECT 1 FROM json_each(data, '$._tags') WHERE value IN (${placeholders}))`;
                }
                if ("$all" in val && Array.isArray(val.$all)) {
                    if (val.$all.length === 0) return "1 = 1";
                    const clauses = val.$all.map((item: any) => {
                        params.push(item);
                        return `EXISTS (SELECT 1 FROM json_each(data, '$._tags') WHERE value = ?)`;
                    });
                    return `(${clauses.join(" AND ")})`;
                }
            }
        }

        if (val && typeof val === "object" && "$in" in val && Array.isArray(val.$in)) {
            if (val.$in.length === 0) return "1 = 0";
            const placeholders = val.$in.map(() => "?").join(", ");
            params.push(...val.$in);
            return `${colExpr} IN (${placeholders})`;
        }

        params.push(val);
        return `${colExpr} = ?`;
    }

    async find(query: any, options: IFindOptions = {}): Promise<any> {
        const items = await this.findSome(query, options);
        let index = 0;
        return {
            toArray: async () => items,
            hasNext: async () => index < items.length,
            next: async () => (index < items.length ? items[index++] : null),
            stream: (opts?: any) => {
                const transform = opts?.transform || ((x: any) => x);
                return {
                    on: (event: string, handler: Function) => {
                        if (event === "data") {
                            for (const item of items) handler(transform(item));
                        }
                        if (event === "end") handler();
                    }
                };
            }
        };
    }

    async *findGenerator(query: any, options: IFindOptions = {}): AsyncGenerator<Object> {
        const items = await this.findSome(query, options);
        for (const item of items) yield item;
    }

    async distinct(field: string, query: any, _options: IFindOptions = {}): Promise<any[]> {
        const params: any[] = [];
        const whereClause = this.buildWhereClause(query, params);
        const isCoreColumn = ["_id", "_version", "_created", "_lastUpdate"].includes(field);
        const colExpr = isCoreColumn ? `"${field}"` : `json_extract(data, '$.' || '${field}')`;

        const sql = `SELECT DISTINCT ${colExpr} AS val FROM "${this.tableName}"${whereClause}`;
        const stmt = this.db.prepare(sql);
        const rows = stmt.all ? stmt.all(...params) : stmt.all(params);
        return rows.map((r: any) => r.val);
    }

    async findSome<T>(query: any, options: IFindOptions = {}): Promise<T[]> {
        const params: any[] = [];
        let sql = `SELECT * FROM "${this.tableName}"`;
        sql += this.buildWhereClause(query, params);

        if (options.sort && Object.keys(options.sort).length > 0) {
            const sortClauses = Object.entries(options.sort).map(([key, dir]) => {
                const isCore = ["_id", "_version", "_created", "_lastUpdate"].includes(key);
                const expr = isCore ? `"${key}"` : `json_extract(data, '$.' || '${key}')`;
                return `${expr} ${dir === -1 ? "DESC" : "ASC"}`;
            });
            sql += ` ORDER BY ${sortClauses.join(", ")}`;
        }

        if (options.limit !== undefined) {
            sql += ` LIMIT ${options.limit}`;
        }
        if (options.from !== undefined) {
            sql += ` OFFSET ${options.from}`;
        }

        const stmt = this.db.prepare(sql);
        const rows = stmt.all ? stmt.all(...params) : stmt.all(params);

        let results: any[] = rows.map((r: any) => {
            const data = JSON.parse(r.data || "{}");
            const item = {
                ...data,
                _id: r._id,
                _version: r._version,
                _created: r._created,
                _lastUpdate: r._lastUpdate
            };
            if (options.projection && options.projection.length > 0) {
                const projected: any = { _id: item._id, _version: item._version };
                for (const f of options.projection) {
                    if (item[f] !== undefined) projected[f] = item[f];
                }
                return projected;
            }
            return item;
        });

        if (options.filterFunction) {
            results = await options.filterFunction(results);
        }

        return results as T[];
    }

    async findSomeStream<T>(query: any, options: IFindOptions, _format = StreamFormats.strings): Promise<any> {
        return this.find(query, options);
    }

    async count(query: any): Promise<number> {
        const params: any[] = [];
        const whereClause = this.buildWhereClause(query, params);
        const sql = `SELECT COUNT(*) AS count FROM "${this.tableName}"${whereClause}`;
        const stmt = this.db.prepare(sql);
        const row = stmt.get ? stmt.get(...params) : stmt.all(...params)[0];
        return row ? Number(row.count) : 0;
    }

    async findOne<T>(query: any, projection?: string[]): Promise<T> {
        const items = await this.findSome<T>(query, { limit: 1, projection });
        return items.length ? items[0] : (null as any);
    }

    async load<T>(opt: IReadOptions, query?: Object): Promise<IReadResult> {
        const items = await this.findSome<T>(query, {
            limit: opt.count,
            from: opt.from,
            projection: opt.projection,
            sort: opt.sort,
            filterFunction: opt.filterFunction
        });
        const total = await this.count(query);
        return { items, totalFiltered: total, total, opts: opt };
    }

    async append(doc: any): Promise<string> {
        const _id = doc.id || doc._id || this.createId();
        const _version = doc._version || 1;
        const now = new Date().toISOString();
        const _created = doc._created || now;
        const _lastUpdate = doc._lastUpdate || now;

        const data = { ...doc };
        delete data._id;
        delete data.id;
        delete data._version;
        delete data._created;
        delete data._lastUpdate;

        const sql = `
            INSERT INTO "${this.tableName}" (_id, _version, _created, _lastUpdate, data)
            VALUES (?, ?, ?, ?, ?)
        `;

        try {
            const stmt = this.db.prepare(sql);
            stmt.run(_id, _version, _created, _lastUpdate, JSON.stringify(data));
            return _id;
        } catch (e: any) {
            if (e.message && (e.message.includes("UNIQUE constraint failed") || e.message.includes("PRIMARY KEY"))) {
                throw new DuplicateKeyError(this.tableName);
            }
            throw e;
        }
    }

    async deleteById(_id: string): Promise<boolean> {
        const stmt = this.db.prepare(`DELETE FROM "${this.tableName}" WHERE _id = ?`);
        const res = stmt.run(_id);
        return (res.changes ?? res.rowCount ?? 0) > 0;
    }

    async deleteByQuery(query: any): Promise<number> {
        const params: any[] = [];
        const whereClause = this.buildWhereClause(query, params);
        const sql = `DELETE FROM "${this.tableName}"${whereClause}`;
        const stmt = this.db.prepare(sql);
        const res = stmt.run(...params);
        return res.changes ?? res.rowCount ?? 0;
    }

    ensureIndex(keys: Object, options: { unique?: boolean } = {}) {
        const fieldEntries = Object.keys(keys);
        if (fieldEntries.length === 0) return;

        const indexName = `idx_${this.tableName.replace(/[^a-zA-Z0-9_]/g, "_")}_${fieldEntries.join("_")}`;
        const indexExprs = fieldEntries.map(f => {
            if (["_id", "_version", "_created", "_lastUpdate"].includes(f)) {
                return `"${f}"`;
            }
            return `(json_extract(data, '$.' || '${f}'))`;
        });

        const uniqueStr = options.unique ? "UNIQUE" : "";
        const sql = `CREATE ${uniqueStr} INDEX IF NOT EXISTS "${indexName}" ON "${this.tableName}" (${indexExprs.join(", ")})`;
        this.db.exec(sql);
    }

    async findOneAndModify(criteria: any, change: Object) {
        await this.updateDocumentUnsafe(criteria._id, change);
        return this.findById(criteria._id);
    }

    createId() {
        return generate();
    }
}
