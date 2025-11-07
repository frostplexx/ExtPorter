import { Extension } from '../../types/extension';
import { LazyFile } from '../../types/abstract_file';
import { FileTransformer } from './file_transformer';
import { logger } from '../../utils/logger';

export class ServiceWorkerInjector {
    /**
     * Injects importScripts call into a service worker file.
     * Returns the transformed file or null if injection failed.
     */
    public static injectBridgeIntoServiceWorker(
        extension: Extension,
        serviceWorkerPath: string,
        bridgeFilename: string
    ): LazyFile | null {
        // Find the service worker file in the extension
        const serviceWorkerFile = extension.files.find((file) => file.path === serviceWorkerPath);

        if (!serviceWorkerFile) {
            logger.warn(extension, `Service worker file not found: ${serviceWorkerPath}`);
            return null;
        }

        try {
            // Get the current content
            const currentContent = serviceWorkerFile.getContent();

            // Check if the bridge import is already present
            const importStatement = `importScripts('${bridgeFilename}');`;
            if (currentContent.includes(importStatement)) {
                logger.debug(extension, 'Bridge import already present in service worker');
                return null; // No transformation needed
            }

            // Prepend import statement
            const newContent = `${importStatement}\n${currentContent}`;

            logger.info(extension, `Bridge injected into service worker: ${serviceWorkerPath}`);

            // Create and return transformed file (in memory only)
            return FileTransformer.createTransformedFile(serviceWorkerFile, newContent);
        } catch (error) {
            logger.error(
                extension,
                `Error injecting bridge into service worker ${serviceWorkerPath}: ${error instanceof Error ? error.message : String(error)}`,
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
}
