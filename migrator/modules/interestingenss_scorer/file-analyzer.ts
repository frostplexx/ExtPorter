import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { logger } from '../../utils/logger';
import { InterestingnessBreakdown } from './scoring-config';

/**
 * Analyzes all extension files for patterns that contribute to interestingness score
 */
export function analyzeFiles(extension: Extension, scores: InterestingnessBreakdown): void {
    let totalHtmlLines = 0;
    let webRequestCount = 0;
    let storageLocalCount = 0;
    let cryptoPatternCount = 0;
    let networkRequestCount = 0;

    for (const file of extension.files) {


        if(file == null){
            logger.error(extension, "File is null")
            break;
        }

        try {
            const content = file.getContent();

            // Count HTML lines
            if (file.filetype === ExtFileType.HTML) {
                totalHtmlLines += content.split('\n').length;
            }

            // Search for patterns in JS files
            if (file.filetype === ExtFileType.JS) {
                // webRequest patterns
                webRequestCount += countPattern(content, /webRequest/g);

                // storage.local patterns
                storageLocalCount += countPattern(content, /storage\.local/g);

                // Crypto/obfuscation patterns
                const cryptoPatterns = [
                    /eval\(/g,
                    /Function\(/g,
                    /btoa\(/g,
                    /atob\(/g,
                    /crypto\./g,
                ];
                cryptoPatternCount += cryptoPatterns.reduce(
                    (sum, pattern) => sum + countPattern(content, pattern),
                    0
                );

                // Network request patterns
                const networkPatterns = [/fetch\(/g, /XMLHttpRequest/g, /\.ajax\(/g];
                networkRequestCount += networkPatterns.reduce(
                    (sum, pattern) => sum + countPattern(content, pattern),
                    0
                );
            }
        } catch (error) {
            logger.debug(extension, `Error analyzing file ${file.path}`, { error });
        }
    }

    scores.html_lines = totalHtmlLines;
    scores.webRequest = webRequestCount;
    scores.storage_local = storageLocalCount;
    scores.crypto_patterns = cryptoPatternCount;
    scores.network_requests = networkRequestCount;
}

/**
 * Counts occurrences of a pattern in content
 */
function countPattern(content: string, pattern: RegExp): number {
    const matches = content.match(pattern);
    return matches ? matches.length : 0;
}
