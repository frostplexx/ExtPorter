import { describe, it, expect } from '@jest/globals';
import { Database } from '../../../migrator/features/database/db_manager';

describe('Database Queue - full queue behavior', () => {
    it('rejects enqueues when queue is full after waiting', async () => {
        const db = Database.shared;

        // Save originals
        const original = {
            maxQueueSize: (db as any).maxQueueSize,
            queueWaitTimeoutMs: (db as any).queueWaitTimeoutMs,
            queueWarnIntervalMs: (db as any).queueWarnIntervalMs,
            isProcessingQueue: (db as any).isProcessingQueue,
            operationQueue: (db as any).operationQueue.slice(),
            queueWaiters: (db as any).queueWaiters.slice(),
            pendingOperations: (db as any).pendingOperations,
            isShuttingDown: (db as any).isShuttingDown,
        };

        try {
            // Configure a tiny queue and short timeout to make the test deterministic
            (db as any).maxQueueSize = 3;
            (db as any).queueWaitTimeoutMs = 200; // short timeout
            (db as any).queueWarnIntervalMs = 10;
            (db as any).isProcessingQueue = false;
            (db as any).isShuttingDown = false;

            (db as any).operationQueue = [];
            (db as any).queueWaiters = [];
            (db as any).pendingOperations = 0;

            // Fill the queue with unresolved operations; capture returned promises and attach
            // catch handlers so forced rejection during cleanup does not become an unhandled rejection.
            const createdPromises: Promise<any>[] = [];
            for (let i = 0; i < 3; i++) {
                const p = (db as any).enqueueOperation(() => new Promise(() => {}));
                // Attach a noop catch so later rejection doesn't trigger an unhandled rejection error.
                p.catch(() => {});
                createdPromises.push(p);
            }

            // The next enqueue should wait and eventually reject after the timeout
            await expect(
                (db as any).enqueueOperation(() => Promise.resolve('ok'))
            ).rejects.toThrow(/Database queue full after waiting/);
        } finally {
            // Clean up any leftover queued items or waiters
            while ((db as any).operationQueue.length > 0) {
                const item = (db as any).operationQueue.shift();
                if (item) {
                    try {
                        item.reject(new Error('Test cleanup'));
                    } catch { }
                }
            }
            while ((db as any).queueWaiters.length > 0) {
                const waiter = (db as any).queueWaiters.shift();
                if (waiter) {
                    try {
                        waiter();
                    } catch { }
                }
            }

            // Restore original config
            (db as any).maxQueueSize = original.maxQueueSize;
            (db as any).queueWaitTimeoutMs = original.queueWaitTimeoutMs;
            (db as any).queueWarnIntervalMs = original.queueWarnIntervalMs;
            (db as any).isProcessingQueue = original.isProcessingQueue;
            (db as any).operationQueue = original.operationQueue;
            (db as any).queueWaiters = original.queueWaiters;
            (db as any).pendingOperations = original.pendingOperations;
            (db as any).isShuttingDown = original.isShuttingDown;
        }
    });
});

