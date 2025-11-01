import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { TwinningMapping } from '../../types/twinning_mapping';

/**
 * Cached API mappings
 */
let api_mappings: TwinningMapping | null = null;

/**
 * Loads API mappings from the configuration file and writes them into api_mappings
 * @returns The loaded twinning mappings or empty mappings on error
 */
export function loadApiMappings(): TwinningMapping {
    if (api_mappings !== null) {
        return api_mappings;
    }

    try {
        const mappingsPath = path.join(__dirname, '../../templates/api_mappings.json');
        logger.debug(null, 'Loading API mappings', { path: mappingsPath });

        const fileContent = fs.readFileSync(mappingsPath, 'utf8');
        api_mappings = JSON.parse(fileContent);

        logger.debug(null, 'API mappings cached', {
            count: api_mappings!.mappings.length,
        });
    } catch (error) {
        logger.error(null, 'Failed to load API mappings', {
            error: error instanceof Error ? error.message : String(error),
        });
        // Fallback to empty mappings to prevent crashes
        api_mappings = { mappings: [] };
    }

    // At this point cachedApiMappings is guaranteed to not be null
    return api_mappings!;
}

/**
 * Counts potential API transformations in file content using regex patterns.
 * Used to detect how many transformations would have been applied if AST parsing succeeded.
 *
 * @param content File content to analyze
 * @param mappings API transformation mappings
 * @returns Number of potential transformations
 */
export function countPotentialTransformations(content: string, mappings: TwinningMapping): number {
    let count = 0;

    for (const mapping of mappings.mappings) {
        // Extract API pattern from source mapping (remove return/semicolon)
        const sourcePattern = mapping.source.body.replace(/^return\s+/, '').replace(/;$/, '');

        // Create regex pattern to match API usage
        // Handle both function calls and property access
        const apiBase = sourcePattern.replace(/\([^)]*\)$/, ''); // Remove function call parens
        const escapedApi = apiBase.replace(/\./g, '\\.'); // Escape dots for regex

        // Match both property access and function calls
        const functionCallPattern = new RegExp(`\\b${escapedApi}\\s*\\(`, 'g');
        const propertyAccessPattern = new RegExp(`\\b${escapedApi}(?!\\w)`, 'g');

        const functionMatches = content.match(functionCallPattern) || [];
        const propertyMatches = content.match(propertyAccessPattern) || [];

        // Avoid double counting - if we have function calls, don't count property access
        count += functionMatches.length > 0 ? functionMatches.length : propertyMatches.length;
    }

    return count;
}
