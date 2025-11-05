import { parentPort } from 'worker_threads';
import { Db, MongoClient } from 'mongodb';

type DatabaseOperation =
    | { type: 'init'; mongoUri: string; dbName: string }
    | { type: 'upsertOne'; collection: string; document: any; uniqueField: string; id: number }
    | { type: 'findOne'; collection: string; filter: any; id: number }
    | { type: 'find'; collection: string; filter: any; id: number }
    | { type: 'updateOne'; collection: string; filter: any; update: any; id: number }
    | { type: 'deleteOne'; collection: string; filter: any; id: number }
    | { type: 'updateOneRaw'; collection: string; filter: any; update: any; id: number }
    | { type: 'close'; id: number };

type DatabaseResponse =
    | { type: 'success'; id: number; result: any }
    | { type: 'error'; id: number; error: string }
    | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; meta?: any };

class DatabaseWorker {
    private client: MongoClient | null = null;
    private database: Db | null = null;
    private operationQueue: Array<{ operation: () => Promise<any>; id: number }> = [];
    private pendingOperations: number = 0;
    private isProcessingQueue: boolean = false;
    private readonly maxConcurrentOperations: number = 10;
    private isShuttingDown: boolean = false;

    constructor() {
        this.startQueueProcessor();
        this.setupMessageHandler();
    }

    private setupMessageHandler() {
        if (!parentPort) {
            throw new Error('This module must be run as a worker thread');
        }

        parentPort.on('message', async (message: DatabaseOperation) => {
            try {
                await this.handleMessage(message);
            } catch (error) {
                if (message.type !== 'init' && message.type !== 'close') {
                    this.sendError((message as any).id, error);
                }
            }
        });
    }

    private async handleMessage(message: DatabaseOperation) {
        switch (message.type) {
            case 'init':
                await this.init(message.mongoUri, message.dbName);
                break;
            case 'upsertOne':
                this.enqueueOperation(message.id, () =>
                    this.upsertOne(message.collection, message.document, message.uniqueField)
                );
                break;
            case 'findOne':
                this.enqueueOperation(message.id, () =>
                    this.findOne(message.collection, message.filter)
                );
                break;
            case 'find':
                this.enqueueOperation(message.id, () =>
                    this.find(message.collection, message.filter)
                );
                break;
            case 'updateOne':
                this.enqueueOperation(message.id, () =>
                    this.updateOne(message.collection, message.filter, message.update)
                );
                break;
            case 'updateOneRaw':
                this.enqueueOperation(message.id, () =>
                    this.updateOneRaw(message.collection, message.filter, message.update)
                );
                break;
            case 'deleteOne':
                this.enqueueOperation(message.id, () =>
                    this.deleteOne(message.collection, message.filter)
                );
                break;
            case 'close':
                await this.close(message.id);
                break;
        }
    }

    private async init(mongoUri: string, dbName: string) {
        try {
            this.client = new MongoClient(mongoUri);
            await this.client.connect();
            this.database = this.client.db(dbName);
            this.log('debug', 'Successfully connected to MongoDB in worker thread');
        } catch (error) {
            this.log('error', 'Failed to connect to MongoDB in worker thread', { error });
            throw error;
        }
    }

    private startQueueProcessor() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;
        this.processQueue();
    }

    private async processQueue() {
        while (this.isProcessingQueue) {
            while (
                this.operationQueue.length > 0 &&
                this.pendingOperations < this.maxConcurrentOperations
            ) {
                const item = this.operationQueue.shift();
                if (!item) continue;

                this.pendingOperations++;
                item.operation()
                    .then((result) => {
                        this.sendSuccess(item.id, result);
                    })
                    .catch((error) => {
                        this.sendError(item.id, error);
                    })
                    .finally(() => {
                        this.pendingOperations--;
                    });
            }

            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }

    private enqueueOperation(id: number, operation: () => Promise<any>) {
        if (this.isShuttingDown) {
            this.sendError(id, new Error('Database worker is shutting down'));
            return;
        }
        this.operationQueue.push({ operation, id });
    }

    private async waitForQueueCompletion(): Promise<void> {
        this.log('debug', 'Waiting for queue completion', {
            queued: this.operationQueue.length,
            pending: this.pendingOperations,
        });

        while (this.operationQueue.length > 0 || this.pendingOperations > 0) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        this.log('debug', 'All database operations completed in worker thread');
    }

    private async upsertOne(collection: string, document: any, uniqueField: string = 'id') {
        if (!this.database) throw new Error('Database not initialized');
        const filter = { [uniqueField]: document[uniqueField] };
        return await this.database
            .collection(collection)
            .replaceOne(filter, document, { upsert: true });
    }

    private async findOne(collection: string, filter: any) {
        if (!this.database) throw new Error('Database not initialized');
        return await this.database.collection(collection).findOne(filter);
    }

    private async find(collection: string, filter: any = {}) {
        if (!this.database) throw new Error('Database not initialized');
        return await this.database.collection(collection).find(filter).toArray();
    }

    private async updateOne(collection: string, filter: any, update: any) {
        if (!this.database) throw new Error('Database not initialized');
        return await this.database.collection(collection).updateOne(filter, { $set: update });
    }

    private async updateOneRaw(collection: string, filter: any, update: any) {
        if (!this.database) throw new Error('Database not initialized');
        return await this.database.collection(collection).updateOne(filter, update);
    }

    private async deleteOne(collection: string, filter: any) {
        if (!this.database) throw new Error('Database not initialized');
        return await this.database.collection(collection).deleteOne(filter);
    }

    private async close(id: number) {
        if (this.client) {
            this.isShuttingDown = true;

            this.log('debug', 'Closing database worker', {
                queued: this.operationQueue.length,
                pending: this.pendingOperations,
            });

            await this.waitForQueueCompletion();
            this.isProcessingQueue = false;

            await this.client.close(false);
            this.client = null;
            this.database = null;

            this.log('debug', 'Database worker connection closed');
            this.sendSuccess(id, { closed: true });
        }
    }

    private sendSuccess(id: number, result: any) {
        if (parentPort) {
            const response: DatabaseResponse = { type: 'success', id, result };
            parentPort.postMessage(response);
        }
    }

    private sendError(id: number, error: any) {
        if (parentPort) {
            const response: DatabaseResponse = {
                type: 'error',
                id,
                error: error instanceof Error ? error.message : String(error),
            };
            parentPort.postMessage(response);
        }
    }

    private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: any) {
        if (parentPort) {
            const response: DatabaseResponse = { type: 'log', level, message, meta };
            parentPort.postMessage(response);
        }
    }
}

// Start the worker
new DatabaseWorker();
