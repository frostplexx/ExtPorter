import { Extension } from '../types/extension';
import { extensionUtils } from './extension_utils';
import { logger } from './logger';

/**
 * Memory management utilities
 */
export function formatMemoryUsage(memoryUsage: NodeJS.MemoryUsage): string {
    return `RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB, Heap Used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB, Heap Total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`;
}

export function logMemoryUsage(context: string): void {
    const memUsage = process.memoryUsage();
    const isMonitoringEnabled = process.env.MEMORY_MONITORING === 'true';

    if (isMonitoringEnabled) {
        logger.info(null, `Memory usage [${context}]: ${formatMemoryUsage(memUsage)}`);
    } else {
        logger.debug(null, `Memory usage [${context}]: ${formatMemoryUsage(memUsage)}`);
    }
}

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

export function checkMemoryThreshold(): boolean {
    const memUsage = process.memoryUsage();
    const heapUsedGB = memUsage.heapUsed / 1024 / 1024 / 1024;
    const rssGB = memUsage.rss / 1024 / 1024 / 1024;

    if (
        heapUsedGB > ((process.env.MEMORY_CRIT_LIMIT || 1.0) as number) ||
        rssGB > ((process.env.MEMORY_CRIT_LIMIT || 1.0) as number)
    ) {
        logger.error(
            null,
            `CRITICAL: Memory usage too high! Heap: ${heapUsedGB.toFixed(2)}GB, RSS: ${rssGB.toFixed(2)}GB`
        );
        return false;
    } else if (
        heapUsedGB > ((process.env.MEMORY_WARN_LIMIT || 1.0) as number) ||
        rssGB > ((process.env.MEMORY_WARN_LIMIT || 1.0) as number)
    ) {
        logger.warn(
            null,
            `WARNING: High memory usage detected! Heap: ${heapUsedGB.toFixed(2)}GB, RSS: ${rssGB.toFixed(2)}GB`
        );
    }

    return true;
}

export function clearExtensionMemory(extension: Extension): void {
    // Close all file descriptors
    extensionUtils.closeExtensionFiles(extension);

    // Clear file contents and ASTs from memory
    extension.files.forEach((file) => {
        if (file.cleanContent) {
            file.cleanContent(); // This exists in LazyFile
        }
    });

    // Clear the files array
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
}
