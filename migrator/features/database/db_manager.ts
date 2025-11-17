import { Db, MongoClient } from 'mongodb';
import { Extension } from '../../types/extension';
import { logger, LogLevel } from '../../utils/logger';

export enum Collections {
    EXTENSIONS = 'extensions',
    // MIGRATED_EXT = "extensions",
    LOGS = 'logs',
    TESTS_MV2 = 'tests_mv2',
    TESTS_MV3 = 'tests_mv3',
}

type QueuedOperation = {
    operation: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
};

export class Database {
    client: MongoClient | null = null;
    database: Db | null = null;
    private isShuttingDown: boolean = false;
    public static shared = new Database();
    private operationQueue: QueuedOperation[] = [];
    private pendingOperations: number = 0;
    private isProcessingQueue: boolean = false;
    private readonly maxConcurrentOperations: number = 10;

    private constructor() {
        // Queue processor will be started after database initialization
    }

    async init() {
        if (!process.env.MONGODB_URI) {
            throw Error('Could not find MONGODB_URI in environment');
        }
        this.client = new MongoClient(process.env.MONGODB_URI);

        try {
            await this.client.connect();
            if (!process.env.DB_NAME) {
                throw Error('Could not find DB_NAME in environment');
            }
            this.database = this.client.db(process.env.DB_NAME);
            logger.debug(null, 'Successfully connected to Mongo DB');
            
            // Start queue processor after database is initialized
            this.startQueueProcessor();
        } catch (error) {
            logger.error(null, 'Failed to connect to MongoDB:', error);
            throw error;
        }
    }

    /**
     * Starts the background queue processor
     */
    private startQueueProcessor() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;
        this.processQueue();
    }

    /**
     * Processes queued operations with concurrency control
     */
    private async processQueue() {
        while (this.isProcessingQueue) {
            // Collect promises for operations we're starting
            const activePromises: Promise<void>[] = [];
            
            // Process operations up to max concurrency
            while (
                this.operationQueue.length > 0 &&
                this.pendingOperations < this.maxConcurrentOperations
            ) {
                const item = this.operationQueue.shift();
                if (!item) continue;

                this.pendingOperations++;
                const promise = item.operation()
                    .then((result) => {
                        item.resolve(result);
                    })
                    .catch((error) => {
                        item.reject(error);
                    })
                    .finally(() => {
                        this.pendingOperations--;
                    });
                    
                activePromises.push(promise);
            }

            // Wait for at least one operation to complete or a short timeout
            if (activePromises.length > 0) {
                await Promise.race([
                    Promise.all(activePromises),
                    new Promise((resolve) => setTimeout(resolve, 10))
                ]);
            } else {
                // No operations to process, wait a bit before checking again
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }
    }

    /**
     * Enqueues a database operation to be executed
     */
    private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (this.isShuttingDown) {
                reject(new Error('Database is shutting down'));
                return;
            }
            this.operationQueue.push({ operation, resolve, reject });
        });
    }

    /**
     * Waits for all pending operations to complete
     */
    private async waitForQueueCompletion(): Promise<void> {
        logger.debug(
            null,
            `Waiting for queue completion: ${this.operationQueue.length} queued, ${this.pendingOperations} pending`
        );

        // Wait for queue to be empty and all pending operations to complete
        while (this.operationQueue.length > 0 || this.pendingOperations > 0) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        logger.debug(null, 'All database operations completed');
    }

    private async upsertOne(
        collectionName: Collections,
        document: any,
        uniqueField: string = 'id'
    ) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            const filter = { [uniqueField]: document[uniqueField] };
            return await this.database
                .collection(collectionName)
                .replaceOne(filter, document, { upsert: true });
        });
    }

    /**
     * Check and truncate document if it's too large for MongoDB
     * Enhanced to better handle BSON size limits and prevent buffer overflow errors
     */
    private sanitizeDocumentSize(doc: any): any {
        const MAX_BSON_SIZE = 15 * 1024 * 1024; // 15MB to be safe (MongoDB limit is 16MB)

        try {
            const serialized = JSON.stringify(doc);
            const byteSize = Buffer.byteLength(serialized, 'utf8');

            if (byteSize <= MAX_BSON_SIZE) {
                return doc;
            }

            logger.warn(
                null,
                `Document too large (${(byteSize / 1024 / 1024).toFixed(2)}MB), truncating...`
            );

            // If it's an Extension object, aggressively truncate file contents
            if (doc.files && Array.isArray(doc.files)) {
                const truncatedDoc = { ...doc };

                // For extremely large documents (>50MB), remove all file content
                if (byteSize > 50 * 1024 * 1024) {
                    logger.warn(
                        null,
                        `Document extremely large (${(byteSize / 1024 / 1024).toFixed(2)}MB), removing all file content`
                    );
                    truncatedDoc.files = doc.files.map((file: any, index: number) => ({
                        path: file.path || `file_${index}`,
                        filetype: file.filetype,
                        _contentRemoved: true,
                        _reason: 'Document too large for MongoDB',
                        _originalSize: file.content ? file.content.length : 0,
                    }));
                } else {
                    // Keep first 5 files with limited content, summarize the rest
                    truncatedDoc.files = doc.files.map((file: any, index: number) => {
                        if (index < 5) {
                            if (file.content && typeof file.content === 'string') {
                                const maxContentSize = Math.floor(MAX_BSON_SIZE / 50); // Very conservative
                                if (file.content.length > maxContentSize) {
                                    return {
                                        ...file,
                                        content:
                                            file.content.substring(0, maxContentSize) +
                                            '... [TRUNCATED]',
                                        _truncated: true,
                                        _originalSize: file.content.length,
                                    };
                                }
                            }
                            return file;
                        } else {
                            // Replace with summary for files beyond the first 5
                            return {
                                path: file.path || `file_${index}`,
                                filetype: file.filetype,
                                _truncated: true,
                                _reason: 'File removed to reduce document size',
                                _originalSize: file.content ? file.content.length : 0,
                            };
                        }
                    });
                }

                truncatedDoc._documentTruncated = true;
                truncatedDoc._originalFileCount = doc.files.length;
                truncatedDoc._originalSize = byteSize;

                // Verify truncated size
                const newSize = Buffer.byteLength(JSON.stringify(truncatedDoc), 'utf8');
                logger.debug(
                    null,
                    `Document truncated from ${(byteSize / 1024 / 1024).toFixed(2)}MB to ${(newSize / 1024 / 1024).toFixed(2)}MB`
                );

                if (newSize > MAX_BSON_SIZE) {
                    // Still too large, remove all files
                    logger.warn(
                        null,
                        'Document still too large after truncation, removing all files'
                    );
                    truncatedDoc.files = [];
                }

                return truncatedDoc;
            }

            // Generic truncation for other types
            return {
                _truncated: true,
                _originalSize: byteSize,
                _reason: 'Document too large for MongoDB',
                summary: JSON.stringify(doc).substring(0, 1000) + '... [TRUNCATED]',
            };
        } catch (error) {
            logger.error(null, 'Error sanitizing document size:', error);
            // Return a minimal safe document
            return {
                _sanitizationError: true,
                _error: String(error),
                _timestamp: Date.now(),
                id: doc.id || 'unknown',
                name: doc.name || 'unknown',
            };
        }
    }

    private async upsertMany(
        collectionName: Collections,
        documents: any[],
        uniqueField: string = 'id'
    ) {
        if (documents.length === 0) return;

        // Upsert documents one by one with size validation, using the queue for each operation
        const results = [];

        for (let i = 0; i < documents.length; i++) {
            try {
                const sanitizedDoc = this.sanitizeDocumentSize(documents[i]);
                const result = await this.enqueueOperation(async () => {
                    if (!this.database) throw new Error('Database not initialized');
                    const filter = { [uniqueField]: sanitizedDoc[uniqueField] };
                    return await this.database
                        .collection(collectionName)
                        .replaceOne(filter, sanitizedDoc, { upsert: true });
                });
                results.push(result);
            } catch (error) {
                // Don't log during shutdown to avoid cascading error loops
                if (!this.isShuttingDown) {
                    // Use console.error to avoid circular dependency with logger
                    console.error(
                        `[DB] Failed to upsert document ${i} into ${collectionName}:`,
                        error
                    );
                }
            }
        }

        return results;
    }

    async findExtension(filter: any) {
        return this.findOne(Collections.EXTENSIONS, filter);
    }
    private async findOne(collectionName: Collections, filter: any) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            return await this.database.collection(collectionName).findOne(filter);
        });
    }

    private async find(collectionName: Collections, filter: any = {}) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            return await this.database.collection(collectionName).find(filter).toArray();
        });
    }

    private async updateOne(collectionName: Collections, filter: any, update: any) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            return await this.database
                .collection(collectionName)
                .updateOne(filter, { $set: update });
        });
    }

    private async deleteOne(collectionName: Collections, filter: any) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            return await this.database.collection(collectionName).deleteOne(filter);
        });
    }

    async close() {
        if (this.client) {
            // Flush all pending logs before shutting down
            await logger.flush();

            // Set shutdown flag to prevent new operations
            this.isShuttingDown = true;

            logger.debug(
                null,
                `Closing database: ${this.operationQueue.length} operations queued, ${this.pendingOperations} pending`
            );

            // Wait for all queued and pending operations to complete
            await this.waitForQueueCompletion();

            // Stop the queue processor
            this.isProcessingQueue = false;

            await this.client.close(false);
            this.client = null;
            this.database = null;

            logger.debug(null, 'Database connection closed');
        }
    }

    async insertMigratedExtensions(extension: Extension[]) {
        return await this.upsertMany(Collections.EXTENSIONS, extension);
    }

    async insertMigratedExtension(extension: Extension) {
        logger.debug(
            null,
            `Attempting to upsert migrated extension: ${extension.name} (ID: ${extension.id}, MV3_ID: ${extension.mv3_extension_id})`
        );
        const sanitizedExtension = this.sanitizeDocumentSize(extension);
        const result = await this.upsertOne(Collections.EXTENSIONS, sanitizedExtension);
        if (result) {
            logger.debug(
                null,
                `Successfully upserted extension ${extension.name} to database with result:`,
                result.upsertedId || result.modifiedCount
            );
        }
        return result;
    }

    /**
     * Appends a tag to an extension (avoids duplicates using $addToSet)
     * @param extension - The extension to add the tag to
     * @param tag - The tag string to append
     * @returns The update result or null if extension not found
     */
    async extensionAppendTag(extension: Extension, tag: string) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');

            try {
                // Use $addToSet to add the tag only if it doesn't already exist
                const result = await this.database
                    .collection(Collections.EXTENSIONS)
                    .updateOne({ id: extension.id }, { $addToSet: { tags: tag } });

                if (result.matchedCount === 0) {
                    logger.error(
                        extension,
                        `Couldn't find extension with id ${extension.id} for tag insertion`
                    );
                    return null;
                }

                if (result.modifiedCount > 0) {
                    logger.debug(extension, `Added tag ${tag} to extension ${extension.name}`);
                } else {
                    logger.debug(
                        extension,
                        `Tag ${tag} already exists on extension ${extension.name}`
                    );
                }

                return result;
            } catch (error) {
                logger.error(extension, `Failed to append tag to extension:`, error);
                throw error;
            }
        });
    }

    /**
     * Removes a tag from an extension
     * @param extension - The extension to remove the tag from
     * @param tag - The tag string to remove
     * @returns The update result or null if extension not found
     */
    async extensionRemoveTag(extension: Extension, tag: string) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');

            try {
                // Use $pull to remove the tag from the array
                const result = await this.database
                    .collection(Collections.EXTENSIONS)
                    .updateOne({ id: extension.id }, { $pull: { tags: tag } } as any);

                if (result.matchedCount === 0) {
                    logger.error(
                        extension,
                        `Couldn't find extension with id ${extension.id} for tag removal`
                    );
                    return null;
                }

                if (result.modifiedCount > 0) {
                    logger.debug(extension, `Removed tag ${tag} from extension ${extension.name}`);
                } else {
                    logger.debug(
                        extension,
                        `Tag ${tag} was not present on extension ${extension.name}`
                    );
                }

                return result;
            } catch (error) {
                logger.error(extension, `Failed to remove tag from extension:`, error);
                throw error;
            }
        });
    }

    async insertFoundExtensions(extensions: Extension[]) {
        try {
            return await this.upsertMany(Collections.EXTENSIONS, extensions);
        } catch (e) {
            logger.error(null, `${e}`);
        }
    }

    async insertLog(log: { loglevel: LogLevel; message: string; meta: any; time: number }) {
        return this.upsertOne(Collections.LOGS, log, 'time');
    }

    async insertManyLogs(
        logs: {
            loglevel: LogLevel;
            message: string;
            meta: any;
            time: number;
        }[]
    ) {
        if (logs.length === 0) return;
        return this.upsertMany(Collections.LOGS, logs, 'time');
    }

    /**
     * Get all extensions from the database
     */
    async getAllExtensions() {
        return this.find(Collections.EXTENSIONS);
    }

    /**
     * Get list of all collections with their document counts
     */
    async getCollections() {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            
            const collections = await this.database.listCollections().toArray();
            const result = await Promise.all(
                collections.map(async (col) => ({
                    name: col.name,
                    count: await this.database!.collection(col.name).countDocuments(),
                }))
            );
            return result;
        });
    }

    /**
     * Query a specific collection
     */
    async queryCollection(collectionName: string, query: any = {}, limit: number = 10) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            return await this.database
                .collection(collectionName)
                .find(query)
                .limit(limit)
                .toArray();
        });
    }

    /**
     * Count documents in a collection
     */
    async countDocuments(collectionName: string, query: any = {}) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            return await this.database.collection(collectionName).countDocuments(query);
        });
    }

    /**
     * Get logs with optional limit
     */
    async getLogs(limit: number = 50) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            return await this.database
                .collection(Collections.LOGS)
                .find({})
                .sort({ time: -1 })
                .limit(limit)
                .toArray();
        });
    }
}
