import { MigrationModule, MigrationError } from '../types/migration_module';
import { Extension } from '../types/extension';
import { LazyFile } from '../types/abstract_file';
import { ExtFileType } from '../types/ext_file_types';
import { logger } from '../utils/logger';
import { FileContentUpdater } from '../utils/file_content_updater';
import { globals } from '../index';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

export interface RemoteResource {
    url: string;
    localPath: string;
    contentType?: string;
    size?: number;
}

export interface DownloadResult {
    success: boolean;
    url: string;
    localPath?: string;
    error?: string;
    contentType?: string;
    size?: number;
}

export class ResourceDownloader extends MigrationModule {
    private static readonly USER_AGENT =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    private static readonly TIMEOUT_MS = 10000; // 10 seconds
    private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

    // Common CDN and resource patterns
    private static readonly URL_PATTERNS = [
        // Google Fonts
        /https:\/\/fonts\.googleapis\.com\/css[^"'\s]*/g,
        /https:\/\/fonts\.gstatic\.com\/[^"'\s]*/g,

        // Popular CDNs
        /https:\/\/cdn\.jsdelivr\.net\/[^"'\s]*/g,
        /https:\/\/unpkg\.com\/[^"'\s]*/g,
        /https:\/\/cdnjs\.cloudflare\.com\/[^"'\s]*/g,
        /https:\/\/stackpath\.bootstrapcdn\.com\/[^"'\s]*/g,

        // Google APIs
        /https:\/\/[^/]*\.googleapis\.com\/[^"'\s]*/g,

        // Generic HTTPS resources
        /https:\/\/[^/\s"']+\.[^/\s"']+\/[^"'\s]*\.(js|css|woff|woff2|ttf|eot|svg|png|jpg|jpeg|gif|ico)(?:[?#][^"'\s]*)?/gi,
    ];

    public static migrate(extension: Extension): Extension | MigrationError {
        try {
            // Check for null/invalid extension or manifest
            if (!extension || !extension.manifest) {
                throw new Error('Extension or manifest is null/undefined');
            }

            logger.info(extension, 'Starting remote resource download');

            // Close all file descriptors before downloading to prevent EBADF errors
            // This is necessary because downloading uses execSync which needs file descriptors
            logger.debug(extension, 'Closing file descriptors before download');
            extension.files.forEach(file => {
                try {
                    file.close();
                } catch (error) {
                    // Ignore errors when closing files
                }
            });

            const downloader = new ResourceDownloader();
            const result = downloader.processExtension(extension);

            logger.info(extension, `Remote resource download completed`);
            return result;
        } catch (error) {
            logger.error(extension, 'Failed to download remote resources', { error });
            return new MigrationError(extension, error);
        }
    }

    private processExtension(extension: Extension): Extension {
        const remoteResources = this.findRemoteResources(extension);

        if (remoteResources.length === 0) {
            logger.info(extension, 'No remote resources found to download');
            return extension;
        }

        logger.info(
            extension,
            `Found ${remoteResources.length} remote resources to download: ${remoteResources.map((r) => r.url).join(', ')}`
        );

        // Create a copy of the extension to avoid mutating the original
        const extensionCopy: Extension = {
            id: extension.id,
            name: extension.name,
            mv3_extension_id: extension.mv3_extension_id,
            manifest_v2_path: extension.manifest_v2_path,
            manifest: { ...extension.manifest },
            files: [...extension.files], // Shallow copy of files array
        };

        const downloadResults = this.downloadResources(extensionCopy, remoteResources);
        const updatedExtension = this.updateReferencesToLocal(extensionCopy, downloadResults);

        const successCount = downloadResults.filter((r) => r.success).length;
        logger.info(
            extension,
            `Downloaded ${successCount}/${downloadResults.length} remote resources`
        );

        return updatedExtension;
    }

    private findRemoteResources(extension: Extension): RemoteResource[] {
        const resources = new Set<string>();

        // Search in manifest
        this.extractUrlsFromObject(extension.manifest, resources);

        // Search in all files
        extension.files.forEach((file) => {
            if (
                file.filetype === ExtFileType.JS ||
                file.filetype === ExtFileType.CSS ||
                file.filetype === ExtFileType.HTML ||
                file.filetype === ExtFileType.OTHER
            ) {
                const content = file.getContent();
                this.extractUrlsFromContent(content, resources);
            }
        });

        return Array.from(resources).map((url) => ({
            url,
            localPath: this.generateLocalPath(url),
        }));
    }

    private extractUrlsFromObject(obj: any, resources: Set<string>): void {
        if (!obj) return;

        if (typeof obj === 'string') {
            this.extractUrlsFromContent(obj, resources);
        } else if (Array.isArray(obj)) {
            obj.forEach((item) => this.extractUrlsFromObject(item, resources));
        } else if (typeof obj === 'object') {
            Object.values(obj).forEach((value) => this.extractUrlsFromObject(value, resources));
        }
    }

    private extractUrlsFromContent(content: string, resources: Set<string>): void {
        ResourceDownloader.URL_PATTERNS.forEach((pattern) => {
            const matches = content.match(pattern);
            if (matches) {
                matches.forEach((url) => {
                    // Clean up URL (remove quotes, trailing punctuation, etc.)
                    let cleanUrl = url.replace(/['"]/g, '').trim();
                    // Remove trailing semicolons, commas, and other punctuation
                    cleanUrl = cleanUrl.replace(/[;,)}\]]+$/, '');
                    if (this.isValidResourceUrl(cleanUrl)) {
                        resources.add(cleanUrl);
                    }
                });
            }
        });
    }

    private isValidResourceUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            return (
                parsed.protocol === 'https:' &&
                !url.includes('localhost') &&
                !url.includes('127.0.0.1') &&
                !url.includes('example.com')
            );
        } catch {
            return false;
        }
    }

    private generateLocalPath(url: string): string {
        const parsed = new URL(url);
        const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);

        let filename = path.basename(parsed.pathname) || 'index';
        const extension = path.extname(filename);

        if (!extension) {
            // Determine extension from URL or content-type
            if (url.includes('googleapis.com/css') || url.includes('fonts.googleapis.com')) {
                filename += '.css';
            } else if (url.includes('.js')) {
                filename += '.js';
            } else {
                filename += '.txt';
            }
        }

        // Generate path without hostname to avoid domain names in the final path
        return `remote_resources/${hash}_${filename}`;
    }

    private downloadResources(extension: Extension, resources: RemoteResource[]): DownloadResult[] {
        const results: DownloadResult[] = [];

        for (const resource of resources) {
            try {
                const result = this.downloadSingleResource(extension, resource);
                results.push(result);

                if (result.success && result.localPath) {
                    // Add downloaded file to extension
                    this.addDownloadedFileToExtension(extension, result.localPath, resource.url);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn(
                    extension,
                    `Failed to download resource: ${resource.url}: ${errorMessage}`,
                    {
                        error: error instanceof Error ? {
                            message: error.message,
                            stack: error.stack,
                            name: error.name
                        } : String(error)
                    }
                );
                results.push({
                    success: false,
                    url: resource.url,
                    error: errorMessage,
                });
            }
        }

        return results;
    }

    private downloadSingleResource(extension: Extension, resource: RemoteResource): DownloadResult {
        logger.debug(extension, `Downloading resource: ${resource.url}`);

        try {
            return this.downloadResourceSync(extension, resource);
        } catch (error) {
            return {
                success: false,
                url: resource.url,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private downloadResourceSync(extension: Extension, resource: RemoteResource): DownloadResult {
        if (!extension.mv3_extension_id) {
            return {
                success: false,
                url: resource.url,
                error: 'Extension mv3_extension_id is required',
            };
        }
        const outputPath = path.join(
            globals.outputDir,
            extension.mv3_extension_id,
            resource.localPath
        );

        // Ensure directory exists
        fs.ensureDirSync(path.dirname(outputPath));

        try {
            const downloadedData = this.downloadFileSync(resource.url);

            fs.writeFileSync(outputPath, downloadedData.content);

            logger.debug(extension, `Downloaded: ${resource.url} -> ${resource.localPath}`);

            return {
                success: true,
                url: resource.url,
                localPath: resource.localPath,
                contentType: downloadedData.contentType || this.inferContentType(resource.url),
                size: downloadedData.content.length,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(
                extension,
                `Failed to download resource: ${resource.url}: ${errorMessage}`,
                {
                    error: error instanceof Error ? {
                        message: error.message,
                        stack: error.stack,
                        name: error.name
                    } : String(error)
                }
            );
            return {
                success: false,
                url: resource.url,
                error: errorMessage,
            };
        }
    }

    private downloadFileSync(url: string): {
        content: Buffer;
        contentType?: string;
    } {
        try {
            // Use curl for synchronous download with timeout and size limits
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const os = require('os');
            const tempFile = path.join(
                os.tmpdir(),
                `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            );

            const curlCommand = [
                'curl',
                '-s', // Silent mode
                '-L', // Follow redirects
                '-f', // Fail on HTTP errors
                `--max-time ${Math.ceil(ResourceDownloader.TIMEOUT_MS / 1000)}`, // Timeout in seconds
                `--max-filesize ${ResourceDownloader.MAX_FILE_SIZE}`, // Max file size
                '-H',
                `"User-Agent: ${ResourceDownloader.USER_AGENT}"`,
                '-H',
                '"Accept: */*"',
                '-o',
                tempFile, // Output to temp file
                `"${url}"`,
            ].join(' ');

            const result = execSync(curlCommand, {
                stdio: 'pipe',
                timeout: ResourceDownloader.TIMEOUT_MS + 5000, // Extra 5s buffer
                encoding: 'utf8',
            });

            // Check if temp file was created
            if (!fs.existsSync(tempFile)) {
                throw new Error(`Curl completed but temp file was not created. Curl output: ${result}`);
            }

            // Read the downloaded content
            const content = fs.readFileSync(tempFile);

            // Clean up temp file
            fs.unlinkSync(tempFile);

            // Verify we got actual content
            if (content.length === 0) {
                throw new Error('Downloaded file is empty');
            }

            // Try to determine content type from URL
            const contentType = this.inferContentType(url);

            return { content, contentType };
        } catch (error) {
            // Include curl exit code and stderr if available
            const errorDetails = error instanceof Error ? error.message : String(error);
            const exitCode = (error as any).status || (error as any).code;
            const stderr = (error as any).stderr?.toString() || '';

            throw new Error(
                `Failed to download ${url}: ${errorDetails}${exitCode ? ` (exit code: ${exitCode})` : ''}${stderr ? ` - ${stderr}` : ''}`
            );
        }
    }

    private inferContentType(url: string): string {
        const fileExt = path.extname(new URL(url).pathname).toLowerCase();

        switch (fileExt) {
            case '.css':
                return 'text/css';
            case '.js':
                return 'application/javascript';
            case '.json':
                return 'application/json';
            case '.woff':
            case '.woff2':
                return 'font/woff';
            case '.ttf':
                return 'font/ttf';
            case '.eot':
                return 'application/vnd.ms-fontobject';
            case '.svg':
                return 'image/svg+xml';
            case '.png':
                return 'image/png';
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            case '.gif':
                return 'image/gif';
            default:
                return 'application/octet-stream';
        }
    }

    private addDownloadedFileToExtension(
        extension: Extension,
        localPath: string,
        originalUrl: string
    ): void {
        // Determine file type from URL and extension
        const fileExtension = path.extname(localPath).toLowerCase();
        let fileType = ExtFileType.OTHER;

        // Check file extension first
        switch (fileExtension) {
            case '.js':
                fileType = ExtFileType.JS;
                break;
            case '.css':
                fileType = ExtFileType.CSS;
                break;
            case '.html':
            case '.htm':
                fileType = ExtFileType.HTML;
                break;
            default:
                // For files without extensions, infer from URL
                if (
                    originalUrl.includes('googleapis.com/css') ||
                    originalUrl.includes('fonts.googleapis.com')
                ) {
                    fileType = ExtFileType.CSS;
                } else if (originalUrl.includes('.js') || originalUrl.includes('javascript')) {
                    fileType = ExtFileType.JS;
                } else {
                    fileType = ExtFileType.OTHER;
                }
        }

        // Create a LazyFile for the downloaded resource and add it to the extension
        const absolutePath = path.join(globals.outputDir, extension.mv3_extension_id!, localPath);
        const downloadedFile = new LazyFile(localPath, absolutePath, fileType);

        extension.files.push(downloadedFile);

        logger.debug(
            extension,
            `Added downloaded file to extension: ${localPath} (from ${originalUrl})`
        );
    }

    private updateReferencesToLocal(
        extension: Extension,
        downloadResults: DownloadResult[]
    ): Extension {
        const urlMapping = new Map<string, string>();

        // Build mapping of remote URLs to local paths
        downloadResults.forEach((result) => {
            if (result.success && result.localPath) {
                urlMapping.set(result.url, result.localPath);
            }
        });

        if (urlMapping.size === 0) {
            return extension;
        }

        // Update manifest
        extension.manifest = this.replaceUrlsInObject(extension.manifest, urlMapping);

        // Update file contents
        extension.files.forEach((file) => {
            if (
                file.filetype === ExtFileType.JS ||
                file.filetype === ExtFileType.CSS ||
                file.filetype === ExtFileType.HTML ||
                file.filetype === ExtFileType.OTHER
            ) {
                try {
                    const originalContent = file.getContent();
                    const updatedContent = this.replaceUrlsInContent(originalContent, urlMapping);

                    if (originalContent !== updatedContent) {
                        logger.debug(extension, `Updated resource references in: ${file.path}`);

                        // Update the file content using our utility
                        try {
                            FileContentUpdater.updateFileContent(file, updatedContent);
                        } catch (updateError) {
                            logger.warn(
                                extension,
                                `Failed to write updated content to file: ${file.path}: ${updateError instanceof Error ? updateError.message : String(updateError)}`,
                                {
                                    error: updateError instanceof Error ? {
                                        message: updateError.message,
                                        stack: updateError.stack,
                                        name: updateError.name
                                    } : String(updateError)
                                }
                            );
                        }
                    }
                } catch (error) {
                    logger.warn(extension, `Failed to update references in file: ${file.path}`, {
                        error,
                    });
                }
            }
        });

        return extension;
    }

    private replaceUrlsInObject(obj: any, urlMapping: Map<string, string>): any {
        if (!obj) return obj;

        if (typeof obj === 'string') {
            return this.replaceUrlsInContent(obj, urlMapping);
        } else if (Array.isArray(obj)) {
            return obj.map((item) => this.replaceUrlsInObject(item, urlMapping));
        } else if (typeof obj === 'object') {
            const result: any = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.replaceUrlsInObject(value, urlMapping);
            }
            return result;
        }

        return obj;
    }

    private replaceUrlsInContent(content: string, urlMapping: Map<string, string>): string {
        let updatedContent = content;

        urlMapping.forEach((localPath, remoteUrl) => {
            // Replace all occurrences of the remote URL with the local path
            const escapedUrl = remoteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedUrl, 'g');
            updatedContent = updatedContent.replace(regex, localPath);
        });

        return updatedContent;
    }
}
