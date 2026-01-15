import { Extension } from '../../types/extension';
import { logger } from '../../utils/logger';
import { AbstractFile, createTransformedFile } from '../../types/abstract_file';

/**
 * Injects importScripts() calls into the chosen service worker for all other background scripts
 */
export function injectScriptImports(
    extension: Extension,
    serviceWorkerPath: string,
    scriptsToImport: string[]
): AbstractFile | null {
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
