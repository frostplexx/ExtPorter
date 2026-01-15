import { AbstractFile, createNewFile } from '../../types/abstract_file';
import { ExtFileType } from '../../types/ext_file_types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads the bridge file content from the templates directory.
 */
export function loadBridgeContent(): string {
    try {
        const bridgePath = path.join(__dirname, '../../templates/ext_bridge.js');
        return fs.readFileSync(bridgePath, 'utf8');
    } catch (error) {
        throw new Error(
            `Failed to load bridge file: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Creates an AbstractFile instance for the bridge file.
 */
export function createBridgeFile(bridgeFilename: string): AbstractFile {
    const bridgeContent = loadBridgeContent();
    return createNewFile(bridgeFilename, bridgeContent, ExtFileType.JS);
}
