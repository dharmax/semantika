export interface IVectorSearchResult {
    readonly id: string;
    readonly score: number;
    readonly metadata?: Record<string, any>;
}

export interface IVectorQueryOptions {
    limit?: number;
    minScore?: number;
    filter?: Record<string, any>;
}

/**
 * Service adapter interface for pluggable vector databases (Qdrant, Chroma, Pinecone, pgvector, etc.)
 */
export interface IVectorStore {
    readonly name: string;
    upsert(id: string, vector: number[], metadata?: Record<string, any>): Promise<void>;
    query(vector: number[], options?: IVectorQueryOptions): Promise<IVectorSearchResult[]>;
    delete(id: string): Promise<boolean>;
    get?(id: string): Promise<{ id: string; vector: number[]; metadata?: Record<string, any> } | null>;
}

/**
 * Pluggable text embedder interface.
 */
export interface IEmbeddingProvider {
    embed(text: string): Promise<number[]>;
}

interface VectorEntry {
    id: string;
    vector: number[];
    magnitude: number;
    metadata?: Record<string, any>;
}

/**
 * High-performance, zero-dependency in-memory vector store using cosine similarity.
 */
export class InMemoryVectorStore implements IVectorStore {
    readonly name = "in-memory-vector-store";
    private readonly entries = new Map<string, VectorEntry>();
    private dimension?: number;

    async upsert(id: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
        if (!Array.isArray(vector) || vector.length === 0) {
            throw new Error(`Vector must be a non-empty array of numbers.`);
        }
        if (this.dimension === undefined) {
            this.dimension = vector.length;
        } else if (vector.length !== this.dimension) {
            throw new Error(`Vector dimension mismatch: expected ${this.dimension}, received ${vector.length}.`);
        }
        const magnitude = computeMagnitude(vector);
        this.entries.set(id, { id, vector, magnitude, metadata });
    }

    async query(vector: number[], options: IVectorQueryOptions = {}): Promise<IVectorSearchResult[]> {
        if (this.dimension !== undefined && vector.length !== this.dimension) {
            throw new Error(`Query vector dimension mismatch: expected ${this.dimension}, received ${vector.length}.`);
        }
        const queryMag = computeMagnitude(vector);
        if (queryMag === 0) return [];

        const limit = options.limit ?? 10;
        const minScore = options.minScore ?? -Infinity;
        const results: IVectorSearchResult[] = [];

        for (const entry of this.entries.values()) {
            if (options.filter && !matchesFilter(entry.metadata, options.filter)) {
                continue;
            }

            const score = cosineSimilarity(vector, queryMag, entry.vector, entry.magnitude);
            if (score >= minScore) {
                results.push({ id: entry.id, score, metadata: entry.metadata });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }

    async delete(id: string): Promise<boolean> {
        return this.entries.delete(id);
    }

    async get(id: string): Promise<{ id: string; vector: number[]; metadata?: Record<string, any> } | null> {
        const entry = this.entries.get(id);
        if (!entry) return null;
        return { id: entry.id, vector: entry.vector, metadata: entry.metadata };
    }

    get size(): number {
        return this.entries.size;
    }
}

function computeMagnitude(v: number[]): number {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    return Math.sqrt(sum);
}

function cosineSimilarity(a: number[], magA: number, b: number[], magB: number): number {
    const minLen = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < minLen; i++) dot += a[i] * b[i];
    const denom = magA * magB;
    return denom === 0 ? 0 : dot / denom;
}

function matchesFilter(metadata: Record<string, any> | undefined, filter: Record<string, any>): boolean {
    if (!metadata) return false;
    for (const [key, val] of Object.entries(filter)) {
        if (metadata[key] !== val) return false;
    }
    return true;
}
