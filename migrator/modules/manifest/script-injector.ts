import { Extension } from '../../types/extension';
import { logger } from '../../utils/logger';
import { LazyFile } from '../../types/abstract_file';
import * as espree from 'espree';

/**
 * Injects importScripts() calls into the chosen service worker for all other background scripts
 */
export function injectScriptImports(
    extension: Extension,
    serviceWorkerPath: string,
    scriptsToImport: string[]
): LazyFile | null {
    if (scriptsToImport.length === 0) {
        return null;
    }

    // Find the service worker file in the extension
    // TODO: The "!" could lead to problems here
    const serviceWorkerFile = extension.files.find((file) => file!.path === serviceWorkerPath);

    if (!serviceWorkerFile) {
        logger.warn(
            extension,
            `Service worker file not found: ${serviceWorkerPath}. Cannot inject imports.`
        );
        return null;
    }

    try {
        // Get the current content
        const currentContent = serviceWorkerFile.getContent();

        // Build the import statements for all other scripts in their original order
        const importStatements = scriptsToImport
            .map((script) => `importScripts('${script}');`)
            .join('\n');

        // Prepend import statements to the beginning of the file
        const parts = [importStatements, currentContent];
        const newContent = parts.join('\n');

        logger.info(
            extension,
            `Injected importScripts() into service worker: ${serviceWorkerPath}`,
            {
                imported_scripts: scriptsToImport,
            }
        );

        // Create and return transformed file (in memory only, doesn't modify source)
        return createTransformedFile(serviceWorkerFile, newContent);
    } catch (error) {
        logger.error(
            extension,
            `Failed to inject imports into service worker ${serviceWorkerPath}: ${error instanceof Error ? error.message : String(error)}`,
            {
                error:
                    error instanceof Error
                        ? {
                            message: error.message,
                            stack: error.stack,
                            name: error.name,
                        }
                        : String(error),
            }
        );
        return null;
    }
}

/**
 * Creates a transformed file with modified content stored in memory.
 * This avoids modifying the original MV2 source files.
 */
function createTransformedFile(originalFile: LazyFile, newContent: string): LazyFile {
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
        // Parse the transformed content to generate AST for subsequent modules
        try {
            // Try as script first (most common)
            return espree.parse(newContent, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });
        } catch {
            try {
                // Fallback to module parsing
                return espree.parse(newContent, {
                    ecmaVersion: 'latest',
                    sourceType: 'module',
                    loc: true,
                    range: true,
                });
            } catch {
                // If parsing fails, return undefined
                return undefined;
            }
        }
    };
    transformedFile.getBuffer = () => Buffer.from(newContent, 'utf8');

    return transformedFile;
}
