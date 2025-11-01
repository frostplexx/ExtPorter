/**
 * BehaviorComparator - Compares MV2 and MV3 extension behaviors
 */

import { ApiCall, BehaviorComparison, ExtensionBehavior } from './types';

/**
 * API mapping table for comparing equivalent MV2 and MV3 calls
 */
const API_EQUIVALENTS: { [mv2Path: string]: string } = {
    // chrome.extension -> chrome.runtime
    'chrome.extension.getURL': 'chrome.runtime.getURL',
    'chrome.extension.connect': 'chrome.runtime.connect',
    'chrome.extension.sendMessage': 'chrome.runtime.sendMessage',
    'chrome.extension.onMessage': 'chrome.runtime.onMessage',
    'chrome.extension.onConnect': 'chrome.runtime.onConnect',

    // chrome.browserAction -> chrome.action
    'chrome.browserAction.setTitle': 'chrome.action.setTitle',
    'chrome.browserAction.setBadgeText': 'chrome.action.setBadgeText',
    'chrome.browserAction.setBadgeBackgroundColor': 'chrome.action.setBadgeBackgroundColor',
    'chrome.browserAction.onClicked': 'chrome.action.onClicked',

    // chrome.pageAction -> chrome.action
    'chrome.pageAction.show': 'chrome.action.show',
    'chrome.pageAction.hide': 'chrome.action.hide',
    'chrome.pageAction.setTitle': 'chrome.action.setTitle',
    'chrome.pageAction.onClicked': 'chrome.action.onClicked',

    // chrome.tabs deprecated events
    'chrome.tabs.onActiveChanged': 'chrome.tabs.onActivated',
    'chrome.tabs.onSelectionChanged': 'chrome.tabs.onActivated',
    'chrome.tabs.onHighlightChanged': 'chrome.tabs.onHighlighted',

    // chrome.tabs deprecated methods (handled specially)
    'chrome.tabs.executeScript': 'chrome.scripting.executeScript',
    'chrome.tabs.getAllInWindow': 'chrome.tabs.query',
    'chrome.tabs.getSelected': 'chrome.tabs.query',
};

export class BehaviorComparator {
    /**
     * Compare MV2 and MV3 behaviors to validate migration
     */
    static compare(mv2Behavior: ExtensionBehavior, mv3Behavior: ExtensionBehavior): BehaviorComparison {
        // Normalize API calls for comparison
        const normalizedMv2 = this.normalizeApiCalls(mv2Behavior.apiCalls, 2);
        const normalizedMv3 = this.normalizeApiCalls(mv3Behavior.apiCalls, 3);

        // Find matched and unmatched calls
        const matched: Array<{ mv2: ApiCall; mv3: ApiCall }> = [];
        const mv2Only: ApiCall[] = [];
        const mv3Only: ApiCall[] = [];

        // Track which MV3 calls have been matched
        const matchedMv3Indices = new Set<number>();

        // Try to match each MV2 call to an equivalent MV3 call
        for (const mv2Call of normalizedMv2) {
            const mv3EquivalentPath = API_EQUIVALENTS[mv2Call.path] || mv2Call.path;

            // Find matching MV3 call
            const mv3Index = normalizedMv3.findIndex((mv3Call, idx) => {
                if (matchedMv3Indices.has(idx)) return false;
                return this.callsAreEquivalent(mv2Call, mv3Call, mv3EquivalentPath);
            });

            if (mv3Index !== -1) {
                matched.push({
                    mv2: mv2Call,
                    mv3: normalizedMv3[mv3Index]
                });
                matchedMv3Indices.add(mv3Index);
            } else {
                mv2Only.push(mv2Call);
            }
        }

        // Find MV3 calls that weren't matched
        normalizedMv3.forEach((mv3Call, idx) => {
            if (!matchedMv3Indices.has(idx)) {
                mv3Only.push(mv3Call);
            }
        });

        // Calculate similarity score
        const totalCalls = normalizedMv2.length + normalizedMv3.length;
        const matchedCount = matched.length * 2; // Each match counts for both sides
        const similarityScore = totalCalls > 0 ? matchedCount / totalCalls : 1.0;

        // Identify semantic differences
        const differences = this.identifyDifferences(mv2Behavior, mv3Behavior, mv2Only, mv3Only);

        // Determine if behaviors are equivalent
        const isEquivalent = this.determinateEquivalence(
            mv2Only,
            mv3Only,
            differences,
            similarityScore
        );

        return {
            isEquivalent,
            mv2Only,
            mv3Only,
            matched,
            differences,
            similarityScore
        };
    }

    /**
     * Normalize API calls for consistent comparison
     */
    private static normalizeApiCalls(calls: ApiCall[], manifestVersion: 2 | 3): ApiCall[] {
        return calls
            .filter(call => call.type === 'CallEvent' || call.type === 'GetEvent')
            .map(call => ({
                ...call,
                // Normalize function vs non-function arguments for comparison
                arguments: call.arguments?.map(arg =>
                    typeof arg === 'function' ? '<function>' : arg
                )
            }));
    }

    /**
     * Check if two API calls are equivalent (accounting for MV2->MV3 transformations)
     */
    private static callsAreEquivalent(
        mv2Call: ApiCall,
        mv3Call: ApiCall,
        expectedMv3Path: string
    ): boolean {
        // Check if paths match (considering API renames)
        if (mv3Call.path !== expectedMv3Path) {
            return false;
        }

        // Check if event types match
        if (mv2Call.type !== mv3Call.type) {
            return false;
        }

        // For GetEvent, just matching paths is enough
        if (mv2Call.type === 'GetEvent') {
            return true;
        }

        // For CallEvent, check argument compatibility
        return this.argumentsAreCompatible(mv2Call, mv3Call);
    }

    /**
     * Check if arguments are compatible between MV2 and MV3 calls
     */
    private static argumentsAreCompatible(mv2Call: ApiCall, mv3Call: ApiCall): boolean {
        const mv2Args = mv2Call.arguments || [];
        const mv3Args = mv3Call.arguments || [];

        // Special handling for transformed APIs
        if (mv2Call.path === 'chrome.tabs.executeScript' && mv3Call.path === 'chrome.scripting.executeScript') {
            // Parameters are restructured, just verify both have arguments
            return mv2Args.length > 0 && mv3Args.length > 0;
        }

        if (mv2Call.path === 'chrome.tabs.getAllInWindow' && mv3Call.path === 'chrome.tabs.query') {
            // getAllInWindow(windowId, callback) -> query({windowId}, callback)
            return mv3Args.length > 0;
        }

        if (mv2Call.path === 'chrome.tabs.getSelected' && mv3Call.path === 'chrome.tabs.query') {
            // getSelected(windowId, callback) -> query({active: true, windowId}, callback)
            return mv3Args.length > 0;
        }

        // For most APIs, argument counts should be similar (allowing for callbacks)
        // We're lenient here because callback handling can differ
        return Math.abs(mv2Args.length - mv3Args.length) <= 1;
    }

    /**
     * Identify semantic differences between behaviors
     */
    private static identifyDifferences(
        mv2Behavior: ExtensionBehavior,
        mv3Behavior: ExtensionBehavior,
        mv2Only: ApiCall[],
        mv3Only: ApiCall[]
    ): string[] {
        const differences: string[] = [];

        // Check for MV2-specific APIs that weren't migrated
        const mv2SpecificApis = mv2Only.filter(call =>
            call.path.startsWith('chrome.extension.') ||
            call.path.startsWith('chrome.browserAction.') ||
            call.path.startsWith('chrome.pageAction.') ||
            call.path === 'chrome.tabs.onActiveChanged' ||
            call.path === 'chrome.tabs.executeScript'
        );

        if (mv2SpecificApis.length > 0) {
            differences.push(
                `Found ${mv2SpecificApis.length} MV2-specific API calls that may not be properly migrated`
            );
        }

        // Check for errors
        if (mv2Behavior.errors.length > 0) {
            differences.push(`MV2 execution errors: ${mv2Behavior.errors.join('; ')}`);
        }

        if (mv3Behavior.errors.length > 0) {
            differences.push(`MV3 execution errors: ${mv3Behavior.errors.join('; ')}`);
        }

        // Check for significant behavioral differences
        const mv2CallCount = mv2Behavior.apiCalls.length;
        const mv3CallCount = mv3Behavior.apiCalls.length;

        if (Math.abs(mv2CallCount - mv3CallCount) > mv2CallCount * 0.3) {
            differences.push(
                `Significant difference in API call count: MV2=${mv2CallCount}, MV3=${mv3CallCount}`
            );
        }

        return differences;
    }

    /**
     * Determine if behaviors are equivalent enough to consider migration successful
     */
    private static determinateEquivalence(
        mv2Only: ApiCall[],
        mv3Only: ApiCall[],
        differences: string[],
        similarityScore: number
    ): boolean {
        // Strict criteria for equivalence
        if (differences.length > 2) {
            return false;
        }

        // Must have high similarity
        if (similarityScore < 0.7) {
            return false;
        }

        // Allow some differences for transformed APIs
        // but flag if there are too many unmatched calls
        const unmatchedCount = mv2Only.length + mv3Only.length;
        if (unmatchedCount > 5) {
            return false;
        }

        return true;
    }

    /**
     * Generate a detailed comparison report
     */
    static generateReport(comparison: BehaviorComparison): string {
        const lines: string[] = [];

        lines.push('=== Migration Validation Report ===\n');

        lines.push(`Overall Status: ${comparison.isEquivalent ? '✓ PASSED' : '✗ FAILED'}`);
        lines.push(`Similarity Score: ${(comparison.similarityScore * 100).toFixed(1)}%\n`);

        lines.push(`Matched API Calls: ${comparison.matched.length}`);
        lines.push(`MV2-Only Calls: ${comparison.mv2Only.length}`);
        lines.push(`MV3-Only Calls: ${comparison.mv3Only.length}\n`);

        if (comparison.differences.length > 0) {
            lines.push('Differences Detected:');
            comparison.differences.forEach(diff => {
                lines.push(`  - ${diff}`);
            });
            lines.push('');
        }

        if (comparison.mv2Only.length > 0) {
            lines.push('API Calls in MV2 but not MV3:');
            comparison.mv2Only.slice(0, 10).forEach(call => {
                lines.push(`  - ${call.path} (${call.type})`);
            });
            if (comparison.mv2Only.length > 10) {
                lines.push(`  ... and ${comparison.mv2Only.length - 10} more`);
            }
            lines.push('');
        }

        if (comparison.mv3Only.length > 0) {
            lines.push('API Calls in MV3 but not MV2:');
            comparison.mv3Only.slice(0, 10).forEach(call => {
                lines.push(`  - ${call.path} (${call.type})`);
            });
            if (comparison.mv3Only.length > 10) {
                lines.push(`  ... and ${comparison.mv3Only.length - 10} more`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }
}
