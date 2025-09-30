import { Db, MongoClient } from "mongodb";
import { Extension } from "../../types/extension";
import { logger, LogLevel } from "../../utils/logger";



export enum Collections {
    EXTENSIONS = "extensions",
    // MIGRATED_EXT = "extensions",
    LOGS = "logs",
    TESTS_MV2 = "tests_mv2",
    TESTS_MV3 = "tests_mv3"
}

export class Database {
    client: MongoClient | null = null;
    database: Db | null = null;
    private isShuttingDown: boolean = false;
    public static shared = new Database()

    private constructor() { }

    async init() {
        if (!process.env.MONGODB_URI) { throw Error("Could not find MONGODB_URI in environment") }
        this.client = new MongoClient(process.env.MONGODB_URI)

        try {
            await this.client.connect();
            if (!process.env.DB_NAME) { throw Error("Could not find DB_NAME in environment") }
            this.database = this.client.db(process.env.DB_NAME)
            logger.debug(null, "Successfully connected to Mongo DB");
        } catch (error) {
            logger.error(null, "Failed to connect to MongoDB:", error);
            throw error;
        }
    }


    private async upsertOne(collectionName: Collections, document: any, uniqueField: string = 'id') {
        if (this.isShuttingDown) {
            console.error(`[SHUTDOWN VIOLATION] Attempted upsertOne to ${collectionName} after shutdown`);
            console.error(`[SHUTDOWN VIOLATION] Stack trace:`, new Error().stack);
            return;
        }
        if (!this.database) throw new Error("Database not initialized");
        const filter = { [uniqueField]: document[uniqueField] };
        return await this.database.collection(collectionName).replaceOne(filter, document, { upsert: true });
    }

    /**
     * Check and truncate document if it's too large for MongoDB
     */
    private sanitizeDocumentSize(doc: any): any {
        const MAX_BSON_SIZE = 15 * 1024 * 1024; // 15MB to be safe (MongoDB limit is 16MB)

        try {
            const serialized = JSON.stringify(doc);
            const byteSize = Buffer.byteLength(serialized, 'utf8');

            if (byteSize <= MAX_BSON_SIZE) {
                return doc;
            }

            logger.warn(null, `Document too large (${byteSize} bytes), truncating...`);

            // If it's an Extension object, truncate file contents
            if (doc.files && Array.isArray(doc.files)) {
                const truncatedDoc = { ...doc };
                truncatedDoc.files = doc.files.map((file: any, index: number) => {
                    // Keep first 10 files, truncate the rest
                    if (index < 10) {
                        if (file.content && typeof file.content === 'string') {
                            const maxContentSize = Math.floor(MAX_BSON_SIZE / 20); // Rough estimate
                            if (file.content.length > maxContentSize) {
                                return {
                                    ...file,
                                    content: file.content.substring(0, maxContentSize) + '... [TRUNCATED]',
                                    _truncated: true,
                                    _originalSize: file.content.length
                                };
                            }
                        }
                        return file;
                    } else {
                        // Replace with summary for files beyond the first 10
                        return {
                            path: file.path || `file_${index}`,
                            _truncated: true,
                            _reason: 'File removed to reduce document size',
                            _originalSize: file.content ? file.content.length : 0
                        };
                    }
                });

                truncatedDoc._documentTruncated = true;
                truncatedDoc._originalFileCount = doc.files.length;
                truncatedDoc._originalSize = byteSize;

                return truncatedDoc;
            }

            // Generic truncation for other types
            return {
                _truncated: true,
                _originalSize: byteSize,
                _reason: 'Document too large for MongoDB',
                summary: JSON.stringify(doc).substring(0, 1000) + '... [TRUNCATED]'
            };

        } catch (error) {
            logger.error(null, 'Error sanitizing document size:', error);
            return {
                _sanitizationError: true,
                _error: String(error),
                _timestamp: Date.now()
            };
        }
    }

    private async upsertMany(collectionName: Collections, documents: any[], uniqueField: string = 'id') {
        if (this.isShuttingDown) {
            console.error(`[SHUTDOWN VIOLATION] Attempted upsertMany to ${collectionName} (${documents.length} docs) after shutdown`);
            console.error(`[SHUTDOWN VIOLATION] Stack trace:`, new Error().stack);
            return;
        }
        if (!this.database) throw new Error("Database not initialized");
        if (documents.length === 0) return;

        // Upsert documents one by one with size validation
        const results = [];

        for (let i = 0; i < documents.length; i++) {
            try {
                const sanitizedDoc = this.sanitizeDocumentSize(documents[i]);
                const filter = { [uniqueField]: sanitizedDoc[uniqueField] };
                const result = await this.database.collection(collectionName).replaceOne(filter, sanitizedDoc, { upsert: true });
                results.push(result);
            } catch (error) {
                logger.error(null, `Failed to upsert document ${i} into ${collectionName}:`, error);
            }
        }

        return results;
    }

    async findExtension(filter: any) {
        return this.findOne(Collections.EXTENSIONS, filter)
    }
    private async findOne(collectionName: Collections, filter: any) {
        if (!this.database) throw new Error("Database not initialized");
        return await this.database.collection(collectionName).findOne(filter);
    }

    private async find(collectionName: Collections, filter: any = {}) {
        if (!this.database) throw new Error("Database not initialized");
        return await this.database.collection(collectionName).find(filter).toArray();
    }

    private async updateOne(collectionName: Collections, filter: any, update: any) {
        if (!this.database) throw new Error("Database not initialized");
        return await this.database.collection(collectionName).updateOne(filter, { $set: update });
    }

    private async deleteOne(collectionName: Collections, filter: any) {
        if (!this.database) throw new Error("Database not initialized");
        return await this.database.collection(collectionName).deleteOne(filter);
    }

    async close() {
        if (this.client) {
            logger.debug(null, "Initiating graceful database shutdown...");
            this.isShuttingDown = true;

            // Give a moment for any queued operations to see the shutdown flag
            await new Promise(resolve => setTimeout(resolve, 100));

            logger.debug(null, "Closing database connection...");
            await this.client.close(false);
            logger.debug(null, "Database connection closed");
            this.client = null;
            this.database = null;
        }
    }

    async insertMigratedExtensions(extension: Extension[]) {
        return await this.upsertMany(Collections.EXTENSIONS, extension)
    }

    async insertMigratedExtension(extension: Extension) {
        logger.debug(null, `Attempting to upsert migrated extension: ${extension.name} (ID: ${extension.id}, MV3_ID: ${extension.mv3_extension_id})`);
        const sanitizedExtension = this.sanitizeDocumentSize(extension);
        const result = await this.upsertOne(Collections.EXTENSIONS, sanitizedExtension);
        if (result) {
            logger.debug(null, `Successfully upserted extension ${extension.name} to database with result:`, result.upsertedId || result.modifiedCount);
        }
        return result;
    }


    async insertFoundExtensions(extensions: Extension[]) {
        try {
            return await this.upsertMany(Collections.EXTENSIONS, extensions)
        } catch (e) {
            logger.error(null, `${e}`)
        }
    }

    async insertLog(log: {
        "loglevel": LogLevel,
        "message": string,
        "meta": any,
        "time": number,
    }) {
        if (this.isShuttingDown) {
            console.error(`[SHUTDOWN VIOLATION] Attempted insertLog after shutdown: "${log.message.substring(0, 100)}..."`);
            console.error(`[SHUTDOWN VIOLATION] Stack trace:`, new Error().stack);
            return;
        }
        return this.upsertOne(Collections.LOGS, log, 'time')
    }

    async insertManyLogs(logs: {
        "loglevel": LogLevel,
        "message": string,
        "meta": any,
        "time": number,
    }[]) {
        if (this.isShuttingDown) {
            console.error(`[SHUTDOWN VIOLATION] Attempted insertManyLogs after shutdown (${logs.length} logs)`);
            console.error(`[SHUTDOWN VIOLATION] Stack trace:`, new Error().stack);
            return;
        }
        if (logs.length === 0) return;
        return this.upsertMany(Collections.LOGS, logs, 'time')
    }

}
