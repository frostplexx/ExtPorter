import * as espree from 'espree';
import { Extension } from '../../types/extension';
import { LazyFile } from '../../types/abstract_file';
import { logger } from '../../utils/logger';
import { WebRequestUsage } from './types';

/**
 * Transform JavaScript files to comment out migrated webRequest calls
 */
export function transformWebRequestFiles(
    extension: Extension,
    webRequestUsages: WebRequestUsage[]
): LazyFile[] {
    // Group usages by file
    const usagesByFile = new Map<LazyFile, WebRequestUsage[]>();
    for (const usage of webRequestUsages) {
        if (!usagesByFile.has(usage.file)) {
            usagesByFile.set(usage.file, []);
        }
        usagesByFile.get(usage.file)!.push(usage);
    }

    // Transform files that have webRequest usages
    return extension.files.map((file) => {
        const usages = usagesByFile.get(file);
        if (!usages || usages.length === 0) {
            return file; // No changes needed
        }

        // Get original content
        const originalContent = file.getContent();

        // Sort usages by position (descending) to avoid offset issues when modifying
        const sortedUsages = usages.sort((a, b) => {
            const aStart = a.node.range?.[0] || 0;
            const bStart = b.node.range?.[0] || 0;
            return bStart - aStart;
        });

        let modifiedContent = originalContent;

        // Comment out each webRequest usage
        for (const usage of sortedUsages) {
            const node = usage.node;
            if (!node.range) {
                logger.warn(
                    extension,
                    'Cannot comment out webRequest usage - no range information',
                    { file: file.path }
                );
                continue;
            }

            const [start, end] = node.range;
            const beforeCode = modifiedContent.substring(0, start);
            const webRequestCode = modifiedContent.substring(start, end);
            const afterCode = modifiedContent.substring(end);

            // Find the semicolon after the call expression if it exists
            const nextChars = afterCode.trimStart();
            const hasSemicolon = nextChars.startsWith(';');
            const semicolonLength = hasSemicolon ? afterCode.indexOf(';') + 1 : 0;

            // Create commented version with migration notice
            const commentedCode = [
                '/* MIGRATED TO DECLARATIVE_NET_REQUEST - Original code preserved below:',
                ' * This blocking webRequest has been converted to declarativeNetRequest rules.',
                ' * See rules.json for the migrated configuration.',
                ' *',
                ...webRequestCode
                    .split('\n')
                    .map((line) => ` * ${line}`)
                    .map((line) => line.trimEnd()),
                ' */',
            ].join('\n');

            // Reconstruct the file content
            modifiedContent =
                beforeCode +
                commentedCode +
                afterCode.substring(semicolonLength).replace(/^\s*\n/, '\n');
        }

        // Create a new LazyFile with the modified content
        const transformedFile = Object.create(LazyFile.prototype);
        transformedFile.path = file.path;
        transformedFile.filetype = file.filetype;
        transformedFile._transformedContent = modifiedContent;
        transformedFile._absolutePath = (file as any)._absolutePath;

        // Cache buffer for efficient access
        const contentBuffer = Buffer.from(modifiedContent, 'utf8');

        // Override methods to work with transformed content
        transformedFile.getContent = () => modifiedContent;
        transformedFile.getBuffer = () => contentBuffer;
        transformedFile.getSize = () => contentBuffer.length;
        transformedFile.close = () => {
            /* No-op for in-memory content */
        };
        transformedFile.releaseMemory = () => {
            /* No-op for in-memory content */
        };
        transformedFile.cleanContent = () => transformedFile;
        transformedFile.getAST = () => {
            try {
                return espree.parse(modifiedContent, {
                    ecmaVersion: 'latest',
                    sourceType: 'script',
                    loc: true,
                    range: true,
                });
            } catch {
                return undefined;
            }
        };

        // Release memory from original file since we now have transformed content
        if (file.releaseMemory) {
            file.releaseMemory();
        }

        logger.info(extension, `Commented out ${usages.length} webRequest call(s) in ${file.path}`);

        return transformedFile;
    });
}
