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
