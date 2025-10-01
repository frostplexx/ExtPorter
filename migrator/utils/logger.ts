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

// Get log level from environment variable, default to 'info'
const ENV_LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Get current log level number
const currentLogLevel = LOG_LEVELS[ENV_LOG_LEVEL.toLowerCase()] ?? LOG_LEVELS['info'];

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
 * Check if a log level should be logged based on current environment setting
 */
function shouldLog(level: LogLevel): boolean {
    const levelNumber = LOG_LEVELS[level.toLowerCase()];
    return levelNumber <= currentLogLevel;
}

/**
 * Truncate string to specified byte size
 */
function truncateToByteSize(str: string, maxBytes: number): string {
    if (!str) return str;
    const buffer = Buffer.from(str, 'utf8');
    if (buffer.length <= maxBytes) return str;

    // Find safe truncation point (avoid cutting UTF-8 characters)
    let truncated = buffer.subarray(0, maxBytes).toString('utf8');
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
    } catch (error) {
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
const LOG_BATCH_SIZE = 25; // Reduced from 50 to prevent buffer overflow
const LOG_BATCH_INTERVAL = 5000; // 5 seconds
const MAX_MONGODB_BATCH_SIZE = 10; // Single document inserts to avoid bulk write issues
const MAX_LOG_ENTRY_SIZE = 15 * 1024 * 1024; // 15MB max per log entry (MongoDB limit is ~16MB)
const MAX_META_SIZE = 10 * 1024 * 1024; // 10MB max for meta field
let logBatch: any[] = [];
let batchTimer: NodeJS.Timeout | null = null;

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
    const chunks = [];
    for (let i = 0; i < logsToFlush.length; i += MAX_MONGODB_BATCH_SIZE) {
        chunks.push(logsToFlush.slice(i, i + MAX_MONGODB_BATCH_SIZE));
    }

    const failedLogs = [];

    for (const chunk of chunks) {
        try {
            if (chunk.length === 1) {
                // Use single insert for individual documents
                await Database.shared.insertLog(chunk[0]);
            } else {
                // Use bulk insert for multiple documents (should not happen with MAX_MONGODB_BATCH_SIZE = 1)
                await Database.shared.insertManyLogs(chunk);
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
            // Collect failed chunks for retry
            failedLogs.push(...chunk);
        }
    }

    // Re-add failed logs to the front of the batch for retry (only if not database closure)
    if (failedLogs.length > 0) {
        logBatch = [...failedLogs, ...logBatch];
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
        // Check if database is shutting down
        if ((Database.shared as any).isShuttingDown) {
            console.error(
                `[SHUTDOWN VIOLATION] Logger attempted to add log after database shutdown: "${message.substring(0, 100)}..."`
            );
            console.error(`[SHUTDOWN VIOLATION] Stack trace:`, new Error().stack);
            return;
        }

        const logEntry = formatLog(extension, message, level, meta);
        logBatch.push(logEntry);

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
            console.info(`${getColoredLabel(LogLevel.INFO)} ${message}`, meta || '');
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
            console.warn(`${getColoredLabel(LogLevel.WARN)} ${message}`, meta || '');
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
            console.error(`${getColoredLabel(LogLevel.ERROR)} ${message}`, meta || '');
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
            console.debug(`${getColoredLabel(LogLevel.DEBUG)} ${message}`, meta || '');
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
};
