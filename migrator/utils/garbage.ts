import { Extension } from '../types/extension';
import { extensionUtils } from './extension_utils';
import { logger } from './logger';
import * as os from 'os';

/**
 * Memory management utilities for preventing OOM errors in long-running processes.
 */

/**
 * Get the effective memory limit for Node.js
 * Takes into account --max-old-space-size if set, otherwise uses system memory
 */
function getEffectiveMemoryLimitGB(): number {
    // Check if max-old-space-size is set in NODE_OPTIONS
    const nodeOptions = process.env.NODE_OPTIONS || '';
    const maxOldSpaceMatch = nodeOptions.match(/--max-old-space-size=(\d+)/);

    if (maxOldSpaceMatch) {
        const maxOldSpaceMB = parseInt(maxOldSpaceMatch[1], 10);
        return maxOldSpaceMB / 1024;
    }

    // Fall back to 80% of system memory
    const totalMemoryGB = os.totalmem() / 1024 / 1024 / 1024;
    return totalMemoryGB * 0.8;
}

// Calculate dynamic thresholds based on available memory
const EFFECTIVE_MEMORY_LIMIT_GB = getEffectiveMemoryLimitGB();

// Default memory thresholds as percentages of effective limit
// Use lower percentages to trigger warnings/GC earlier and prevent OOM
const DEFAULT_MEMORY_WARN_LIMIT_GB = Math.min(EFFECTIVE_MEMORY_LIMIT_GB * 0.5, 14);
const DEFAULT_MEMORY_CRIT_LIMIT_GB = Math.min(EFFECTIVE_MEMORY_LIMIT_GB * 0.65, 20);

// Threshold for triggering automatic GC - more aggressive to prevent runaway growth
const DEFAULT_GC_TRIGGER_THRESHOLD_GB = Math.min(EFFECTIVE_MEMORY_LIMIT_GB * 0.3, 8);

/**
 * Structured memory information
 */
export interface MemoryInfo {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    externalMB: number;
    arrayBuffersMB: number;
    heapUsedGB: number;
    rssGB: number;
}

/**
 * Get structured memory usage information
 */
export function getMemoryInfo(): MemoryInfo {
    const mem = process.memoryUsage();
    return {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
        arrayBuffersMB: Math.round(mem.arrayBuffers / 1024 / 1024),
        heapUsedGB: mem.heapUsed / 1024 / 1024 / 1024,
        rssGB: mem.rss / 1024 / 1024 / 1024,
    };
}

/**
 * Format memory usage for logging
 */
export function formatMemoryUsage(memoryUsage: NodeJS.MemoryUsage): string {
    return `RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB, Heap Used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB, Heap Total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`;
}

/**
 * Log current memory usage
 */
export function logMemoryUsage(context: string): void {
    const memUsage = process.memoryUsage();
    const isMonitoringEnabled = process.env.MEMORY_MONITORING === 'true';

    if (isMonitoringEnabled) {
        logger.info(null, `Memory usage [${context}]: ${formatMemoryUsage(memUsage)}`);
    } else {
        logger.debug(null, `Memory usage [${context}]: ${formatMemoryUsage(memUsage)}`);
    }
}

/**
 * Check if garbage collection should be triggered based on memory usage
 */
export function shouldTriggerGC(thresholdGB?: number): boolean {
    const threshold = thresholdGB ?? DEFAULT_GC_TRIGGER_THRESHOLD_GB;
    const info = getMemoryInfo();
    return info.heapUsedGB > threshold || info.rssGB > threshold;
}

/**
 * Force garbage collection if available (requires --expose-gc flag)
 */
export function forceGarbageCollection(): void {
    const isMonitoringEnabled = process.env.MEMORY_MONITORING === 'true';

    if (global.gc) {
        const beforeGC = process.memoryUsage();
        global.gc();
        const afterGC = process.memoryUsage();

        if (isMonitoringEnabled) {
            const freedMB = Math.round((beforeGC.heapUsed - afterGC.heapUsed) / 1024 / 1024);
            logger.info(null, `Forced garbage collection completed, freed ${freedMB}MB`);
        } else {
            logger.debug(null, 'Forced garbage collection');
        }
    } else {
        if (isMonitoringEnabled) {
            logger.warn(
                null,
                'Garbage collection not available. Run with --expose-gc flag for better memory management'
            );
        } else {
            logger.debug(
                null,
                'Garbage collection not available. Run with --expose-gc flag for better memory management'
            );
        }
    }
}

/**
 * Check memory against configured thresholds
 * @returns true if memory is within acceptable limits, false if critical
 */
export function checkMemoryThreshold(): boolean {
    const memInfo = getMemoryInfo();
    const critLimit = Number(process.env.MEMORY_CRIT_LIMIT) || DEFAULT_MEMORY_CRIT_LIMIT_GB;
    const warnLimit = Number(process.env.MEMORY_WARN_LIMIT) || DEFAULT_MEMORY_WARN_LIMIT_GB;

    if (memInfo.heapUsedGB > critLimit || memInfo.rssGB > critLimit) {
        logger.error(
            null,
            `CRITICAL: Memory usage too high! Heap: ${memInfo.heapUsedGB.toFixed(2)}GB, RSS: ${memInfo.rssGB.toFixed(2)}GB (limit: ${critLimit}GB)`
        );
        return false;
    }

    if (memInfo.heapUsedGB > warnLimit || memInfo.rssGB > warnLimit) {
        logger.warn(
            null,
            `WARNING: High memory usage detected! Heap: ${memInfo.heapUsedGB.toFixed(2)}GB, RSS: ${memInfo.rssGB.toFixed(2)}GB (limit: ${warnLimit}GB)`
        );
    }

    return true;
}

/**
 * Clear all memory associated with an extension
 * This should be called after an extension has been fully processed.
 * MEMORY OPTIMIZATION: This function aggressively releases all large objects
 * to prevent memory accumulation during batch processing.
 */
export function clearExtensionMemory(extension: Extension): void {
    // Close all file descriptors first (this calls close() which releases AST and content)
    extensionUtils.closeExtensionFiles(extension);

    // Clear file contents and ASTs from memory (redundant but ensures cleanup)
    for (let i = 0; i < extension.files.length; i++) {
        const file = extension.files[i];
        if (file) {
            // Use releaseMemory for new interface, fall back to cleanContent
            if (file.releaseMemory) {
                file.releaseMemory();
            } else if ((file as any).cleanContent) {
                (file as any).cleanContent();
            }
            // Also call close() to ensure file descriptors are released
            if (file.close) {
                try {
                    file.close();
                } catch {
                    // Ignore close errors - file might already be closed
                }
            }
            // Clear any AST cache
            if ((file as any)._cachedAST) {
                (file as any)._cachedAST = null;
            }
            if ((file as any)._ast) {
                (file as any)._ast = null;
            }
            // Clear transformed content if present
            if ((file as any)._transformedContent) {
                (file as any)._transformedContent = null;
            }
            // Nullify the reference immediately to help GC
            extension.files[i] = null as any;
        }
    }

    // Clear the files array completely
    extension.files.length = 0;

    // Clear large manifest data (keep minimal info for logging)
    const extensionName = extension.name;

    // Clear manifest but keep essential fields for potential logging
    extension.manifest = {
        name: extensionName,
        manifest_version: extension.manifest.manifest_version,
    };

    // Clear fakeium validation data - the summary stats are already in the database
    // No need to keep the full validation object in memory
    if (extension.fakeium_validation) {
        // Keep only the essential summary for potential re-use
        const summary = {
            enabled: extension.fakeium_validation.enabled,
            is_equivalent: extension.fakeium_validation.is_equivalent,
            similarity_score: extension.fakeium_validation.similarity_score,
        };
        // Replace the full object with just the summary
        extension.fakeium_validation = summary as any;
    }

    // Clear event listeners if present (can be large arrays with code snippets)
    if (extension.event_listeners) {
        extension.event_listeners.length = 0;
    }

    // Clear CWS info large fields (descriptions and images can be large)
    if (extension.cws_info) {
        // Keep minimal data, clear description and images
        const minimalCws = {
            description: '', // Clear long description
            images: {
                screenshots: [],
                videoThumbnails: [],
                videoEmbeds: [],
            },
            details: extension.cws_info.details, // Keep small details object
        };
        extension.cws_info = minimalCws as any;
    }

    // Clear tags array if it exists and is large
    if ((extension as any).tags && Array.isArray((extension as any).tags)) {
        (extension as any).tags.length = 0;
    }

    // Clear any migration metadata that might be holding references
    if ((extension as any)._migrationData) {
        (extension as any)._migrationData = null;
    }
}

/**
 * Aggressively clean up a batch of extensions and trigger GC
 */
export function aggressiveCleanup(extensions: Extension[]): void {
    for (const ext of extensions) {
        if (ext) {
            clearExtensionMemory(ext);
        }
    }
    extensions.length = 0;
    forceGarbageCollection();
}

/**
 * Periodically check memory and trigger cleanup if needed
 * Returns true if memory is healthy, false if action was needed
 */
export function periodicMemoryCheck(context: string): boolean {
    const isHealthy = checkMemoryThreshold();

    if (shouldTriggerGC()) {
        logMemoryUsage(`${context} - before GC`);
        forceGarbageCollection();
        logMemoryUsage(`${context} - after GC`);
    }

    return isHealthy;
}

/**
 * Calculate total memory used by extension files
 */
export function calculateExtensionMemoryUsage(extension: Extension): number {
    let totalBytes = 0;

    for (const file of extension.files) {
        if (!file) {
            console.error(extension, 'File is null');
            return -1;
        }
        // Check if file has getMemoryUsage method (LazyFile)
        if ('getMemoryUsage' in file && typeof (file as any).getMemoryUsage === 'function') {
            totalBytes += (file as any).getMemoryUsage();
        } else {
            // Fallback: estimate based on file size
            try {
                totalBytes += file.getSize();
            } catch {
                // File might be closed or unavailable
            }
        }
    }

    return totalBytes;
}

/**
 * Get memory usage summary for an array of extensions
 */
export function getExtensionsMemorySummary(extensions: Extension[]): {
    totalExtensions: number;
    totalFilesLoaded: number;
    estimatedMemoryMB: number;
} {
    let totalFiles = 0;
    let totalMemory = 0;

    for (const ext of extensions) {
        if (!ext || !ext.files) continue;

        for (const file of ext.files) {
            if (!file) {
                console.error(ext, 'File is null');
                continue;
            }

            if ('isLoaded' in file && typeof (file as any).isLoaded === 'function') {
                if ((file as any).isLoaded()) {
                    totalFiles++;
                }
            }
            totalMemory += calculateExtensionMemoryUsage(ext);
        }
    }

    return {
        totalExtensions: extensions.filter(Boolean).length,
        totalFilesLoaded: totalFiles,
        estimatedMemoryMB: Math.round(totalMemory / 1024 / 1024),
    };
}
