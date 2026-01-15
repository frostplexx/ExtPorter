import { Db, MongoClient } from 'mongodb';
import { Extension } from '../../types/extension';
import { Report } from '../../types/report';
import { LLMFixAttempt } from '../../types/llm_fix_attempt';
import { logger, LogLevel } from '../../utils/logger';
import * as crypto from 'crypto';

export enum Collections {
    EXTENSIONS = 'extensions',
    // MIGRATED_EXT = "extensions",
    LOGS = 'logs',
    TESTS_MV2 = 'tests_mv2',
    TESTS_MV3 = 'tests_mv3',
    REPORTS = 'reports',
    LLM_FIX_ATTEMPTS = 'llm_fix_attempts',
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
    private readonly maxQueueSize: number = 1000; // Prevent unbounded queue growth

    // Waiters used by enqueueOperation to avoid busy-waiting while the queue is full.
    private queueWaiters: (() => void)[] = [];
    private lastQueueWarnTime: number = 0;
    private queueWasFull: boolean = false;
    private readonly queueWarnIntervalMs: number =
        Number(process.env.DB_QUEUE_WARN_INTERVAL_MS) || 5000;
    private readonly queueWaitTimeoutMs: number =
        Number(process.env.DB_QUEUE_WAIT_TIMEOUT_MS) || 30000;
    // Maximum waiters to prevent unbounded memory growth under extreme load
    private readonly maxQueueWaiters: number = 500;

    private constructor() {
        // Queue processor will be started after database initialization
    }

    async init() {
        if (!process.env.MONGODB_URI) {
            throw Error('Could not find MONGODB_URI in environment');
        }

        // Validate DB_NAME early so tests that expect failure do not hang on network connect
        if (!process.env.DB_NAME) {
            throw Error('Could not find DB_NAME in environment');
        }

        this.client = new MongoClient(process.env.MONGODB_URI, {
            maxPoolSize: 10,
            minPoolSize: 2,
            maxIdleTimeMS: 60000,
        });

        try {
            await this.client.connect();
            this.database = this.client.db(process.env.DB_NAME);

            // Create collections upfront to avoid race conditions
            await this.ensureCollectionsExist();

            logger.debug(null, 'Successfully connected to Mongo DB');

            // Start queue processor after database is initialized
            this.startQueueProcessor();
        } catch (error) {
            logger.error(null, 'Failed to connect to MongoDB:', error);
            throw error;
        }
    }

    /**
     * Ensures all required collections exist to avoid race conditions
     */
    private async ensureCollectionsExist() {
        if (!this.database) throw new Error('Database not initialized');

        try {
            const existingCollections = await this.database.listCollections().toArray();
            const existingNames = new Set(existingCollections.map((c) => c.name));

            // Create collections that don't exist
            for (const collectionName of Object.values(Collections)) {
                if (!existingNames.has(collectionName)) {
                    await this.database.createCollection(collectionName);
                    console.debug(`Created collection: ${collectionName}`);
                }
            }
        } catch (error) {
            // If collection already exists, that's fine - ignore the error
            if ((error as any).code !== 48) {
                // 48 = NamespaceExists
                throw error;
            }
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
     * Notify waiting enqueues that space is available.
     * This wakes up up to N waiters where N = available slots.
     */
    private notifyWaiters() {
        if (this.queueWaiters.length === 0) return;

        while (this.operationQueue.length < this.maxQueueSize && this.queueWaiters.length > 0) {
            const waiter = this.queueWaiters.shift();
            if (!waiter) break;
            try {
                waiter();
            } catch (err) {
                logger.debug(null, 'Error invoking queue waiter:', err);
            }
        }

        if (this.queueWasFull && this.operationQueue.length < this.maxQueueSize) {
            logger.info(
                null,
                `Database queue drained (${this.operationQueue.length}/${this.maxQueueSize})`
            );
            this.queueWasFull = false;
            this.lastQueueWarnTime = 0;
        }
    }

    /**
     * Processes queued operations with concurrency control
     */
    private async processQueue() {
        while (this.isProcessingQueue) {
            try {
                // Collect promises for operations we're starting
                const activePromises: Promise<void>[] = [];

                // Process operations up to max concurrency
                while (
                    this.operationQueue.length > 0 &&
                    this.pendingOperations < this.maxConcurrentOperations
                ) {
                    const item = this.operationQueue.shift();
                    if (!item) continue;

                    // A slot in the queue was freed, notify any waiters
                    this.notifyWaiters();

                    this.pendingOperations++;
                    const promise = item
                        .operation()
                        .then((result) => {
                            item.resolve(result);
                        })
                        .catch((error) => {
                            item.reject(error);
                        })
                        .finally(() => {
                            this.pendingOperations--;
                            // Notify waiters in case space freed up
                            this.notifyWaiters();
                        });

                    activePromises.push(promise);
                }

                // Wait for at least one operation to complete or a short timeout
                if (activePromises.length > 0) {
                    await Promise.race([
                        Promise.all(activePromises),
                        new Promise((resolve) => setTimeout(resolve, 10)),
                    ]);
                } else {
                    // No operations to process, wait a bit before checking again
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
            } catch (error) {
                // Catch any unexpected error so the queue processor doesn't crash the process
                logger.error(null, 'Error processing database queue:', error);
                // Back off briefly to avoid tight error loops
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }

    /**
     * Enqueues a database operation to be executed.
     * Implements backpressure by waiting when queue is full.
     */
    private async enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
        if (this.isShuttingDown) {
            throw new Error('Database is shutting down');
        }

        // Quick path: if there's room, enqueue immediately
        if (this.operationQueue.length < this.maxQueueSize) {
            return new Promise<T>((resolve, reject) => {
                if (this.isShuttingDown) {
                    reject(new Error('Database is shutting down'));
                    return;
                }
                this.operationQueue.push({ operation, resolve, reject });
            });
        }

        // Rate-limited warning
        const now = Date.now();
        if (now - this.lastQueueWarnTime > this.queueWarnIntervalMs) {
            logger.warn(
                null,
                `Database queue full (${this.operationQueue.length}/${this.maxQueueSize}), waiting for drain...`
            );
            this.lastQueueWarnTime = now;
            this.queueWasFull = true;
        }

        // Reject immediately if too many waiters are already queued (prevents unbounded memory growth)
        if (this.queueWaiters.length >= this.maxQueueWaiters) {
            logger.error(
                null,
                `Database waiter queue full (${this.queueWaiters.length}/${this.maxQueueWaiters}), rejecting operation`
            );
            return Promise.reject(new Error(`Database waiter queue full (${this.maxQueueWaiters} waiters)`));
        }

        // Wait for space up to configured timeout. If timeout expires, reject to prevent indefinite blocking.
        return new Promise<T>((resolve, reject) => {
            if (this.isShuttingDown) {
                reject(new Error('Database is shutting down'));
                return;
            }
            
                        let timeoutId: NodeJS.Timeout | undefined;
                        let resolved = false;
            
                        const waiter = () => {
                            if (resolved) return;
                            if (timeoutId) {
                                clearTimeout(timeoutId);
                                timeoutId = undefined;
                            }
            
                            if (this.isShuttingDown) {
                                resolved = true;
                                reject(new Error('Database is shutting down'));
                                return;
                            }
            
                            if (this.operationQueue.length < this.maxQueueSize) {
                                this.operationQueue.push({ operation, resolve, reject });
                                resolved = true;
                                return;
                            }
            
                            // Still full; leave waiter registered for next notification
                        };
            
                        // Register waiter
                        this.queueWaiters.push(waiter);
            
                        // Setup timeout to reject the enqueue after waiting too long
                        timeoutId = setTimeout(() => {
                            if (resolved) return;
                            // Remove waiter from queueWaiters
                            const idx = this.queueWaiters.indexOf(waiter);
                            if (idx >= 0) this.queueWaiters.splice(idx, 1);
                            resolved = true;
                            logger.error(
                                null,
                                `Timed out waiting for database queue to drain (${this.queueWaitTimeoutMs}ms)`
                            );
                            reject(new Error(`Database queue full after waiting ${this.queueWaitTimeoutMs} ms`));
                        }, this.queueWaitTimeoutMs);
        });
    }

    /**
     * Get current queue status for monitoring
     */
    getQueueStatus(): { queued: number; pending: number; maxSize: number } {
        return {
            queued: this.operationQueue.length,
            pending: this.pendingOperations,
            maxSize: this.maxQueueSize,
        };
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
            // Fast heuristic: if the document contains files, estimate size from file contents
            const hasFiles = doc && doc.files && Array.isArray(doc.files);
            if (hasFiles) {
                let estimatedSize = 0;
                for (const file of doc.files) {
                    if (!file) continue;
                    if (typeof file.content === 'string') {
                        estimatedSize += Buffer.byteLength(file.content, 'utf8');
                    } else if (file.content && Buffer.isBuffer(file.content)) {
                        estimatedSize += file.content.length;
                    } else if (file.getContent && typeof file.getContent === 'function') {
                        try {
                            const c = file.getContent();
                            if (typeof c === 'string') estimatedSize += Buffer.byteLength(c, 'utf8');
                            else if (Buffer.isBuffer(c)) estimatedSize += c.length;
                        } catch {
                            // ignore
                        }
                    }

                    if (estimatedSize > MAX_BSON_SIZE) break;
                }

                // If estimated size is below limit, try to serialize to confirm
                if (estimatedSize <= MAX_BSON_SIZE) {
                    try {
                        const serialized = JSON.stringify(doc);
                        const byteSize = Buffer.byteLength(serialized, 'utf8');
                        if (byteSize <= MAX_BSON_SIZE) return doc;
                        // otherwise fall through to truncation logic with measured size
                    } catch {
                        // fall through to truncation if serialization failed
                    }
                } else {
                    logger.warn(
                        null,
                        `Document estimated too large (${(estimatedSize / 1024 / 1024).toFixed(2)}MB), truncating...`
                    );
                }
            } else {
                // Non-file documents - attempt to serialize and check size
                const serialized = JSON.stringify(doc);
                const byteSize = Buffer.byteLength(serialized, 'utf8');
                if (byteSize <= MAX_BSON_SIZE) return doc;
            }

            // At this point, the document is too large - attempt to truncate intelligently
            // If it's an Extension object, aggressively truncate file contents
            if (doc.files && Array.isArray(doc.files)) {
                const truncatedDoc = { ...doc };

                // Try to get an accurate size if possible
                let byteSize = 0;
                try {
                    byteSize = Buffer.byteLength(JSON.stringify(doc), 'utf8');
                } catch {
                    byteSize = MAX_BSON_SIZE + 1;
                }

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
                        _originalSize: file.content
                            ? typeof file.content === 'string'
                                ? file.content.length
                                : file.content.length || 0
                            : 0,
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
                                _originalSize: file.content
                                    ? typeof file.content === 'string'
                                        ? file.content.length
                                        : file.content.length || 0
                                    : 0,
                            };
                        }
                    });
                }

                truncatedDoc._documentTruncated = true;
                truncatedDoc._originalFileCount = doc.files.length;
                try {
                    truncatedDoc._originalSize = Buffer.byteLength(JSON.stringify(doc), 'utf8');
                } catch {
                    truncatedDoc._originalSize = undefined;
                }

                // Verify truncated size
                const newSize = Buffer.byteLength(JSON.stringify(truncatedDoc), 'utf8');
                logger.debug(
                    null,
                    `Document truncated from ${(truncatedDoc._originalSize ? (truncatedDoc._originalSize / 1024 / 1024).toFixed(2) : 'unknown')}MB to ${(newSize / 1024 / 1024).toFixed(2)}MB`
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
            let summary = '... [TRUNCATED]';
            try {
                const serialized = JSON.stringify(doc);
                summary = serialized.substring(0, 1000) + '... [TRUNCATED]';
            } catch {
                summary = String(doc).substring(0, 1000) + '... [TRUNCATED]';
            }

            return {
                _truncated: true,
                _originalSize: undefined,
                _reason: 'Document too large for MongoDB',
                summary,
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

            // Reject any waiters that are waiting for queue space so they don't hang
            if (this.queueWaiters.length > 0) {
                for (const waiter of this.queueWaiters.slice()) {
                    try {
                        waiter();
                    } catch (e) {
                        logger.debug(null, 'Error rejecting queue waiter during shutdown:', e);
                    }
                }
                this.queueWaiters = [];
            }

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
     * Get all extensions with statistics, pre-sorted by interestingness
     */
    async getExtensionsWithStats() {
        // Backwards-compatible full response (kept for callers that expect entire list)
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');

            const extensionsCollection = this.database.collection(Collections.EXTENSIONS);

            // Fetch all extensions sorted by interestingness (descending, nulls last)
            const extensions = await extensionsCollection
                .find({})
                .sort({ interestingness_score: -1 })
                .toArray();

            // Calculate statistics
            const total = extensions.length;
            const with_mv3 = extensions.filter((e) => e.mv3_extension_id != null).length;
            const with_mv2_only = total - with_mv3;
            const failed = extensions.filter(
                (e) => e.tags && Array.isArray(e.tags) && e.tags.includes('migration-failed')
            ).length;

            // Calculate average interestingness score
            const scores = extensions
                .map((e) => e.interestingness_score)
                .filter((score): score is number => typeof score === 'number' && !isNaN(score));
            const avg_score =
                scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

            return {
                extensions,
                stats: {
                    total,
                    with_mv3,
                    with_mv2_only,
                    failed,
                    avg_score,
                },
            };
        });
    }

    /**
     * Get a single page of extensions with pre-calculated statistics.
     * This avoids serializing the whole collection at once and enables UI pagination/scrolling.
     */
    async getExtensionsPageWithStats(
        page: number = 0,
        pageSize: number = 100,
        search: string | null = null,
        sort: string | null = null,
        seed: string | null = null
    ) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');

            const extensionsCollection = this.database.collection(Collections.EXTENSIONS);

            const skip = Math.max(0, page) * Math.max(1, pageSize);

            // Build filter for optional search
            let filter: any = {};
            if (search && typeof search === 'string' && search.trim().length > 0) {
                const regex = { $regex: search, $options: 'i' };
                filter = {
                    $or: [
                        { name: regex },
                        { id: regex },
                        { mv2_extension_id: regex },
                        { mv3_extension_id: regex },
                    ],
                };
            }

            // Fetch page of extensions with requested sort
            let extensionsPage: any[] = [];
            if (sort === 'random') {
                if (seed && typeof seed === 'string' && seed.length > 0) {
                    // Deterministic seeded-random ordering:
                    // 1) Fetch only IDs matching filter
                    // 2) Compute hash(seed + id) for each id
                    // 3) Sort ids by hash and then slice the requested page
                    // 4) Fetch the documents for that slice and return them in the same order
                    const idDocs = await extensionsCollection
                        .find(filter, { projection: { id: 1 } })
                        .toArray();
                    const ids: string[] = idDocs.map((d: any) => d.id || String(d._id));

                    // Compute hash -> use hex string for deterministic ordering
                    const hashes = ids.map((id) => {
                        const h = crypto
                            .createHash('sha256')
                            .update(seed + '::' + id)
                            .digest('hex');
                        return { id, h };
                    });

                    hashes.sort((a: any, b: any) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));

                    const pageIds = hashes.slice(skip, skip + pageSize).map((x: any) => x.id);

                    if (pageIds.length === 0) {
                        extensionsPage = [];
                    } else {
                        const docs = await extensionsCollection
                            .find({ id: { $in: pageIds } })
                            .toArray();
                        // Preserve deterministic order
                        const docsById: any = {};
                        for (const d of docs) docsById[d.id || String(d._id)] = d;
                        extensionsPage = pageIds.map((id) => docsById[id]).filter(Boolean);
                    }
                } else {
                    // For random without seed, fallback to non-deterministic sample (legacy behavior)
                    const pipeline: any[] = [{ $match: filter }, { $sample: { size: pageSize } }];
                    extensionsPage = await extensionsCollection.aggregate(pipeline).toArray();
                }
            } else {
                // Determine sort direction for interestingness (default: desc)
                const direction = sort === 'interestingness_asc' ? 1 : -1;
                extensionsPage = await extensionsCollection
                    .find(filter)
                    .sort({ interestingness_score: direction })
                    .skip(skip)
                    .limit(pageSize)
                    .toArray();
            }

            // Sanitize extensions for transmission: remove heavy fields like `files` and `manifest`,
            // truncate long CWS descriptions, and strip large code snippets from event listeners.
            const sanitizedExtensions = extensionsPage.map((ext: any) => {
                const copy: any = { ...ext };

                // Remove full file contents to avoid huge payloads
                if (copy.files) {
                    copy.files = copy.files.map((f: any, i: number) => ({
                        path: f.path || `file_${i}`,
                        filetype: f.filetype,
                        _contentRemoved: true,
                        _originalSize: f.content
                            ? typeof f.content === 'string'
                                ? f.content.length
                                : 0
                            : 0,
                    }));
                }

                // Remove manifest object (too large)
                if (copy.manifest) {
                    delete copy.manifest;
                }

                // Truncate long CWS descriptions
                if (
                    copy.cws_info &&
                    typeof copy.cws_info.description === 'string' &&
                    copy.cws_info.description.length > 2000
                ) {
                    copy.cws_info = {
                        ...copy.cws_info,
                        description:
                            copy.cws_info.description.substring(0, 2000) + '... [TRUNCATED]',
                    };
                }

                // Strip large code snippets from event listeners
                if (Array.isArray(copy.event_listeners)) {
                    copy.event_listeners = copy.event_listeners.map((l: any) => ({
                        api: l.api,
                        file: l.file,
                        line: l.line,
                    }));
                }

                return copy;
            });

            // Compute global statistics efficiently using aggregation/counts
            const total = await extensionsCollection.countDocuments();
            const with_mv3 = await extensionsCollection.countDocuments({
                mv3_extension_id: { $ne: null },
            });
            const failed = await extensionsCollection.countDocuments({ tags: 'migration-failed' });

            // Average interestingness score (aggregation)
            const avgResult = await extensionsCollection
                .aggregate([
                    { $match: { interestingness_score: { $type: 'number' } } },
                    { $group: { _id: null, avg_score: { $avg: '$interestingness_score' } } },
                ])
                .toArray();

            const avg_score = avgResult[0]?.avg_score || 0;

            const with_mv2_only = total - with_mv3;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));

            return {
                extensions: sanitizedExtensions,
                stats: {
                    total,
                    with_mv3,
                    with_mv2_only,
                    failed,
                    avg_score,
                },
                page,
                pageSize,
                totalPages,
            };
        });
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

    /**
     * Insert or update a report
     */
    async insertReport(report: Report) {
        logger.debug(null, `Upserting report for extension: ${report.extension_id}`);
        return await this.upsertOne(Collections.REPORTS, report);
    }

    /**
     * Get all reports from the database
     */
    async getAllReports() {
        return this.find(Collections.REPORTS);
    }

    /**
     * Get a report for a specific extension
     */
    async getReportByExtensionId(extensionId: string) {
        return this.findOne(Collections.REPORTS, { extension_id: extensionId });
    }

    /**
     * Update the tested status of a report
     */
    async updateReportTested(extensionId: string, tested: boolean) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');

            const update = {
                tested,
                updated_at: Date.now(),
            };

            return await this.database
                .collection(Collections.REPORTS)
                .updateOne({ extension_id: extensionId }, { $set: update });
        });
    }

    /**
     * Update an entire report
     */
    async updateReport(reportId: string, reportData: any) {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');

            const update = {
                ...reportData,
                updated_at: Date.now(),
            };

            return await this.database
                .collection(Collections.REPORTS)
                .updateOne({ id: reportId }, { $set: update });
        });
    }

    /**
     * Delete a report
     */
    async deleteReport(reportId: string) {
        return this.deleteOne(Collections.REPORTS, { id: reportId });
    }

    /**
     * Get a report by its ID
     */
    async getReportById(reportId: string) {
        return this.findOne(Collections.REPORTS, { id: reportId });
    }

    // ==================== LLM Fix Attempts ====================

    /**
     * Insert or update an LLM fix attempt
     */
    async insertLLMFixAttempt(attempt: LLMFixAttempt) {
        logger.debug(
            null,
            `Upserting LLM fix attempt for extension: ${attempt.extension_id} (attempt: ${attempt.id})`
        );
        const sanitizedAttempt = this.sanitizeDocumentSize(attempt);
        return await this.upsertOne(Collections.LLM_FIX_ATTEMPTS, sanitizedAttempt);
    }

    /**
     * Get all LLM fix attempts for an extension
     */
    async getLLMFixAttemptsByExtensionId(extensionId: string): Promise<LLMFixAttempt[]> {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            return (await this.database
                .collection(Collections.LLM_FIX_ATTEMPTS)
                .find({ extension_id: extensionId })
                .sort({ started_at: -1 })
                .toArray()) as unknown as LLMFixAttempt[];
        });
    }

    /**
     * Get a specific LLM fix attempt by its ID
     */
    async getLLMFixAttemptById(attemptId: string): Promise<LLMFixAttempt | null> {
        return this.findOne(Collections.LLM_FIX_ATTEMPTS, {
            id: attemptId,
        }) as unknown as Promise<LLMFixAttempt | null>;
    }

    /**
     * Get the most recent LLM fix attempt for an extension
     */
    async getLatestLLMFixAttempt(extensionId: string): Promise<LLMFixAttempt | null> {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');
            const results = await this.database
                .collection(Collections.LLM_FIX_ATTEMPTS)
                .find({ extension_id: extensionId })
                .sort({ started_at: -1 })
                .limit(1)
                .toArray();
            return (results[0] as unknown as LLMFixAttempt) || null;
        });
    }

    /**
     * Get all LLM fix attempts
     */
    async getAllLLMFixAttempts(): Promise<LLMFixAttempt[]> {
        return this.find(Collections.LLM_FIX_ATTEMPTS) as unknown as Promise<LLMFixAttempt[]>;
    }

    /**
     * Delete an LLM fix attempt
     */
    async deleteLLMFixAttempt(attemptId: string) {
        return this.deleteOne(Collections.LLM_FIX_ATTEMPTS, { id: attemptId });
    }

    /**
     * Get all extension IDs that have been successfully migrated (have mv3_extension_id set)
     * This is used for resume functionality to skip already-migrated extensions
     * Returns both original extension IDs and mv3_extension_ids for comprehensive matching
     * @returns Object containing:
     *   - sourceIds: Set of original extension.id values
     *   - mv3Ids: Set of mv3_extension_id values (used as folder names)
     *   - mv3ToSourceMap: Map from mv3_extension_id to extension.id for reverse lookup
     */
    async getMigratedExtensionIds(): Promise<{
        sourceIds: Set<string>;
        mv3Ids: Set<string>;
        mv3ToSourceMap: Map<string, string>;
    }> {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');

            const sourceIds = new Set<string>();
            const mv3Ids = new Set<string>();
            const mv3ToSourceMap = new Map<string, string>();

            // Query for extensions with mv3_extension_id
            const docs = await this.database.collection(Collections.EXTENSIONS).find(
                { mv3_extension_id: { $exists: true, $ne: null } },
                { projection: { id: 1, mv3_extension_id: 1 } }
            ).toArray();

            // Process documents
            for (const doc of docs) {
                if (doc.id) {
                    sourceIds.add(doc.id);
                }
                if (doc.mv3_extension_id) {
                    mv3Ids.add(doc.mv3_extension_id);
                    if (doc.id) {
                        mv3ToSourceMap.set(doc.mv3_extension_id, doc.id);
                    }
                }
            }

            return { sourceIds, mv3Ids, mv3ToSourceMap };
        });
    }

    /**
     * Get LLM fix attempts statistics
     */
    async getLLMFixAttemptsStats() {
        return this.enqueueOperation(async () => {
            if (!this.database) throw new Error('Database not initialized');

            const collection = this.database.collection(Collections.LLM_FIX_ATTEMPTS);

            const total = await collection.countDocuments();
            const successful = await collection.countDocuments({ success: true });
            const failed = await collection.countDocuments({ success: false });

            // Get average duration for successful attempts
            const avgDurationResult = await collection
                .aggregate([
                    { $match: { success: true } },
                    { $group: { _id: null, avgDuration: { $avg: '$duration_ms' } } },
                ])
                .toArray();
            const avgDuration = avgDurationResult[0]?.avgDuration || 0;

            return {
                total,
                successful,
                failed,
                success_rate: total > 0 ? (successful / total) * 100 : 0,
                avg_duration_ms: avgDuration,
            };
        });
    }
}
