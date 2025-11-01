/**
 * Types for fakeium-based extension testing
 */

import { Event as FakeiumEvent } from 'fakeium';

/**
 * Represents a captured API call during extension execution
 */
export interface ApiCall {
    /** The API path (e.g., 'chrome.runtime.sendMessage') */
    path: string;
    /** The type of event (GetEvent, CallEvent, etc.) */
    type: 'GetEvent' | 'CallEvent' | 'SetEvent';
    /** Arguments passed to the call (for CallEvent) */
    arguments?: any[];
    /** Return value or result */
    returns?: any;
    /** Whether this was a constructor call */
    isConstructor?: boolean;
    /** Location in source code */
    location?: {
        filename: string;
        line: number;
        column: number;
    };
}

/**
 * Represents the behavior of an extension version (MV2 or MV3)
 */
export interface ExtensionBehavior {
    /** Manifest version */
    manifestVersion: 2 | 3;
    /** Extension ID */
    extensionId: string;
    /** Extension name */
    extensionName: string;
    /** All captured API calls */
    apiCalls: ApiCall[];
    /** Execution errors */
    errors: string[];
    /** Execution duration in ms */
    duration: number;
}

/**
 * Comparison result between MV2 and MV3 behaviors
 */
export interface BehaviorComparison {
    /** Whether behaviors are equivalent */
    isEquivalent: boolean;
    /** API calls only in MV2 version */
    mv2Only: ApiCall[];
    /** API calls only in MV3 version */
    mv3Only: ApiCall[];
    /** API calls in both (matched) */
    matched: Array<{ mv2: ApiCall; mv3: ApiCall }>;
    /** Semantic differences found */
    differences: string[];
    /** Overall similarity score (0-1) */
    similarityScore: number;
}

/**
 * Options for running extension in fakeium
 */
export interface FakeiumRunOptions {
    /** Maximum execution time in ms */
    timeout?: number;
    /** Maximum memory usage in MB */
    maxMemory?: number;
    /** Whether to enable detailed logging */
    verbose?: boolean;
    /** Custom origin for the sandbox */
    origin?: string;
    /** Source type (script or module) */
    sourceType?: 'script' | 'module';
}

/**
 * Result of running an extension in fakeium
 */
export interface FakeiumRunResult {
    /** Captured behavior */
    behavior: ExtensionBehavior;
    /** Raw fakeium report events */
    rawEvents: any[];
    /** Whether execution completed successfully */
    success: boolean;
}
