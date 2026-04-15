import path from 'path';
import fs from 'fs-extra';
import { Database } from '../features/database/db_manager';
import { Extension } from '../types/extension';

export enum LogLevel {
    DEBUG = 'debug',
    INFO = 'info',
    WARN = 'warning',
    ERROR = 'error',
}

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
fs.ensureDirSync(logsDir);

// Define log level hierarchy (higher number = more verbose)
const LOG_LEVELS: Record<string, number> = {
    error: 0,
    warning: 1,
    info: 2,
    debug: 3,
};

/**
 * Get current log level number dynamically from environment
 */
function getCurrentLogLevel(): number {
    const envLevel = process.env.LOG_LEVEL || 'info';
    return LOG_LEVELS[envLevel.toLowerCase()] ?? LOG_LEVELS['info'];
}

// ANSI color codes for log levels
const COLORS = {
    reset: '\x1b[0m',
    debug: '\x1b[36m', // Cyan
    info: '\x1b[32m', // Green
    warning: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
};

/**
 * Get colored log level label
 */
function getColoredLabel(level: LogLevel): string {
    const color = COLORS[level.toLowerCase() as keyof typeof COLORS] || COLORS.reset;
    const label = level.toUpperCase();
    return `${color}[${label}]${COLORS.reset}`;
}

/**
 * Check if stdout logging is enabled
 */
function isStdoutEnabled(): boolean {
    const envValue = process.env.LOG_STDOUT;
    // Default to true if not set, only disable if explicitly set to 'false'
    return envValue?.toLowerCase() !== 'false';
}

/**
 * Check if a log level should be logged based on current environment setting
 */
function shouldLog(level: LogLevel): boolean {
    const levelNumber = LOG_LEVELS[level.toLowerCase()];
    return levelNumber <= getCurrentLogLevel();
}

/**
 * Truncate string to specified byte size
 */
function truncateToByteSize(str: string, maxBytes: number): string {
    if (!str) return str;
    const buffer = Buffer.from(str, 'utf8');
    if (buffer.length <= maxBytes) return str;

    // Find safe truncation point (avoid cutting UTF-8 characters)
    const truncated = buffer.subarray(0, maxBytes).toString('utf8');
    const lastValidChar = truncated.length;

    return truncated.substring(0, lastValidChar) + '... [TRUNCATED]';
}

/**
 * Safely serialize and truncate meta data
 */
function sanitizeMeta(meta: any): any {
    if (!meta) return meta;

    try {
        const serialized = JSON.stringify(meta);
        const byteSize = Buffer.byteLength(serialized, 'utf8');

        if (byteSize <= MAX_META_SIZE) {
            return meta;
        }

        // If too large, truncate the stringified version
        const truncated = truncateToByteSize(serialized, MAX_META_SIZE);
        return {
            _truncated: true,
            _originalSize: byteSize,
            data: truncated,
        };
    } catch {
        // If serialization fails, convert to string safely
        return {
            _serializationError: true,
            data: truncateToByteSize(String(meta), MAX_META_SIZE),
        };
    }
}

/**
 * Format log entry for database storage with size limits
 */
function formatLog(
    extension: Extension | null = null,
    message: string,
    loglevel: LogLevel,
    meta?: any
) {
    // Truncate message if too large
    const truncatedMessage = truncateToByteSize(message, 1024 * 1024); // 1MB max for message
    const sanitizedMeta = sanitizeMeta(meta);

    const logEntry = {
        loglevel: loglevel,
        extension:
            extension != null
                ? {
                      id: extension.id,
                      path: extension.manifest_v2_path,
                      name: extension.name,
                      isNewTabExtension: extension.isNewTabExtension || false,
                  }
                : '',
        message: truncatedMessage.toLowerCase(),
        meta: sanitizedMeta,
        time: Date.now(),
    };

    // Final size check - if still too large, remove meta entirely
    try {
        const totalSize = Buffer.byteLength(JSON.stringify(logEntry), 'utf8');
        if (totalSize > MAX_LOG_ENTRY_SIZE) {
            return {
                loglevel: loglevel,
                message: truncatedMessage,
                meta: { _removed: 'Meta too large', _originalSize: totalSize },
                time: Date.now(),
            };
        }
    } catch (error) {
        // If size check fails, return minimal entry
        return {
            loglevel: loglevel,
            message: 'Log entry size check failed',
            meta: { _error: String(error) },
            time: Date.now(),
        };
    }

    return logEntry;
}

// Batch logging configuration
const LOG_BATCH_SIZE = 10; // Reduced to prevent overwhelming MongoDB
const LOG_BATCH_INTERVAL = 5000; // 5 seconds
const MAX_MONGODB_BATCH_SIZE = 5; // Smaller batches to prevent connection exhaustion
const MAX_LOG_ENTRY_SIZE = 15 * 1024 * 1024; // 15MB max per log entry (MongoDB limit is ~16MB)
const MAX_META_SIZE = 10 * 1024 * 1024; // 10MB max for meta field
const ERROR_LOG_RATE_LIMIT = 100; // Maximum error logs per interval
const ERROR_LOG_RATE_INTERVAL = 1000; // 1 second interval for rate limiting
const MAX_LOG_BATCH_SIZE = 100; // Maximum batch size to prevent memory issues
const MAX_LOG_RETRY_COUNT = 2; // Reduced: Maximum retries before discarding (was 3)
const MAX_FAILED_LOGS_IN_BATCH = 20; // Maximum failed logs to keep for retry

// Internal type for tracking log retries
interface BatchedLogEntry {
    entry: any;
    retryCount: number;
}

let logBatch: BatchedLogEntry[] = [];
let batchTimer: NodeJS.Timeout | null = null;
let errorLogCount = 0;
let lastErrorReset = Date.now();
let droppedLogCount = 0; // Track dropped logs for monitoring
let discardedDueToRetries = 0; // Track logs discarded after max retries

/**
 * Flush log batch to database in smaller chunks
 */
async function flushLogBatch() {
    if (logBatch.length === 0) return;

    // Check if database is shutting down
    if ((Database.shared as any).isShuttingDown) {
        console.error(
            `[SHUTDOWN VIOLATION] Logger attempted to flush ${logBatch.length} logs after database shutdown`
        );
        console.error(`[SHUTDOWN VIOLATION] Stack trace:`, new Error().stack);
        logBatch = []; // Clear the batch to prevent retries
        return;
    }

    const logsToFlush = [...logBatch];
    logBatch = [];

    // Check if database is available
    if (!Database.shared.database) {
        // console.warn(`Cannot flush ${logsToFlush.length} logs: Database not available`);
        return;
    }

    // Split into smaller chunks to prevent MongoDB buffer overflow
    const chunks: BatchedLogEntry[][] = [];
    for (let i = 0; i < logsToFlush.length; i += MAX_MONGODB_BATCH_SIZE) {
        chunks.push(logsToFlush.slice(i, i + MAX_MONGODB_BATCH_SIZE));
    }

    const failedLogs: BatchedLogEntry[] = [];

    for (const chunk of chunks) {
        // Check shutdown status before each chunk to handle mid-flush shutdowns
        if ((Database.shared as any).isShuttingDown) {
            console.warn(`Database shutting down, discarding ${chunk.length} logs`);
            continue;
        }

        try {
            // Extract the actual log entries for database insertion
            const entries = chunk.map(b => b.entry);
            if (entries.length === 1) {
                // Use single insert for individual documents
                await Database.shared.insertLog(entries[0]);
            } else {
                // Use bulk insert for multiple documents
                await Database.shared.insertManyLogs(entries);
            }
        } catch (error) {
            console.error(`Failed to flush log chunk (${chunk.length} logs) to database:`, error);
            // Don't retry if database is closed
            if (
                (error as any).message?.includes('Topology is closed') ||
                (error as any).message?.includes('Database not initialized')
            ) {
                console.warn(`Database closed, discarding ${chunk.length} logs`);
                continue;
            }
            // Increment retry count and collect failed chunks for retry
            for (const batchedLog of chunk) {
                batchedLog.retryCount++;
                if (batchedLog.retryCount >= MAX_LOG_RETRY_COUNT) {
                    // Discard logs that have exceeded retry limit
                    discardedDueToRetries++;
                    if (discardedDueToRetries % 100 === 1) {
                        console.warn(
                            `[LOGGER] Discarded ${discardedDueToRetries} total logs after ${MAX_LOG_RETRY_COUNT} retry attempts`
                        );
                    }
                } else {
                    failedLogs.push(batchedLog);
                }
            }
        }
    }

    // Re-add failed logs to the front of the batch for retry (only if not database closure)
    // MEMORY FIX: Limit the number of failed logs we keep for retry
    if (failedLogs.length > 0 && !(Database.shared as any).isShuttingDown) {
        // Only keep a limited number of failed logs to prevent unbounded growth
        const logsToRetry = failedLogs.slice(0, MAX_FAILED_LOGS_IN_BATCH);
        if (failedLogs.length > MAX_FAILED_LOGS_IN_BATCH) {
            const discarded = failedLogs.length - MAX_FAILED_LOGS_IN_BATCH;
            discardedDueToRetries += discarded;
            console.warn(
                `[LOGGER] Discarded ${discarded} failed logs exceeding retry batch limit (${MAX_FAILED_LOGS_IN_BATCH})`
            );
        }
        logBatch = [...logsToRetry, ...logBatch];
        
        // Ensure total batch size doesn't exceed limit after adding retries
        if (logBatch.length > MAX_LOG_BATCH_SIZE) {
            const overflow = logBatch.length - MAX_LOG_BATCH_SIZE;
            logBatch.splice(MAX_LOG_BATCH_SIZE); // Keep only up to MAX_LOG_BATCH_SIZE
            droppedLogCount += overflow;
        }
    }
}

/**
 * Add log to batch and flush if necessary (non-blocking)
 */
function addLogToBatch(
    level: LogLevel,
    extension: Extension | null = null,
    message: string,
    meta?: any
) {
    if (shouldLog(level)) {
        // Rate limit ERROR logs to prevent cascading failures from flooding MongoDB
        if (level === LogLevel.ERROR) {
            const now = Date.now();
            if (now - lastErrorReset > ERROR_LOG_RATE_INTERVAL) {
                errorLogCount = 0;
                lastErrorReset = now;
            }

            errorLogCount++;

            // If we've exceeded the rate limit, drop the log (but still console.error it)
            if (errorLogCount > ERROR_LOG_RATE_LIMIT) {
                if (errorLogCount === ERROR_LOG_RATE_LIMIT + 1) {
                    console.error(
                        `[RATE LIMIT] Suppressing error logs to database (>${ERROR_LOG_RATE_LIMIT}/sec). Console logging continues.`
                    );
                }
                // Don't add to batch - just return
                return;
            }
        }

        // Check if database is shutting down
        if ((Database.shared as any).isShuttingDown) {
            console.error(
                `[SHUTDOWN VIOLATION] Logger attempted to add log after database shutdown: "${message.substring(0, 100)}..."`
            );
            console.error(`[SHUTDOWN VIOLATION] Stack trace:`, new Error().stack);
            return;
        }

        // Enforce maximum batch size to prevent memory issues
        if (logBatch.length >= MAX_LOG_BATCH_SIZE) {
            const dropped = logBatch.splice(0, 10); // Remove oldest 10 logs
            droppedLogCount += dropped.length;
            if (droppedLogCount % 100 === dropped.length) {
                // Log every ~100 dropped logs
                console.warn(
                    `[LOGGER] Dropped ${droppedLogCount} total logs due to batch overflow (batch size: ${logBatch.length})`
                );
            }
        }

        const logEntry = formatLog(extension, message, level, meta);
        // Wrap log entry with retry tracking
        logBatch.push({ entry: logEntry, retryCount: 0 });

        // Schedule periodic flush if not already scheduled
        if (!batchTimer && Database.shared.database) {
            batchTimer = setTimeout(async () => {
                await flushLogBatch();
                batchTimer = null;
            }, LOG_BATCH_INTERVAL);
        }

        // Flush immediately if batch is full (non-blocking)
        if (logBatch.length >= LOG_BATCH_SIZE) {
            if (batchTimer) {
                clearTimeout(batchTimer);
                batchTimer = null;
            }
            // Don't await here to keep it non-blocking
            flushLogBatch().catch((error) => {
                console.error('Background log flush failed:', error);
            });
        }
    }
}

/**
 * Force flush any remaining logs (for shutdown)
 */
async function flushAllLogs() {
    if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
    }
    await flushLogBatch();
}

/**
 * Stop all logging timers (for cleanup)
 */
function stopLogging() {
    if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
    }
}

/**
 * Global logger object
 */
export const logger = {
    /**
     * Log info messages
     */
    info: (extension: Extension | null = null, message: string, meta?: any) => {
        // Supress logging in test mode
        if (process.env.NODE_ENV === 'test') {
            return;
        }
        if (shouldLog(LogLevel.INFO)) {
            if (isStdoutEnabled()) {
                console.info(`${getColoredLabel(LogLevel.INFO)} ${message}`, meta || '');
            }
            addLogToBatch(LogLevel.INFO, extension, message, meta);
        }
    },

    /**
     * Log warning messages
     */
    warn: (extension: Extension | null = null, message: string, meta?: any) => {
        // Supress logging in test mode
        if (process.env.NODE_ENV === 'test') {
            return;
        }
        if (shouldLog(LogLevel.WARN)) {
            if (isStdoutEnabled()) {
                console.warn(`${getColoredLabel(LogLevel.WARN)} ${message}`, meta || '');
            }
            addLogToBatch(LogLevel.WARN, extension, message, meta);
        }
    },

    /**
     * Log error messages
     */
    error: (extension: Extension | null = null, message: string, meta?: any) => {
        // Supress logging in test mode
        if (process.env.NODE_ENV === 'test') {
            return;
        }
        if (shouldLog(LogLevel.ERROR)) {
            if (isStdoutEnabled()) {
                console.error(`${getColoredLabel(LogLevel.ERROR)} ${message}`, meta || '');
            }
            addLogToBatch(LogLevel.ERROR, extension, message, meta);
        }
    },

    /**
     * Log debug messages
     */
    debug: (extension: Extension | null = null, message: string, meta?: any) => {
        // Supress logging in test mode
        if (process.env.NODE_ENV === 'test') {
            return;
        }
        if (shouldLog(LogLevel.DEBUG)) {
            if (isStdoutEnabled()) {
                console.debug(`${getColoredLabel(LogLevel.DEBUG)} ${message}`, meta || '');
            }
            addLogToBatch(LogLevel.DEBUG, extension, message, meta);
        }
    },

    /**
     * Flush all pending logs to database
     */
    flush: async () => {
        await flushAllLogs();
    },

    /**
     * Stop all logging processes (for cleanup)
     */
    stop: () => {
        stopLogging();
    },

    /**
     * Get logger statistics for monitoring
     */
    getStats: () => ({
        batchSize: logBatch.length,
        droppedCount: droppedLogCount,
        discardedDueToRetries: discardedDueToRetries,
        maxBatchSize: MAX_LOG_BATCH_SIZE,
        maxRetryCount: MAX_LOG_RETRY_COUNT,
    }),
};
