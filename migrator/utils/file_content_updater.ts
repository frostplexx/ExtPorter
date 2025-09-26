import { LazyFile } from "../types/abstract_file";
import { ExtFileType } from "../types/ext_file_types";
import * as fs from "fs-extra";
import * as path from "path";
import { logger } from "./logger";

export class FileContentUpdater {

    /**
     * Updates the content of a LazyFile by writing new content to its absolute path
     *
     * @param file The LazyFile to update
     * @param newContent The new content to write
     * @returns true if successful, false otherwise
     */
    static updateFileContent(file: LazyFile, newContent: string): boolean {
        try {
            // Get the absolute path from the LazyFile
            const absolutePath = (file as any)._absolutePath;

            if (!absolutePath) {
                logger.warn(null, `Cannot update file content: no absolute path found for ${file.path}`);
                return false;
            }

            // Ensure the directory exists
            fs.ensureDirSync(path.dirname(absolutePath));

            // Write the new content
            fs.writeFileSync(absolutePath, newContent, 'utf8');

            // Clear any cached content in the LazyFile
            if (file.cleanContent) {
                file.cleanContent();
            }

            return true;
        } catch (error) {
            logger.error(null, `Failed to update file content for ${file.path}:`, error);
            return false;
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
    static createNewFile(absolutePath: string, content: string, relativePath: string, fileType: ExtFileType): LazyFile | null {
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
