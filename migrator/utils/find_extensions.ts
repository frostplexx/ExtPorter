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
import { findAndParseCWSInfo } from './cws_parser';

/**
 * Options for extension discovery
 */
export interface FindExtensionsOptions {
    includes_mv3?: boolean;
    /** Set of extension IDs to skip (for resume functionality) - checked BEFORE creating Extension objects */
    skipIds?: Set<string>;
    /** Callback to report skipped extension count */
    onSkip?: (id: string) => void;
}

/**
 * Finds all unpacked extensions given a path. Can be pointed to a single extension directory or a directory containing multiple extensions.
 * @param{string} ext_path to extension(s) - must be unpacked (no .crx files)
 * @returns{Extension} list of extensions that it found
 * @deprecated Use find_extensions_iterator for better memory efficiency with large extension sets
 */
export function find_extensions(ext_path: string, includes_mv3: boolean = false): Extension[] {
    return [...find_extensions_iterator(ext_path, includes_mv3)];
}

/**
 * Memory-efficient iterator that yields extensions one at a time.
 * Use this instead of find_extensions() when processing large numbers of extensions.
 * @param{string} ext_path to extension(s) - must be unpacked (no .crx files)
 * @param{boolean | FindExtensionsOptions} optionsOrIncludesMv3 - options or legacy includes_mv3 boolean
 * @yields{Extension} extensions found one at a time
 */
export function* find_extensions_iterator(
    ext_path: string,
    optionsOrIncludesMv3: boolean | FindExtensionsOptions = false
): Generator<Extension> {
    // Support legacy boolean argument
    const options: FindExtensionsOptions = typeof optionsOrIncludesMv3 === 'boolean'
        ? { includes_mv3: optionsOrIncludesMv3 }
        : optionsOrIncludesMv3;

    const includes_mv3 = options.includes_mv3 ?? false;

    // Convert to absolute path to avoid relative path issues
    const pth = path.resolve(ext_path);

    // Check if path exists first
    if (!existsSync(pth)) {
        logger.error(null, `Extension path does not exist: ${pth}`);
        return;
    }

    // Only work with directories (unpacked extensions)
    if (lstatSync(pth).isDirectory()) {
        // Check if this directory contains a `manifest.json` (single extension)
        const manifestPath = path.join(pth, 'manifest.json');

        if (existsSync(manifestPath)) {
            // Single unpacked extension directory
            const ext = get_single_extension(manifestPath, includes_mv3, options.skipIds, options.onSkip);
            if (ext) yield ext;
        } else {
            // Directory containing multiple extension directories - search recursively
            yield* findExtensionsRecursivelyIterator(pth, includes_mv3, options.skipIds, options.onSkip);
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
        return;
    }
}

/**
 * Counts the total number of extensions without loading them into memory.
 * Useful for progress tracking without memory overhead.
 */
export function count_extensions(ext_path: string, includes_mv3: boolean = false): number {
    const pth = path.resolve(ext_path);

    if (!existsSync(pth) || !lstatSync(pth).isDirectory()) {
        return 0;
    }

    const manifestPath = path.join(pth, 'manifest.json');
    if (existsSync(manifestPath)) {
        return 1;
    }

    return countExtensionsRecursively(pth, includes_mv3);
}

function countExtensionsRecursively(dirPath: string, includes_mv3: boolean): number {
    let count = 0;
    try {
        const items = readdirSync(dirPath);
        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            if (lstatSync(itemPath).isDirectory()) {
                const manifestPath = path.join(itemPath, 'manifest.json');
                if (existsSync(manifestPath)) {
                    // Quick check if it's a valid MV2 extension (or MV3 if included)
                    if (isValidExtensionManifest(manifestPath, includes_mv3)) {
                        count++;
                    }
                } else {
                    count += countExtensionsRecursively(itemPath, includes_mv3);
                }
            }
        }
    } catch {
        // Ignore errors during counting
    }
    return count;
}

function isValidExtensionManifest(manifestPath: string, includes_mv3: boolean): boolean {
    let manifestMMapFile: MMapFile | undefined;
    try {
        manifestMMapFile = new MMapFile(manifestPath);
        const json = JSON5.parse(manifestMMapFile.getContent());
        if (isChromeApp(json) || isThemeExtension(json)) {
            return false;
        }
        return json['manifest_version'] === 2 || includes_mv3;
    } catch {
        return false;
    } finally {
        manifestMMapFile?.close();
    }
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
 * Checks if a manifest represents a theme extension
 * Theme extensions have a "theme" key in their manifest and only contain visual customizations
 * They do not contain executable code and cannot be migrated to MV3
 * @param{any} manifest - The parsed manifest object
 * @returns{boolean} true if this is a theme extension, false otherwise
 */
function isThemeExtension(manifest: any): boolean {
    return !!(manifest && typeof manifest === 'object' && 'theme' in manifest);
}

/**
 * Parses a single manifest and returns the extension, or null if invalid
 */
function get_single_extension(manifestPath: string, includes_mv3: boolean): Extension | null {
    let manifestMMapFile: MMapFile | undefined;
    try {
        // Read manifest using memory mapping
        manifestMMapFile = new MMapFile(manifestPath);
        const manifestContent = manifestMMapFile.getContent();

        const json = JSON5.parse(manifestContent) as any;

        // Skip Chrome Apps - they are deprecated and cannot be migrated
        if (isChromeApp(json)) {
            logger.debug(
                null,
                `Skipping Chrome App (deprecated): ${json['name'] || 'Unknown'}`,
                {
                    manifest_path: manifestPath,
                }
            );
            return null;
        }

        // Skip theme extensions - they only contain visual customizations and no executable code
        if (isThemeExtension(json)) {
            logger.debug(null, `Skipping theme extension: ${json['name'] || 'Unknown'}`, {
                manifest_path: manifestPath,
            });
            return null;
        }

        if (json['manifest_version'] == 2 || includes_mv3) {
            const extensionDir = path.dirname(manifestPath);
            let extensionName: string = json['name'];

            // Handle __MSG_name__ pattern
            if (extensionName && extensionName.includes('__MSG')) {
                extensionName = getLocalizedMessage(extensionDir, 'name');
            }

            const files = discoverExtensionFiles(extensionDir);

            const id = getExtensionID(extensionDir);

            if (!id) {
                logger.error(undefined, 'Error getting extension id while searching', {
                    manifest_v2_path: manifestPath,
                    manifest_content: manifestContent,
                    extension_dir: extensionDir,
                });
                return null;
            }

            // Parse CWS information from HTML file if available
            const cwsInfo = findAndParseCWSInfo(extensionDir);

            const extension: Extension = {
                id: id,
                name: extensionName,
                version: json['version'] || cwsInfo?.details.version,
                manifest_v2_path: extensionDir,
                manifest: json,
                files: files,
                isNewTabExtension: extensionUtils.isNewTabExtension({
                    manifest: json,
                } as Extension),
                cws_info: cwsInfo || undefined,
            };

            return extension;
        }
        return null;
    } catch (error) {
        logger.error(null, `Error processing manifest file: ${manifestPath}`, {
            error: (error as any).message,
            manifest_v2_path: manifestPath,
        });
        return null;
    } finally {
        // Ensure file descriptor is always closed
        if (manifestMMapFile) {
            manifestMMapFile.close();
        }
    }
}

/**
 * Loads and parses all the `manifest.json` files given a list of paths
 * @param{string[]} manifest_paths
 * @returns{Extension[]} list of extensions
 * @deprecated Use get_single_extension with the iterator pattern instead
 */
/**
 * Generates the extension id given a path to the `manifest.json`
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

/**
 * Iterator version that yields extensions one at a time instead of collecting them all
 */
function* findExtensionsRecursivelyIterator(dirPath: string, includes_mv3: boolean): Generator<Extension> {
    try {
        const items = readdirSync(dirPath);

        for (const item of items) {
            const itemPath = path.join(dirPath, item);

            if (lstatSync(itemPath).isDirectory()) {
                const manifestPath = path.join(itemPath, 'manifest.json');

                if (existsSync(manifestPath)) {
                    // Found an unpacked extension directory - yield it directly
                    const ext = get_single_extension(manifestPath, includes_mv3);
                    if (ext) yield ext;
                } else {
                    // Recursively search subdirectories for more extension directories
                    yield* findExtensionsRecursivelyIterator(itemPath, includes_mv3);
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
}

/**
 * Generates the extension id given a path to the `manifest.json`
 * @param{string} manifest_path
 * @returns{string} id of the extension
 */
