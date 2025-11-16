import { LazyFile } from '../../types/abstract_file';
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
 * Creates a LazyFile instance for the bridge file.
 */
export function createBridgeFile(bridgeFilename: string): LazyFile {
    const bridgeContent = loadBridgeContent();

    // Create a LazyFile-like object for the bridge
    const bridgeFile = Object.create(LazyFile.prototype);
    bridgeFile.path = bridgeFilename;
    bridgeFile.filetype = ExtFileType.JS;
    bridgeFile._bridgeContent = bridgeContent;

    // Override methods to work with bridge content
    bridgeFile.getContent = () => bridgeContent;
    bridgeFile.getSize = () => Buffer.byteLength(bridgeContent, 'utf8');
    bridgeFile.close = () => {
        /* No-op for in-memory content */
    };
    bridgeFile.getAST = () => {
        // Bridge file doesn't need AST parsing
        return undefined;
    };

    return bridgeFile;
}
