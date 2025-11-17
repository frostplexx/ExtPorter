import { LazyFile } from '../../types/abstract_file';

export class FileTransformer {
    /**
     * Creates a transformed file with modified content stored in memory.
     * This avoids modifying the original MV2 source files.
     * @param originalFile The original file to transform
     * @param newContent The new content for the transformed file
     * @returns A new LazyFile object with the modified content
     */
    public static createTransformedFile(originalFile: LazyFile, newContent: string): LazyFile {
        // Create new instance inheriting from LazyFile prototype
        const transformedFile = Object.create(LazyFile.prototype);

        // Copy basic properties
        transformedFile.path = originalFile.path;
        transformedFile.filetype = originalFile.filetype;
        transformedFile._transformedContent = newContent;
        // Copy absolute path for reference (but won't write to it)
        transformedFile._absolutePath = (originalFile as any)._absolutePath;

        // Override methods to work with transformed content
        transformedFile.getContent = () => newContent;
        transformedFile.getSize = () => Buffer.byteLength(newContent, 'utf8');
        transformedFile.close = () => {
            /* No-op for in-memory content */
        };
        transformedFile.getAST = () => {
            // Bridge injections don't need AST parsing
            return undefined;
        };
        transformedFile.getBuffer = () => Buffer.from(newContent, 'utf8');

        return transformedFile;
    }
}
