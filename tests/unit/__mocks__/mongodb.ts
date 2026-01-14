// Minimal in-memory mock of the MongoDB driver for tests.
// This mock aims to be small but compatible with the Database tests:
// - Exports a constructible `MongoClient` (so `new MongoClient()` works)
// - `MongoClient.connect()` / `close()`
// - `db()` that returns a DB-like object with `createCollection`, `listCollections`, and `collection(name)`
// - Collections support `replaceOne`, `updateOne`, `find`, `findOne`, `aggregate`, `countDocuments`, `deleteOne`
// The implementation is intentionally simple and synchronous-ish to keep tests deterministic.

type AnyDoc = { [key: string]: any };

export class MongoClient {
    uri: string;
    opts: any;
    connected: boolean = false;
    private dbs: Map<string, MockDb> = new Map();

    constructor(uri?: string, opts?: any) {
        this.uri = uri || 'mongodb://localhost:27017';
        this.opts = opts;
    }

    async connect() {
        this.connected = true;
        return this;
    }

    db(name?: string) {
        const dbName = name || 'test_db';
        if (!this.dbs.has(dbName)) {
            this.dbs.set(dbName, new MockDb(dbName));
        }
        return this.dbs.get(dbName)!;
    }

    async close() {
        this.connected = false;
        return;
    }
}

// Provide a runtime `Db` value for imports that expect it
export const Db: any = null;

class MockDb {
    name: string;
    collections: Map<string, AnyDoc[]> = new Map();

    constructor(name: string) {
        this.name = name;
    }

    listCollections() {
        const arr = Array.from(this.collections.keys()).map((name) => ({ name }));
        return { toArray: async () => arr };
    }

    async createCollection(name: string) {
        if (this.collections.has(name)) {
            const e: any = new Error('NamespaceExists');
            e.code = 48;
            throw e;
        }
        this.collections.set(name, []);
        return;
    }

    collection(name: string) {
        if (!this.collections.has(name)) {
            this.collections.set(name, []);
        }
        return new MockCollection(this, name);
    }
}

class MockCollection {
    private db: MockDb;
    private name: string;

    constructor(db: MockDb, name: string) {
        this.db = db;
        this.name = name;
        if (!this.db.collections.has(this.name)) {
            this.db.collections.set(this.name, []);
        }
    }

    private _getData(): AnyDoc[] {
        return this.db.collections.get(this.name)!;
    }

    private _clone(obj: AnyDoc) {
        return JSON.parse(JSON.stringify(obj));
    }

    async replaceOne(filter: AnyDoc, doc: AnyDoc, options?: AnyDoc) {
        const key = Object.keys(filter)[0];
        const val = filter[key];
        const data = this._getData();
        const idx = data.findIndex((d: AnyDoc) => d && d[key] === val);
        if (idx >= 0) {
            data[idx] = this._clone(doc);
            return { matchedCount: 1, modifiedCount: 1 };
        } else {
            if (options && options.upsert) {
                data.push(this._clone(doc));
                return { matchedCount: 0, modifiedCount: 0, upsertedId: { _id: doc[key] } };
            }
            return { matchedCount: 0, modifiedCount: 0 };
        }
    }

    async updateOne(filter: AnyDoc, update: AnyDoc) {
        const data = this._getData();
        const idx = data.findIndex((d: AnyDoc) => matchesFilter(d, filter));
        if (idx < 0) {
            return { matchedCount: 0, modifiedCount: 0 };
        }
        let modified = false;
        const doc = data[idx];

        if (update.$set) {
            for (const k of Object.keys(update.$set)) {
                if (doc[k] !== update.$set[k]) {
                    doc[k] = update.$set[k];
                    modified = true;
                }
            }
        }

        if (update.$addToSet) {
            for (const k of Object.keys(update.$addToSet)) {
                const valToAdd = update.$addToSet[k];
                if (!Array.isArray(doc[k])) doc[k] = [];
                if (!doc[k].includes(valToAdd)) {
                    doc[k].push(valToAdd);
                    modified = true;
                }
            }
        }

        if (update.$pull) {
            for (const k of Object.keys(update.$pull)) {
                const pullVal = update.$pull[k];
                if (Array.isArray(doc[k])) {
                    const origLen = doc[k].length;
                    doc[k] = doc[k].filter((x: any) => x !== pullVal);
                    if (doc[k].length !== origLen) modified = true;
                }
            }
        }

        return modified ? { matchedCount: 1, modifiedCount: 1 } : { matchedCount: 1, modifiedCount: 0 };
    }

    find(filter: AnyDoc = {}, options?: AnyDoc) {
        return new MockCursor(this._getData(), filter, options);
    }

    async findOne(filter: AnyDoc) {
        return this._getData().find((d: AnyDoc) => matchesFilter(d, filter)) || null;
    }

    async deleteOne(filter: AnyDoc) {
        const data = this._getData();
        const idx = data.findIndex((d: AnyDoc) => matchesFilter(d, filter));
        if (idx >= 0) {
            data.splice(idx, 1);
            return { deletedCount: 1 };
        }
        return { deletedCount: 0 };
    }

    async countDocuments(filter: AnyDoc = {}) {
        return this._getData().filter((d: AnyDoc) => matchesFilter(d, filter)).length;
    }

    aggregate(pipeline: any[]) {
       // Minimal support for $sample and a simple $group average for `interestingness_score`
        const sampleStage = pipeline.find((s) => s && s.$sample);
        if (sampleStage) {
            const size = sampleStage.$sample.size || 1;
            const data = [...this._getData()];
            for (let i = data.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [data[i], data[j]] = [data[j], data[i]];
            }
            return { toArray: async () => data.slice(0, size) };
        }

        const groupStage = pipeline.find((s) => s && s.$group);
        if (groupStage && groupStage.$group && groupStage.$group.avg_score) {
            const values = this._getData()
                .map((d: any) => d.interestingness_score)
                .filter((v: any) => typeof v === 'number');
            const avg = values.length ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0;
            return { toArray: async () => [{ avg_score: avg }] };
        }

        return { toArray: async () => [] };
    }
}

class MockCursor {
    private data: AnyDoc[];
    private filter: AnyDoc;
    private options: AnyDoc | undefined;
    private _sort: Record<string, number> | null = null;
    private _skip = 0;
    private _limit = Infinity;

    constructor(data: AnyDoc[], filter: AnyDoc, options?: AnyDoc) {
        this.data = data;
        this.filter = filter || {};
        this.options = options;
    }

    sort(sortObj: any) {
        this._sort = sortObj;
        return this;
    }

    skip(n: number) {
        this._skip = n;
        return this;
    }

    limit(n: number) {
        this._limit = n;
        return this;
    }

    async toArray() {
        let result = this.data.filter((d) => matchesFilter(d, this.filter));
        if (this._sort) {
            const entries = Object.entries(this._sort) as [string, number][];
            const [[key, dir]] = entries;
            const dirNum: number = Number(dir) || 1;
            result.sort((a: AnyDoc, b: AnyDoc) => {
                const av = a[key];
                const bv = b[key];
                // Handle undefined values consistently (undefined -> push to end)
                if (av === undefined && bv === undefined) return 0;
                if (av === undefined) return 1 * dirNum;
                if (bv === undefined) return -1 * dirNum;
                if (av < bv) return -1 * dirNum;
                if (av > bv) return 1 * dirNum;
                return 0;
            });
        }
        return result.slice(this._skip, Math.min(result.length, this._skip + this._limit));
    }
}

// A small filter matcher that understands:
// - simple equality
// - $or array
// - $regex with $options (case-insensitive)
// - $ne, $in, and $exists operators
function matchesFilter(doc: AnyDoc, filter: AnyDoc): boolean {
    if (!filter || Object.keys(filter).length === 0) return true;
    if (filter.$or && Array.isArray(filter.$or)) {
        return filter.$or.some((f) => matchesFilter(doc, f));
    }

    return Object.keys(filter).every((k) => {
        const val = filter[k];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            // Handle compound queries like { $exists: true, $ne: null }
            let result = true;
            let hasOperator = false;
            
            if (val.$exists !== undefined) {
                hasOperator = true;
                const fieldExists = k in doc && doc[k] !== undefined;
                if (val.$exists && !fieldExists) result = false;
                if (!val.$exists && fieldExists) result = false;
            }
            
            if (val.$regex) {
                hasOperator = true;
                const re = new RegExp(val.$regex, val.$options || '');
                if (!re.test(String(doc[k] || ''))) result = false;
            }
            
            if (val.$ne !== undefined) {
                hasOperator = true;
                if (doc[k] === val.$ne) result = false;
            }
            
            if (val.$in) {
                hasOperator = true;
                if (!val.$in.includes(doc[k])) result = false;
            }
            
            if (hasOperator) return result;
        }
        return doc[k] === val;
    });
}

