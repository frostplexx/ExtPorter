import * as fs from "fs/promises";
import * as path from "path";
import { Extension } from "../types/extension";
import { globals } from "../index";
import { logger } from "../utils/logger";
import { ExtFileType } from "../types/ext_file_types";

interface WriteTask {
    extension: Extension;
    priority?: number;
}

export class MigrationWriter {
    private static instance: MigrationWriter;
    private writeQueue: WriteTask[] = [];
    private isProcessing = false;
    private readonly concurrentWrites = 3;
    private activeWriters = 0;


    private constructor() {
        // Handle graceful shutdown
        process.on('beforeExit', async () => {
            await this.flush();
        });
        
        process.on('SIGINT', async () => {
            console.log("Received SIGINT, flushing queues");
            await this.flush();
            await logger.flush();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log("Received SIGTERM, flushing queues");
            await this.flush();
            await logger.flush();
            process.exit(0);
        });
    }

    public static get shared(): MigrationWriter {
        if (!MigrationWriter.instance) {
            MigrationWriter.instance = new MigrationWriter();
        }
        return MigrationWriter.instance;
    }

    public async queueExtension(extension: Extension, priority: number = 0): Promise<void> {
        const task: WriteTask = { extension, priority };
        
        this.insertTaskByPriority(task);
        
        logger.debug(extension, "Extension queued for writing", {
            queueLength: this.writeQueue.length,
            priority
        });

        if (!this.isProcessing) {
            this.processQueue();
        }
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
        logger.debug(null, "Starting write queue processing", {
            queueLength: this.writeQueue.length,
            maxConcurrency: this.concurrentWrites
        });

        const workers: Promise<void>[] = [];
        
        for (let i = 0; i < this.concurrentWrites; i++) {
            workers.push(this.worker());
        }

        await Promise.all(workers);
        
        this.isProcessing = false;
        logger.debug(null, "Write queue processing completed");
    }

    private async worker(): Promise<void> {
        while (this.writeQueue.length > 0) {
            const task = this.writeQueue.shift();
            if (!task) break;

            this.activeWriters++;
            
            try {
                await this.writeExtensionToDisk(task.extension);
            } catch (error) {
                logger.error(task.extension, "Failed to write extension to disk", {
                    error: error instanceof Error ? error.message : String(error)
                });
            } finally {
                this.activeWriters--;
            }
        }
    }

    private async writeExtensionToDisk(extension: Extension): Promise<void> {
        
        // Check if NEW_TAB_SUBFOLDER is enabled and this is a new tab extension
        const useNewTabSubfolder = process.env.NEW_TAB_SUBFOLDER === 'true';
        const isNewTab = extension.isNewTabExtension || false;
        
        let outputPath: string;
        // Use MV3 ID if available, otherwise fall back to MV2 ID
        const extensionId = extension.mv3_extension_id || extension.id;

        if (useNewTabSubfolder && isNewTab) {
            outputPath = path.join(globals.outputDir, 'new_tab_extensions', extensionId);
        } else {
            outputPath = path.join(globals.outputDir, extensionId);
        }
        
        try {
            await fs.mkdir(outputPath, { recursive: true });
            
            await Promise.all([
                this.writeManifest(extension, outputPath),
                this.writeFiles(extension, outputPath)
            ]);
            
            // const logMessage = isNewTab && useNewTabSubfolder ? 
            //     "written new-tab extension to subfolder" : 
            //     "written extension";
            //
            // logger.info(extension, logMessage, {
            //     outputSizeBytes: await this.calculateDirectorySize(outputPath),
            //     outputPath: outputPath
            // });
            
        } catch (error) {
            logger.error(extension, "Failed to create output directory or write extension", {
                outputPath,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    private async writeManifest(extension: Extension, outputPath: string): Promise<void> {
        const manifestPath = path.join(outputPath, "manifest.json");
        const manifestContent = JSON.stringify(extension.manifest, null, 2);

        try {
            await fs.writeFile(manifestPath, manifestContent, "utf8");
        } catch (error) {
            logger.error(extension, "Failed to write manifest", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    private async writeFiles(extension: Extension, outputPath: string): Promise<void> {
        const writePromises = extension.files.map(async (file) => {
            const filePath = path.join(outputPath, file.path);
            const fileDir = path.dirname(filePath);

            try {
                await fs.mkdir(fileDir, { recursive: true });

                // Use text encoding only for recognized text file types, binary copy for everything else
                if (file.filetype === ExtFileType.JS ||
                    file.filetype === ExtFileType.CSS ||
                    file.filetype === ExtFileType.HTML) {
                    // Write text files with UTF-8 encoding
                    const content = file.getContent();
                    await fs.writeFile(filePath, content, "utf8");
                } else {
                    // Write all other files (ExtFileType.OTHER) as binary to preserve data integrity
                    const buffer = file.getBuffer();
                    await fs.writeFile(filePath, buffer);
                }

            } catch (error) {
                logger.error(extension, "Failed to write file", {
                    filePath: file.path,
                    fileType: file.filetype,
                    isTextFile: file.filetype === ExtFileType.JS || file.filetype === ExtFileType.CSS || file.filetype === ExtFileType.HTML,
                    error: error instanceof Error ? error.message : String(error)
                });
                throw error;
            }
        });

        await Promise.all(writePromises);
    }

    private async calculateDirectorySize(dirPath: string): Promise<number> {
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
            logger.debug(null, "Failed to calculate directory size", {
                dirPath,
                error: error instanceof Error ? error.message : String(error)
            });
            return 0;
        }
    }

    public async flush(): Promise<void> {
        if (this.writeQueue.length === 0 && this.activeWriters === 0) {
            return;
        }
        
        logger.info(null, "Flushing migration writer queue", {
            remainingTasks: this.writeQueue.length,
            activeWriters: this.activeWriters
        });
        
        try {
            await this.processQueue();
            
            // Wait for all active writers to complete with timeout
            const timeout = 30000; // 30 seconds timeout
            const startTime = Date.now();
            
            while (this.activeWriters > 0) {
                if (Date.now() - startTime > timeout) {
                    logger.warn(null, "Flush timeout reached, some writers may not have completed", {
                        activeWriters: this.activeWriters,
                        remainingTasks: this.writeQueue.length
                    });
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            logger.debug(null, "Migration writer queue flushed successfully", {
                activeWriters: this.activeWriters,
                remainingTasks: this.writeQueue.length
            });
        } catch (error) {
            logger.error(null, "Error during migration writer queue flush", {
                error: error instanceof Error ? error.message : String(error),
                activeWriters: this.activeWriters,
                remainingTasks: this.writeQueue.length
            });
            throw error;
        }
    }

    public getQueueStatus(): { queueLength: number; activeWriters: number; isProcessing: boolean } {
        return {
            queueLength: this.writeQueue.length,
            activeWriters: this.activeWriters,
            isProcessing: this.isProcessing
        };
    }

    /**
     * Synchronously write an extension to disk to avoid memory clearing issues
     * @param extension The extension to write
     * @param outputPath The path to write the extension to
     */
    public async writeExtensionSync(extension: Extension, outputPath: string): Promise<void> {
        try {
            await fs.mkdir(outputPath, { recursive: true });

            await Promise.all([
                this.writeManifest(extension, outputPath),
                this.writeFiles(extension, outputPath)
            ]);

        } catch (error) {
            logger.error(extension, "Failed to create output directory or write extension synchronously", {
                outputPath,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}
