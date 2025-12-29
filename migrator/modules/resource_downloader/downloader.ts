import * as fs from 'fs-extra';
import * as path from 'path';
import { execSync } from 'child_process';
import { Extension } from '../../types/extension';
import { logger } from '../../utils/logger';
import { globals } from '../../index';
import { RemoteResource, DownloadResult, USER_AGENT, TIMEOUT_MS, MAX_FILE_SIZE } from './types';
import { inferContentType } from './path-generator';

/**
 * Downloads multiple resources for an extension
 */
export function downloadResources(
    extension: Extension,
    resources: RemoteResource[]
): DownloadResult[] {
    const results: DownloadResult[] = [];

    for (const resource of resources) {
        try {
            const result = downloadSingleResource(extension, resource);
            results.push(result);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(
                extension,
                `Failed to download resource: ${resource.url}: ${errorMessage}`,
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
            results.push({
                success: false,
                url: resource.url,
                error: errorMessage,
            });
        }
    }

    return results;
}

/**
 * Downloads a resource synchronously
 */
export function downloadSingleResource(
    extension: Extension,
    resource: RemoteResource
): DownloadResult {
    if (!extension.mv3_extension_id) {
        return {
            success: false,
            url: resource.url,
            error: 'Extension mv3_extension_id is required',
        };
    }
    const outputPath = path.join(globals.outputDir, extension.mv3_extension_id, resource.localPath);

    // Ensure directory exists
    fs.ensureDirSync(path.dirname(outputPath));

    try {
        const downloadedData = downloadFileSync(resource.url);

        fs.writeFileSync(outputPath, downloadedData.content);

        logger.debug(extension, `Downloaded: ${resource.url} -> ${resource.localPath}`);

        return {
            success: true,
            url: resource.url,
            localPath: resource.localPath,
            contentType: downloadedData.contentType || inferContentType(resource.url),
            size: downloadedData.content.length,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(extension, `Failed to download resource: ${resource.url}: ${errorMessage}`, {
            error:
                error instanceof Error
                    ? {
                          message: error.message,
                          stack: error.stack,
                          name: error.name,
                      }
                    : String(error),
        });
        return {
            success: false,
            url: resource.url,
            error: errorMessage,
        };
    }
}

/**
 * Downloads a file using curl
 */
export function downloadFileSync(url: string): {
    content: Buffer;
    contentType?: string;
} {
    try {
        // Use curl for synchronous download with timeout and size limits
        const os = require('os');
        const tempFile = path.join(
            os.tmpdir(),
            `download_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
        );

        const curlCommand = [
            'curl',
            '-s', // Silent mode
            '-L', // Follow redirects
            '-f', // Fail on HTTP errors
            `--max-time ${Math.ceil(TIMEOUT_MS / 1000)}`, // Timeout in seconds
            `--max-filesize ${MAX_FILE_SIZE}`, // Max file size
            '-H',
            `"User-Agent: ${USER_AGENT}"`,
            '-H',
            '"Accept: */*"',
            '-o',
            tempFile, // Output to temp file
            `"${url}"`,
        ].join(' ');

        const result = execSync(curlCommand, {
            stdio: 'pipe',
            timeout: TIMEOUT_MS + 5000, // Extra 5s buffer
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
        const contentType = inferContentType(url);

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
