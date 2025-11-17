import { lstatSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { Extension } from '../types/extension';
import { ExtFileType } from '../types/ext_file_types';
import { LazyFile } from '../types/abstract_file';
import { MMapFile } from './memory_mapped_file';
import { logger } from './logger';
import JSON5 from 'json5';
import crypto from 'crypto';
import { extensionUtils } from './extension_utils';

/**
 * Finds all unpacked extensions given a path. Can be pointed to a single extension directory or a directory containing multiple extensions.
 * @param{string} ext_path to extension(s) - must be unpacked (no .crx files)
 * @returns{Extension} list of extensions that it found
 */
export function find_extensions(ext_path: string, includes_mv3: boolean = false): Extension[] {
    // Convert to absolute path to avoid relative path issues
    const pth = path.resolve(ext_path);

    // Check if path exists first
    if (!existsSync(pth)) {
        logger.error(null, `Extension path does not exist: ${pth}`);
        return [];
    }

    // Only work with directories (unpacked extensions)
    if (lstatSync(pth).isDirectory()) {
        // Check if this directory contains a manifest.json (single extension)
        const manifestPath = path.join(pth, 'manifest.json');

        if (existsSync(manifestPath)) {
            // Single unpacked extension directory
            return get_manifest([manifestPath], includes_mv3);
        } else {
            // Directory containing multiple extension directories - search recursively
            return findExtensionsRecursively(pth, includes_mv3);
        }
    } else if (lstatSync(pth).isFile()) {
        logger.error(
            null,
            `File paths are not supported. Please provide a directory path to unpacked extension(s): ${pth}`,
            {
                file: pth,
                file_type: path.extname(pth),
            }
        );
        return [];
    }

    return [];
}

/**
 * Checks if a manifest represents a Chrome App (deprecated)
 * Chrome Apps have an "app" key in their manifest and are no longer supported
 * @param{any} manifest - The parsed manifest object
 * @returns{boolean} true if this is a Chrome App, false otherwise
 */
function isChromeApp(manifest: any): boolean {
    return !!(manifest && typeof manifest === 'object' && 'app' in manifest);
}

/**
 * Loads and parses all the manifest.jsons given a list of paths
 * @param{string[]} manifest_paths
 * @returns{Extension[]} list of extensions
 */
function get_manifest(manifest_paths: string[], includes_mv3: boolean): Extension[] {
    const extensions: Extension[] = [];
    for (const manifestPath of manifest_paths) {
        let manifestMMapFile: MMapFile | undefined;
        try {
            // Read manifest using memory mapping
            manifestMMapFile = new MMapFile(manifestPath);
            const manifestContent = manifestMMapFile.getContent();

            const json = JSON5.parse(manifestContent) as any;
            
            // Skip Chrome Apps - they are deprecated and cannot be migrated
            if (isChromeApp(json)) {
                logger.info(null, `Skipping Chrome App (deprecated): ${json['name'] || 'Unknown'}`, {
                    manifest_path: manifestPath,
                });
                continue;
            }
            
            if (json['manifest_version'] == 2 || includes_mv3) {
                // logger.info(`Found valid Manifest V2 extension: ${json["name"] || 'Unknown'}`);
                const extensionDir = path.dirname(manifestPath);
                let extensionName: string = json['name'];

                // Handle __MSG_name__ pattern
                if (extensionName.includes('__MSG')) {
                    extensionName = getLocalizedMessage(extensionDir, 'name');
                }

                const files = discoverExtensionFiles(extensionDir);
                // logger.info(`Discovered ${files.length} files in extension: ${extensionName}`);

                const id = getExtensionID(extensionDir); //id gets set in the ChromeTeste class

                if (!id) {
                    logger.error(undefined, 'Error getting extension id while searching', {
                        manifest_v2_path: manifestPath,
                        manifest_content: manifestContent,
                        extension_dir: extensionDir,
                    });
                    return [];
                }

                const extension: Extension = {
                    id: id,
                    name: extensionName,
                    manifest_v2_path: extensionDir,
                    manifest: json,
                    files: files,
                    isNewTabExtension: extensionUtils.isNewTabExtension({ manifest: json } as Extension),
                };

                extensions.push(extension);
            }
        } catch (error) {
            logger.error(null, `Error processing manifest file: ${manifestPath}`, {
                error: (error as any).message,
                manifest_v2_path: manifestPath,
            });
        } finally {
            // Ensure file descriptor is always closed
            if (manifestMMapFile) {
                manifestMMapFile.close();
            }
        }
    }
    return extensions;
}

/**
 * Generates the extension id given a path to the manifest.json
 * @param{string} manifest_path
 * @returns{string} id of the extension
 */
function getExtensionID(manifest_path: string): string | undefined {
    try {
        // Extension ID is derived from the extension's path or key
        // For unpacked extensions, you can generate it from the path
        const extensionId = crypto
            .createHash('sha256')
            .update(manifest_path)
            .digest('hex')
            .substring(0, 32)
            .replace(/./g, (c: any) => String.fromCharCode(97 + (parseInt(c, 16) % 26)));

        return extensionId;
    } catch (error) {
        logger.error(null, `Failed to get extension ID: ${error}`, {
            manifest_v2_path: manifest_path,
            error: error,
        });
        return undefined;
    }
}

/**
 * Gets a localized message from the _locales directory
 * @param{string} extensionDir - The extension directory path
 * @param{string} messageKey - The message key to look up (e.g., "name")
 * @returns{string} The localized message or the original key if not found
 */
function getLocalizedMessage(extensionDir: string, messageKey: string): string {
    const localesDir = path.join(extensionDir, '_locales');

    // Try en_US first, then en as fallback
    const localeOptions = ['en_US', 'en'];

    for (const locale of localeOptions) {
        const messagesPath = path.join(localesDir, locale, 'messages.json');

        if (existsSync(messagesPath)) {
            let messagesMMapFile: MMapFile | undefined;
            try {
                // Read messages using memory mapping
                messagesMMapFile = new MMapFile(messagesPath);
                const messagesContent = messagesMMapFile.getContent();
                // Remove byte order mark (BOM)
                const cleanContent = messagesContent.replace(/^\uFEFF/, '');
                const messages = JSON.parse(cleanContent);

                if (messages[messageKey] && messages[messageKey].message) {
                    return messages[messageKey].message;
                }
            } catch (error) {
                logger.warn(null, `Failed to parse localization file: ${messagesPath}`, {
                    error: error,
                    messages_path: messagesPath,
                });
            } finally {
                // Ensure file descriptor is always closed
                if (messagesMMapFile) {
                    messagesMMapFile.close();
                }
            }
        }
    }

    // If no localized message found, return the original key
    return `${messageKey}`;
}

/**
 * Discovers all files in an extension directory and creates AbstractFile objects
 * @param extensionDir The extension directory path
 * @returns Array of AbstractFile objects
 */
function discoverExtensionFiles(extensionDir: string): LazyFile[] {
    const files: LazyFile[] = [];

    function scanDirectory(dirPath: string) {
        try {
            const items = readdirSync(dirPath);

            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stats = lstatSync(itemPath);

                if (stats.isDirectory()) {
                    // Recursively scan subdirectories
                    scanDirectory(itemPath);
                } else if (stats.isFile()) {
                    // Skip very small files that are unlikely to contain meaningful code
                    if (stats.size < 10) {
                        continue;
                    }

                    const fileName = path.basename(itemPath).toLowerCase();

                    // Skip common non-essential files for faster processing
                    // IMPORTANT: Skip manifest.json as it's handled separately in extension.manifest
                    const skipFiles = [
                        '.ds_store',
                        'thumbs.db',
                        '.gitignore',
                        'readme.md',
                        'license',
                        'changelog.md',
                        'manifest.json',
                    ];
                    if (skipFiles.includes(fileName)) {
                        continue;
                    }

                    const fileType = getFileType(itemPath);
                    const relativePath = path.relative(extensionDir, itemPath);

                    // Create lazy file that will only parse AST when requested
                    files.push(new LazyFile(relativePath, itemPath, fileType));
                }
            }
        } catch (error) {
            logger.error(null, `Failed to scan directory: ${dirPath}`, {
                error: error,
                dir_path: dirPath,
            });
        }
    }

    scanDirectory(extensionDir);
    return files;
}

/**
 * Determines the file type based on file extension
 * @param filePath The file path
 * @returns ExtFileType enum value
 */
function getFileType(filePath: string): ExtFileType {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
        case '.js':
            return ExtFileType.JS;
        case '.css':
            return ExtFileType.CSS;
        case '.html':
        case '.htm':
            return ExtFileType.HTML;
        default:
            return ExtFileType.OTHER;
    }
}

function findExtensionsRecursively(dirPath: string, includes_mv3: boolean): Extension[] {
    const extensions: Extension[] = [];

    try {
        const items = readdirSync(dirPath);

        for (const item of items) {
            const itemPath = path.join(dirPath, item);

            if (lstatSync(itemPath).isDirectory()) {
                const manifestPath = path.join(itemPath, 'manifest.json');

                if (existsSync(manifestPath)) {
                    // Found an unpacked extension directory
                    extensions.push(...get_manifest([manifestPath], includes_mv3));
                } else {
                    // Recursively search subdirectories for more extension directories
                    extensions.push(...findExtensionsRecursively(itemPath, includes_mv3));
                }
            }
            // Note: Files are ignored - only looking for unpacked extension directories
        }
    } catch (error) {
        logger.error(null, `Failed to read directory during recursive search: ${dirPath}`, {
            error: error,
            dir_path: dirPath,
        });
    }

    return extensions;
}
