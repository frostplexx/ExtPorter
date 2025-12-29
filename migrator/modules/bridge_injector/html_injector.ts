import { Extension } from '../../types/extension';
import { LazyFile } from '../../types/abstract_file';
import { FileTransformer } from './file_transformer';
import { logger } from '../../utils/logger';
import * as path from 'path';

export class HtmlInjector {
    /**
     * Injects bridge script tag into an HTML file.
     * Returns the transformed file or null if injection failed.
     */
    public static injectBridgeIntoHTML(
        extension: Extension,
        htmlPath: string,
        bridgeFilename: string
    ): LazyFile | null {
        const htmlFile = extension.files.find((file) => file!.path === htmlPath);

        if (!htmlFile) {
            logger.warn(extension, `HTML file not found: ${htmlPath}`);
            return null;
        }

        try {
            const content = htmlFile.getContent();

            // Calculate the correct relative path from the HTML file to the bridge file
            // The bridge file is always in the root, so we need to go up directories
            const htmlDir = path.dirname(htmlPath);
            const relativePath =
                htmlDir && htmlDir !== '.'
                    ? path.posix.join(...htmlDir.split(path.sep).map(() => '..'), bridgeFilename)
                    : bridgeFilename;

            const scriptTag = `<script src="${relativePath}"></script>`;

            // Check if already injected (check for both the filename and the script tag)
            if (content.includes(bridgeFilename)) {
                logger.debug(extension, `Bridge already in ${htmlPath}`);
                return null; // No transformation needed
            }

            // Inject before first existing script or before </head> or before </body>
            let newContent: string;
            if (content.includes('<script')) {
                // Inject before first script
                newContent = content.replace(/<script/, `${scriptTag}\n    <script`);
            } else if (content.includes('</head>')) {
                newContent = content.replace('</head>', `    ${scriptTag}\n</head>`);
            } else if (content.includes('</body>')) {
                newContent = content.replace('</body>', `    ${scriptTag}\n</body>`);
            } else {
                logger.warn(extension, `Could not find injection point in ${htmlPath}`);
                return null;
            }

            logger.info(extension, `Bridge injected into HTML: ${htmlPath}`);

            // Create and return transformed file (in memory only)
            return FileTransformer.createTransformedFile(htmlFile, newContent);
        } catch (error) {
            logger.error(
                extension,
                `Error injecting bridge into ${htmlPath}: ${error instanceof Error ? error.message : String(error)}`,
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
