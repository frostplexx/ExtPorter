import { AbstractFile } from '../../types/abstract_file';

/**
 * Represents a webRequest API usage found in the code
 */
export interface WebRequestUsage {
    node: any;
    file: AbstractFile;
    eventType: string;
    callback: any;
    filter: any;
    extraInfoSpec: any;
}

/**
 * Result of analyzing a webRequest usage
 */
export interface UsageAnalysis {
    hasDynamicLogic: boolean;
    reason?: string;
}
