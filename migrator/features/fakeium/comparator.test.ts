/**
 * Unit tests for BehaviorComparator (doesn't require fakeium runtime)
 */

import { describe, test, expect } from '@jest/globals';
import { BehaviorComparator } from './BehaviorComparator';
import { ApiCall, ExtensionBehavior } from './types';

describe('BehaviorComparator', () => {
    describe('API Equivalence Mapping', () => {
        test('should recognize chrome.extension -> chrome.runtime equivalence', () => {
            const mv2Behavior: ExtensionBehavior = {
                manifestVersion: 2,
                extensionId: 'test-ext',
                extensionName: 'Test Extension',
                apiCalls: [
                    {
                        path: 'chrome.extension.sendMessage',
                        type: 'CallEvent',
                        arguments: [{ type: 'hello' }]
                    }
                ],
                errors: [],
                duration: 100
            };

            const mv3Behavior: ExtensionBehavior = {
                manifestVersion: 3,
                extensionId: 'test-ext',
                extensionName: 'Test Extension',
                apiCalls: [
                    {
                        path: 'chrome.runtime.sendMessage',
                        type: 'CallEvent',
                        arguments: [{ type: 'hello' }]
                    }
                ],
                errors: [],
                duration: 100
            };

            const comparison = BehaviorComparator.compare(mv2Behavior, mv3Behavior);

            expect(comparison.matched.length).toBe(1);
            expect(comparison.mv2Only.length).toBe(0);
            expect(comparison.mv3Only.length).toBe(0);
            expect(comparison.similarityScore).toBeGreaterThan(0.9);
        });

        test('should recognize chrome.browserAction -> chrome.action equivalence', () => {
            const mv2Behavior: ExtensionBehavior = {
                manifestVersion: 2,
                extensionId: 'test-ext',
                extensionName: 'Test Extension',
                apiCalls: [
                    {
                        path: 'chrome.browserAction.setBadgeText',
                        type: 'CallEvent',
                        arguments: [{ text: '5' }]
                    }
                ],
                errors: [],
                duration: 100
            };

            const mv3Behavior: ExtensionBehavior = {
                manifestVersion: 3,
                extensionId: 'test-ext',
                extensionName: 'Test Extension',
                apiCalls: [
                    {
                        path: 'chrome.action.setBadgeText',
                        type: 'CallEvent',
                        arguments: [{ text: '5' }]
                    }
                ],
                errors: [],
                duration: 100
            };

            const comparison = BehaviorComparator.compare(mv2Behavior, mv3Behavior);

            expect(comparison.matched.length).toBe(1);
            expect(comparison.isEquivalent).toBe(true);
        });

        test('should recognize chrome.pageAction -> chrome.action equivalence', () => {
            const mv2Behavior: ExtensionBehavior = {
                manifestVersion: 2,
                extensionId: 'test-ext',
                extensionName: 'Test Extension',
                apiCalls: [
                    {
                        path: 'chrome.pageAction.show',
                        type: 'CallEvent',
                        arguments: [123]
                    }
                ],
                errors: [],
                duration: 100
            };

            const mv3Behavior: ExtensionBehavior = {
                manifestVersion: 3,
                extensionId: 'test-ext',
                extensionName: 'Test Extension',
                apiCalls: [
                    {
                        path: 'chrome.action.show',
                        type: 'CallEvent',
                        arguments: [123]
                    }
                ],
                errors: [],
                duration: 100
            };

            const comparison = BehaviorComparator.compare(mv2Behavior, mv3Behavior);

            expect(comparison.matched.length).toBe(1);
            expect(comparison.isEquivalent).toBe(true);
        });
    });

    describe('Similarity Scoring', () => {
        test('should give high similarity for identical behaviors', () => {
            const mv2Behavior: ExtensionBehavior = {
                manifestVersion: 2,
                extensionId: 'test',
                extensionName: 'Test',
                apiCalls: [
                    { path: 'chrome.storage.sync.set', type: 'CallEvent', arguments: [] },
                    { path: 'chrome.storage.sync.get', type: 'CallEvent', arguments: [] }
                ],
                errors: [],
                duration: 50
            };

            const mv3Behavior: ExtensionBehavior = {
                ...mv2Behavior,
                manifestVersion: 3
            };

            const comparison = BehaviorComparator.compare(mv2Behavior, mv3Behavior);

            expect(comparison.similarityScore).toBe(1.0);
            expect(comparison.isEquivalent).toBe(true);
        });

        test('should give lower similarity for different behaviors', () => {
            const mv2Behavior: ExtensionBehavior = {
                manifestVersion: 2,
                extensionId: 'test',
                extensionName: 'Test',
                apiCalls: [
                    { path: 'chrome.storage.sync.set', type: 'CallEvent', arguments: [] },
                    { path: 'chrome.extension.sendMessage', type: 'CallEvent', arguments: [] },
                    { path: 'chrome.browserAction.setBadgeText', type: 'CallEvent', arguments: [] }
                ],
                errors: [],
                duration: 50
            };

            const mv3Behavior: ExtensionBehavior = {
                manifestVersion: 3,
                extensionId: 'test',
                extensionName: 'Test',
                apiCalls: [
                    { path: 'chrome.storage.sync.set', type: 'CallEvent', arguments: [] }
                ],
                errors: [],
                duration: 50
            };

            const comparison = BehaviorComparator.compare(mv2Behavior, mv3Behavior);

            expect(comparison.similarityScore).toBeLessThan(1.0);
            expect(comparison.mv2Only.length).toBeGreaterThan(0);
        });
    });

    describe('Report Generation', () => {
        test('should generate readable report', () => {
            const mv2Behavior: ExtensionBehavior = {
                manifestVersion: 2,
                extensionId: 'test',
                extensionName: 'Test',
                apiCalls: [
                    { path: 'chrome.extension.sendMessage', type: 'CallEvent', arguments: [] }
                ],
                errors: [],
                duration: 50
            };

            const mv3Behavior: ExtensionBehavior = {
                manifestVersion: 3,
                extensionId: 'test',
                extensionName: 'Test',
                apiCalls: [
                    { path: 'chrome.runtime.sendMessage', type: 'CallEvent', arguments: [] }
                ],
                errors: [],
                duration: 50
            };

            const comparison = BehaviorComparator.compare(mv2Behavior, mv3Behavior);
            const report = BehaviorComparator.generateReport(comparison);

            expect(report).toContain('Migration Validation Report');
            expect(report).toContain('Similarity Score');
            expect(report).toContain('Matched API Calls');
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty behaviors', () => {
            const emptyMV2: ExtensionBehavior = {
                manifestVersion: 2,
                extensionId: 'empty',
                extensionName: 'Empty',
                apiCalls: [],
                errors: [],
                duration: 0
            };

            const emptyMV3: ExtensionBehavior = {
                ...emptyMV2,
                manifestVersion: 3
            };

            const comparison = BehaviorComparator.compare(emptyMV2, emptyMV3);

            expect(comparison.similarityScore).toBe(1.0);
            expect(comparison.isEquivalent).toBe(true);
        });

        test('should handle behaviors with errors', () => {
            const mv2WithErrors: ExtensionBehavior = {
                manifestVersion: 2,
                extensionId: 'test',
                extensionName: 'Test',
                apiCalls: [],
                errors: ['Syntax error'],
                duration: 10
            };

            const mv3WithErrors: ExtensionBehavior = {
                manifestVersion: 3,
                extensionId: 'test',
                extensionName: 'Test',
                apiCalls: [],
                errors: [],
                duration: 10
            };

            const comparison = BehaviorComparator.compare(mv2WithErrors, mv3WithErrors);

            expect(comparison.differences.length).toBeGreaterThan(0);
            expect(comparison.differences.some(d => d.includes('error'))).toBe(true);
        });
    });
});
