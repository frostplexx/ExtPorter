import { LazyFile } from '../types/abstract_file';
import { ExtFileType } from '../types/ext_file_types';
import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from './logger';

export class FileContentUpdater {
    /**
     * Updates the content of a LazyFile by writing new content to its absolute path
     *
     * @param file The LazyFile to update
     * @param newContent The new content to write
     * @throws Error if update fails
     */
    static updateFileContent(file: LazyFile, newContent: string): void {
        // Get the absolute path from the LazyFile
        const absolutePath = (file as any)._absolutePath;

        if (!absolutePath) {
            throw new Error(`Cannot update file content: no absolute path found for ${file.path}`);
        }

        try {
            // Ensure the directory exists
            fs.ensureDirSync(path.dirname(absolutePath));

            // Write the new content
            fs.writeFileSync(absolutePath, newContent, 'utf8');

            // Clear any cached content in the LazyFile
            if (file.cleanContent) {
                file.cleanContent();
            }
        } catch (error) {
            throw new Error(
                `Failed to write file content for ${file.path}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Creates a new file at the specified path with the given content
     *
     * @param absolutePath The absolute path where the file should be created
     * @param content The content to write
     * @param relativePath The relative path for the LazyFile
     * @param fileType The file type
     * @returns A new LazyFile instance or null if creation failed
     */
    static createNewFile(
        absolutePath: string,
        content: string,
        relativePath: string,
        fileType: ExtFileType
    ): LazyFile | null {
        try {
            // Ensure the directory exists
            fs.ensureDirSync(path.dirname(absolutePath));

            // Write the content
            fs.writeFileSync(absolutePath, content, 'utf8');

            // Create and return the LazyFile
            return new LazyFile(relativePath, absolutePath, fileType);
        } catch (error) {
            logger.error(null, `Failed to create file at ${absolutePath}:`, error);
            return null;
        }
    }
}
