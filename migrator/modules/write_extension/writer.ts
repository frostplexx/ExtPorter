import * as fs from 'fs/promises';
import * as path from 'path';
import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { logger } from '../../utils/logger';

export class Writer {
    private static readonly MAX_CONCURRENT_FILE_WRITES = 20; // Limit concurrent file operations per extension
    private static readonly MAX_GLOBAL_FILE_WRITES = 100; // Global limit across all extensions to prevent EMFILE

    // Global semaphore to track and limit file operations across all extensions
    private static globalFileWriteCount = 0;
    private static waitQueue: (() => void)[] = [];

    /**
     * Acquire a global file write slot
     * Blocks if MAX_GLOBAL_FILE_WRITES is exceeded until a slot becomes available
     */
    private static async acquireGlobalFileWriteSlot(): Promise<void> {
        if (this.globalFileWriteCount < this.MAX_GLOBAL_FILE_WRITES) {
            this.globalFileWriteCount++;
            return;
        }

        // Wait in queue until a slot becomes available
        return new Promise<void>((resolve) => {
            this.waitQueue.push(resolve);
        });
    }

    /**
     * Release a global file write slot
     * Allows the next waiting operation to proceed
     */
    private static releaseGlobalFileWriteSlot(): void {
        this.globalFileWriteCount--;

        // Wake up next waiting operation if any
        const next = this.waitQueue.shift();
        if (next) {
            this.globalFileWriteCount++;
            next();
        }
    }

    /**
     * Get current global file write statistics
     */
    static getGlobalWriteStats(): { active: number; waiting: number; limit: number } {
        return {
            active: this.globalFileWriteCount,
            waiting: this.waitQueue.length,
            limit: this.MAX_GLOBAL_FILE_WRITES,
        };
    }

    /**
     * Writes the manifest.json file for an extension
     * @param extension The extension
     * @param outputPath The output directory path
     */
    static async writeManifest(extension: Extension, outputPath: string): Promise<void> {
        const manifestPath = path.join(outputPath, 'manifest.json');
        const manifestContent = JSON.stringify(extension.manifest, null, 2);

        try {
            await fs.writeFile(manifestPath, manifestContent, 'utf8');
        } catch (error) {
            logger.error(extension, 'Failed to write manifest', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Helper to process items in batches with concurrency limit
     */
    private static async processBatch<T>(
        items: T[],
        processor: (item: T) => Promise<void>,
        concurrency: number
    ): Promise<void> {

        for (let i = 0; i < items.length; i += concurrency) {
            const batch = items.slice(i, i + concurrency);
            const batchPromises = batch.map((item) => processor(item));
            await Promise.all(batchPromises);
        }
    }

    /**
     * Writes all extension files to disk with concurrency limiting
     * @param extension The extension
     * @param outputPath The output directory path
     */
    static async writeFiles(extension: Extension, outputPath: string): Promise<void> {
        let errorCount = 0;
        const maxErrorsToLog = 5; // Only log first 5 errors to prevent log flooding

        await this.processBatch(
            extension.files,
            async (file) => {
                // Acquire global semaphore slot before writing
                await this.acquireGlobalFileWriteSlot();

                try {
                    const filePath = path.join(outputPath, file.path);
                    const fileDir = path.dirname(filePath);

                    await fs.mkdir(fileDir, { recursive: true });

                    // Use text encoding only for recognized text file types, binary copy for everything else
                    if (
                        file.filetype === ExtFileType.JS ||
                        file.filetype === ExtFileType.CSS ||
                        file.filetype === ExtFileType.HTML
                    ) {
                        // Write text files with UTF-8 encoding
                        const content = file.getContent();
                        await fs.writeFile(filePath, content, 'utf8');
                    } else {
                        // Write all other files (ExtFileType.OTHER) as binary to preserve data integrity
                        const buffer = file.getBuffer();
                        await fs.writeFile(filePath, buffer);
                    }
                } catch (error) {
                    errorCount++;

                    // Only log first few errors to prevent log flooding and cascading failures
                    if (errorCount <= maxErrorsToLog) {
                        // Use console.error to avoid triggering logger's MongoDB writes
                        console.error(
                            `Failed to write file ${file.path}:`,
                            error instanceof Error ? error.message : String(error)
                        );

                        if (errorCount === maxErrorsToLog) {
                            console.error(
                                `Suppressing further file write errors (too many failures)...`
                            );
                        }
                    }

                    // Don't throw - continue writing other files
                    // throw error;
                } finally {
                    // CRITICAL: Close the file descriptor immediately after writing to prevent EMFILE
                    // This must be in finally block to ensure it runs even if there's an error
                    try {
                        file.close();
                    } catch (closeError) {
                        // Ignore close errors
                        logger.error(extension, closeError as any)
                    }

                    // Always release the semaphore slot
                    this.releaseGlobalFileWriteSlot();
                }
            },
            this.MAX_CONCURRENT_FILE_WRITES
        );

        // If all files failed, throw an error
        if (errorCount === extension.files.length && errorCount > 0) {
            throw new Error(`Failed to write all ${errorCount} files`);
        }
    }

    /**
     * Calculates the total size of a directory recursively
     * @param dirPath The directory path
     * @returns The total size in bytes
     */
    static async calculateDirectorySize(dirPath: string): Promise<number> {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            let totalSize = 0;

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    totalSize += await this.calculateDirectorySize(fullPath);
                } else if (entry.isFile()) {
                    const stats = await fs.stat(fullPath);
                    totalSize += stats.size;
                }
            }

            return totalSize;
        } catch (error) {
            logger.debug(null, 'Failed to calculate directory size', {
                dirPath,
                error: error instanceof Error ? error.message : String(error),
            });
            return 0;
        }
    }

    /**
     * Writes a complete extension to disk (manifest + files)
     * @param extension The extension to write
     * @param outputPath The output directory path
     */
    static async writeExtension(extension: Extension, outputPath: string): Promise<void> {
        try {
            await fs.mkdir(outputPath, { recursive: true });

            await Promise.all([
                this.writeManifest(extension, outputPath),
                this.writeFiles(extension, outputPath),
            ]);
        } catch (error) {
            logger.error(extension, 'Failed to write extension to disk', {
                outputPath,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}
