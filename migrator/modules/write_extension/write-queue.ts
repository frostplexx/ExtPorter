import { Extension } from '../../types/extension';
import { logger } from '../../utils/logger';
import { WriteTask } from './index';
import { resolveOutputPath } from './path-resolver';
import { Writer } from './writer';

/**
 * WriteQueue manages asynchronous writing of migrated extensions to disk.
 *
 * Features:
 * - Priority-based task queue
 * - Concurrent processing with configurable workers
 * - Graceful shutdown handling
 * - Singleton pattern for global queue management
 */
export class WriteQueue {
    private static instance: WriteQueue;
    private writeQueue: WriteTask[] = [];
    private isProcessing = false;
    private readonly concurrentWrites = 10;
    private readonly MAX_QUEUE_SIZE = 10; // Limit queue size
    private activeWriters = 0;
    private autoPro = true; // Auto-process queue (can be disabled for testing)
    private readonly fileBatchSize = 50; // Number of files to write concurrently

    private constructor() {
        // Handle graceful shutdown via beforeExit (non-signal cleanup)
        // Note: SIGINT/SIGTERM handlers are centralized in index.ts to avoid duplicates
        process.on('beforeExit', async () => {
            await this.flush();
        });
    }

    public static get shared(): WriteQueue {
        if (!WriteQueue.instance) {
            WriteQueue.instance = new WriteQueue();
        }
        return WriteQueue.instance;
    }

    public async queueExtension(extension: Extension, priority: number = 0): Promise<void> {
        // Block if queue is full
        while (this.writeQueue.length >= this.MAX_QUEUE_SIZE) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const task: WriteTask = { extension, priority };

        this.insertTaskByPriority(task);

        logger.debug(extension, 'Extension queued for writing', {
            queueLength: this.writeQueue.length,
            priority,
        });

        if (!this.isProcessing && this.autoPro) {
            this.processQueue();
        }
    }

    /**
     * Enable or disable auto-processing (for testing)
     */
    public setAutoProcess(enabled: boolean): void {
        this.autoPro = enabled;
    }

    private insertTaskByPriority(task: WriteTask): void {
        let insertIndex = this.writeQueue.length;

        for (let i = 0; i < this.writeQueue.length; i++) {
            const queuedPriority = this.writeQueue[i].priority || 0;
            const taskPriority = task.priority || 0;

            if (taskPriority > queuedPriority) {
                insertIndex = i;
                break;
            }
        }

        this.writeQueue.splice(insertIndex, 0, task);
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;
        logger.debug(null, 'Starting write queue processing', {
            queueLength: this.writeQueue.length,
            maxConcurrency: this.concurrentWrites,
        });

        const workers: Promise<void>[] = [];

        for (let i = 0; i < this.concurrentWrites; i++) {
            workers.push(this.worker());
        }

        await Promise.all(workers);

        this.isProcessing = false;
        logger.debug(null, 'Write queue processing completed');
    }

    private async worker(): Promise<void> {
        while (this.writeQueue.length > 0) {
            const task = this.writeQueue.shift();
            if (!task) break;

            this.activeWriters++;

            try {
                // Log global file write stats before processing
                const stats = Writer.getGlobalWriteStats();
                if (stats.waiting > 10) {
                    // Only log if there's significant waiting
                    logger.debug(task.extension, 'Global file write queue status', {
                        activeFileWrites: stats.active,
                        waitingFileWrites: stats.waiting,
                        limit: stats.limit,
                        activeExtensionWrites: this.activeWriters,
                        queuedExtensions: this.writeQueue.length,
                    });
                }

                await this.writeExtensionToDisk(task.extension);
            } catch (error) {
                logger.error(task.extension, 'Failed to write extension to disk', {
                    error: error instanceof Error ? error.message : String(error),
                });
            } finally {
                this.activeWriters--;
            }
        }
    }

    private async writeExtensionToDisk(extension: Extension): Promise<void> {
        const outputPath = resolveOutputPath(extension);

        try {
            await Writer.writeExtension(extension, outputPath);
        } catch (error) {
            logger.error(extension, 'Failed to create output directory or write extension', {
                outputPath,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    public async flush(): Promise<void> {
        if (this.writeQueue.length === 0 && this.activeWriters === 0) {
            return;
        }

        logger.info(null, 'Flushing migration writer queue', {
            remainingTasks: this.writeQueue.length,
            activeWriters: this.activeWriters,
        });

        try {
            await this.processQueue();

            // Wait for all active writers to complete with timeout
            const timeout = 30000; // 30 seconds timeout
            const startTime = Date.now();

            while (this.activeWriters > 0) {
                if (Date.now() - startTime > timeout) {
                    logger.warn(
                        null,
                        'Flush timeout reached, some writers may not have completed',
                        {
                            activeWriters: this.activeWriters,
                            remainingTasks: this.writeQueue.length,
                        }
                    );
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            logger.debug(null, 'Migration writer queue flushed successfully', {
                activeWriters: this.activeWriters,
                remainingTasks: this.writeQueue.length,
            });
        } catch (error) {
            logger.error(null, 'Error during migration writer queue flush', {
                error: error instanceof Error ? error.message : String(error),
                activeWriters: this.activeWriters,
                remainingTasks: this.writeQueue.length,
            });
            throw error;
        }
    }

    public getQueueStatus(): {
        queueLength: number;
        activeWriters: number;
        isProcessing: boolean;
    } {
        return {
            queueLength: this.writeQueue.length,
            activeWriters: this.activeWriters,
            isProcessing: this.isProcessing,
        };
    }

    /**
     * Synchronously write an extension to disk to avoid memory clearing issues
     * @param extension The extension to write
     * @param outputPath The path to write the extension to
     */
    public async writeExtensionSync(extension: Extension, outputPath: string): Promise<void> {
        try {
            await Writer.writeExtension(extension, outputPath);
        } catch (error) {
            logger.error(
                extension,
                'Failed to create output directory or write extension synchronously',
                {
                    outputPath,
                    error: error instanceof Error ? error.message : String(error),
                }
            );
            throw error;
        }
    }
}
