import {generate} from "short-uuid";
import {DuplicateKeyError, ICollection, IFindOptions, IPhysicalCollection, StreamFormats} from "../storage.js";
import {IReadOptions, IReadResult} from "../../types.js";
import {LoggedException} from "../../utils/logged-exception.js";

export class PostgresBasicCollection implements IPhysicalCollection, ICollection {
    constructor(private pool: any, private tableName: string) {}

    get name() {
        return this.tableName;
    }

    watch(callback: (change: any) => Promise<boolean>, ..._args: any[]): void {
        console.warn("Watch not fully implemented for Postgres yet. Polling or NOTIFY could be used.");
    }

    async updateDocumentUnsafe(_id: string, fields: Object): Promise<boolean> {
        const query = `
            UPDATE "${this.tableName}"
            SET data = data || $1,
                _lastUpdate = CURRENT_TIMESTAMP
            WHERE _id = $2
        `;
        const result = await this.pool.query(query, [JSON.stringify(fields), _id]);
        return result.rowCount === 1;
    }

    async updateDocument(_id: string, fields: Object, version?: number, _rawOperations: Object = {}): Promise<any> {
        const ver = version !== undefined ? version : (fields as any)["_version"];
        const updateData = { ...fields };
        delete (updateData as any)._id;
        delete (updateData as any).id;
        delete (updateData as any)._version;

        const query = `
            UPDATE "${this.tableName}" 
            SET data = data || $1, 
                _version = _version + 1,
                _lastUpdate = CURRENT_TIMESTAMP
            WHERE _id = $2 ${ver !== undefined ? "AND _version = $3" : ""}
            RETURNING *
        `;
        const params = ver !== undefined ? [JSON.stringify(updateData), _id, ver] : [JSON.stringify(updateData), _id];
        const result = await this.pool.query(query, params);
        if (result.rowCount === 1) return true;

        throw new LoggedException(`Optimistic locking exception or record not found in ${this.tableName} for ${_id}`);
    }

    async findById<T extends Object>(_id: string, projection?: string[]): Promise<T> {
        return this.findOne({ _id }, projection);
    }

    private buildWhereClause(query: any, values: any[]): string {
        if (!query || Object.keys(query).length === 0) return "";

        const conditions: string[] = [];

        if (query.$or && Array.isArray(query.$or)) {
            const orClauses = query.$or.map((subQuery: any) => {
                const subConditions: string[] = [];
                for (const [key, val] of Object.entries(subQuery)) {
                    subConditions.push(this.buildFieldCondition(key, val, values));
                }
                return `(${subConditions.join(" AND ")})`;
            });
            conditions.push(`(${orClauses.join(" OR ")})`);
        }

        for (const [key, val] of Object.entries(query)) {
            if (key === "$or") continue;
            conditions.push(this.buildFieldCondition(key, val, values));
        }

        return conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    }

    private buildFieldCondition(key: string, val: any, values: any[]): string {
        const isCore = ["_id", "_version", "_created", "_lastUpdate"].includes(key);
        const colExpr = isCore ? `"${key}"` : `data->>'${key}'`;

        if (val && typeof val === "object" && "$in" in val && Array.isArray(val.$in)) {
            if (val.$in.length === 0) return "1 = 0";
            const placeholders = val.$in.map((item: any) => {
                values.push(item);
                return `$${values.length}`;
            });
            return `${colExpr} IN (${placeholders.join(", ")})`;
        }

        values.push(val);
        return `${colExpr} = $${values.length}`;
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
        const cursor = await this.find(query, options);
        const rows = await cursor.toArray();
        for (const row of rows) yield row;
    }

    async distinct(field: string, query: any): Promise<any> {
        const values: any[] = [];
        const whereClause = this.buildWhereClause(query, values);
        const isCore = ["_id", "_version", "_created", "_lastUpdate"].includes(field);
        const colExpr = isCore ? `"${field}"` : `data->>'${field}'`;

        const res = await this.pool.query(`SELECT DISTINCT ${colExpr} AS val FROM "${this.tableName}"${whereClause}`, values);
        return res.rows.map((r: any) => r.val);
    }

    async findSome<T>(query: any, options: IFindOptions = {}): Promise<T[]> {
        let sql = `SELECT * FROM "${this.tableName}"`;
        const values: any[] = [];
        sql += this.buildWhereClause(query, values);

        if (options.sort && Object.keys(options.sort).length > 0) {
            const sortClauses = Object.entries(options.sort).map(([key, dir]) => {
                const isCore = ["_id", "_version", "_created", "_lastUpdate"].includes(key);
                const expr = isCore ? `"${key}"` : `data->>'${key}'`;
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

        const res = await this.pool.query(sql, values);
        let items = res.rows.map((r: any) => {
            const data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
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
            items = await options.filterFunction(items);
        }

        return items as T[];
    }

    async findSomeStream<T>(query: any, options: IFindOptions, _format = StreamFormats.strings): Promise<any> {
        return this.find(query, options);
    }

    async count(query: any): Promise<number> {
        const values: any[] = [];
        const whereClause = this.buildWhereClause(query, values);
        const res = await this.pool.query(`SELECT COUNT(*) AS count FROM "${this.tableName}"${whereClause}`, values);
        return parseInt(res.rows[0].count, 10);
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
        const data = { ...doc };
        delete data._id;
        delete data.id;

        const query = `
            INSERT INTO "${this.tableName}" (_id, data)
            VALUES ($1, $2)
            RETURNING _id
        `;
        try {
            const res = await this.pool.query(query, [_id, JSON.stringify(data)]);
            return res.rows[0]._id;
        } catch (e: any) {
            if (e.code === "23505") throw new DuplicateKeyError(this.tableName);
            throw e;
        }
    }

    async deleteById(_id: string) {
        const res = await this.pool.query(`DELETE FROM "${this.tableName}" WHERE _id = $1`, [_id]);
        return res.rowCount === 1;
    }

    async deleteByQuery(query: any) {
        const values: any[] = [];
        const whereClause = this.buildWhereClause(query, values);
        const res = await this.pool.query(`DELETE FROM "${this.tableName}"${whereClause}`, values);
        return res.rowCount;
    }

    ensureIndex(keys: Object, options: { unique?: boolean } = {}) {
        const fieldEntries = Object.keys(keys);
        if (fieldEntries.length === 0) {
            // Default GIN index on data
            this.pool.query(`CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_gin_data" ON "${this.tableName}" USING gin (data)`).catch(() => {});
            return;
        }

        const indexName = `idx_${this.tableName}_${fieldEntries.join("_")}`;
        const indexExprs = fieldEntries.map(f => {
            if (["_id", "_version", "_created", "_lastUpdate"].includes(f)) {
                return `"${f}"`;
            }
            return `(data->>'${f}')`;
        });
        const uniqueStr = options.unique ? "UNIQUE" : "";
        const sql = `CREATE ${uniqueStr} INDEX IF NOT EXISTS "${indexName}" ON "${this.tableName}" (${indexExprs.join(", ")})`;
        this.pool.query(sql).catch((err: any) => console.warn("Failed to create index:", err.message));
    }

    async findOneAndModify(criteria: any, change: Object) {
        await this.updateDocumentUnsafe(criteria._id, change);
        return this.findById(criteria._id);
    }

    createId() {
        return generate();
    }
}
