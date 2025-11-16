import * as fs from 'fs/promises';
import * as path from 'path';
import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { logger } from '../../utils/logger';

export class Writer {
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
     * Writes all extension files to disk
     * @param extension The extension
     * @param outputPath The output directory path
     */
    static async writeFiles(extension: Extension, outputPath: string): Promise<void> {
        const writePromises = extension.files.map(async (file) => {
            const filePath = path.join(outputPath, file.path);
            const fileDir = path.dirname(filePath);

            try {
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
                logger.error(extension, 'Failed to write file', {
                    filePath: file.path,
                    fileType: file.filetype,
                    isTextFile:
                        file.filetype === ExtFileType.JS ||
                        file.filetype === ExtFileType.CSS ||
                        file.filetype === ExtFileType.HTML,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        });

        await Promise.all(writePromises);
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
