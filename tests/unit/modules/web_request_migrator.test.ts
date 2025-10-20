import { describe, it, expect } from '@jest/globals';
import { WebRequestMigrator } from '../../../migrator/modules/web_request_migrator';
import { Extension } from '../../../migrator/types/extension';
import { LazyFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';
import { MigrationError } from '../../../migrator/types/migration_module';
import * as espree from 'espree';

/**
 * Helper function to create a mock LazyFile with JavaScript content
 */
function createMockJSFile(path: string, content: string): LazyFile {
    const file = Object.create(LazyFile.prototype);
    file.path = path;
    file.filetype = ExtFileType.JS;
    file._content = content;

    file.getContent = () => content;
    file.getSize = () => Buffer.byteLength(content, 'utf8');
    file.close = () => {};
    file.getAST = () => {
        try {
            return espree.parse(content, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            } as any);
        } catch {
            return undefined;
        }
    };

    return file;
}

/**
 * Helper function to create a mock extension
 */
function createMockExtension(files: LazyFile[]): Extension {
    return {
        id: 'test-extension-id',
        name: 'Test Extension',
        manifest_v2_path: '/test/manifest.json',
        manifest: {
            manifest_version: 2,
            name: 'Test Extension',
            version: '1.0',
            permissions: ['webRequest', 'webRequestBlocking', '*://*/*'],
        },
        files,
    };
}

describe('WebRequestMigrator', () => {
    describe('migrate', () => {
        it('should return original extension if no webRequest usage found', () => {
            const file = createMockJSFile(
                'background.js',
                'console.log("No webRequest here");'
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            expect(result).toEqual(extension);
            expect(result).not.toBeInstanceOf(MigrationError);
        });

        it('should ignore non-blocking webRequest listeners', () => {
            const file = createMockJSFile(
                'background.js',
                `
                // Non-blocking listener (no "blocking" in extraInfoSpec)
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        console.log("Request to:", details.url);
                        // No return value - just observing
                    },
                    {urls: ["*://*.example.com/*"]}
                );

                // Another non-blocking listener
                chrome.webRequest.onCompleted.addListener(
                    function(details) {
                        console.log("Completed:", details.url);
                    },
                    {urls: ["<all_urls>"]}
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            // Should not create any rules since these are non-blocking
            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f.path === 'rules.json');
                expect(rulesFile).toBeUndefined();
            }
        });

        it('should only migrate blocking listeners when mixed with non-blocking', () => {
            const file = createMockJSFile(
                'background.js',
                `
                // Non-blocking listener - should be ignored
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        console.log("Observing:", details.url);
                    },
                    {urls: ["*://*.example.com/*"]}
                );

                // Blocking listener - should be migrated
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        return {cancel: true};
                    },
                    {urls: ["*://*.ads.com/*"]},
                    ["blocking"]
                );

                // Another non-blocking listener - should be ignored
                chrome.webRequest.onCompleted.addListener(
                    function(details) {
                        console.log("Completed:", details.url);
                    },
                    {urls: ["<all_urls>"]}
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            // Should create exactly 1 rule for the blocking listener
            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    expect(rulesContent.rules.length).toBe(1);
                    expect(rulesContent.rules[0].action.type).toBe('block');
                }
            }
        });

        it('should create rules.json for static blocking webRequest', () => {
            const file = createMockJSFile(
                'background.js',
                `
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        return {cancel: true};
                    },
                    {urls: ["*://*.ads.com/*"]},
                    ["blocking"]
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // Check that rules.json was created
                const rulesFile = result.files.find((f) => f.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    expect(rulesContent.rules).toBeDefined();
                    expect(rulesContent.rules.length).toBeGreaterThan(0);

                    // Check rule structure
                    const rule = rulesContent.rules[0];
                    expect(rule.id).toBeDefined();
                    expect(rule.action.type).toBe('block');
                    expect(rule.condition).toBeDefined();
                }
            }
        });

        it('should fail migration for webRequest with dynamic logic', () => {
            const file = createMockJSFile(
                'background.js',
                `
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        if (details.url.includes('tracker')) {
                            return {cancel: true};
                        }
                    },
                    {urls: ["<all_urls>"]},
                    ["blocking"]
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            expect(result).toBeInstanceOf(MigrationError);
            if (result instanceof MigrationError) {
                expect(result.error.message).toContain('dynamic logic');
            }
        });

        it('should fail migration for webRequest with external API calls', () => {
            const file = createMockJSFile(
                'background.js',
                `
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        fetch('/api/check').then(response => {
                            // Dynamic decision based on API response
                        });
                        return {cancel: false};
                    },
                    {urls: ["<all_urls>"]},
                    ["blocking"]
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            expect(result).toBeInstanceOf(MigrationError);
        });

        it('should fail migration for webRequest with loops', () => {
            const file = createMockJSFile(
                'background.js',
                `
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        for (let i = 0; i < 10; i++) {
                            // Some loop logic
                        }
                        return {cancel: true};
                    },
                    {urls: ["<all_urls>"]},
                    ["blocking"]
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            expect(result).toBeInstanceOf(MigrationError);
        });

        it('should handle multiple webRequest listeners', () => {
            const file = createMockJSFile(
                'background.js',
                `
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        return {cancel: true};
                    },
                    {urls: ["*://*.ads.com/*"]},
                    ["blocking"]
                );

                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        return {cancel: true};
                    },
                    {urls: ["*://*.tracker.com/*"]},
                    ["blocking"]
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    expect(rulesContent.rules.length).toBe(2);
                }
            }
        });

        it('should handle redirect action', () => {
            const file = createMockJSFile(
                'background.js',
                `
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        return {redirectUrl: "https://example.com"};
                    },
                    {urls: ["*://*.redirect.com/*"]},
                    ["blocking"]
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    const rule = rulesContent.rules[0];
                    expect(rule.action.type).toBe('redirect');
                    expect(rule.action.redirect).toBeDefined();
                }
            }
        });

        it('should fail for named function callback', () => {
            const file = createMockJSFile(
                'background.js',
                `
                function blockRequest(details) {
                    return {cancel: true};
                }

                chrome.webRequest.onBeforeRequest.addListener(
                    blockRequest,
                    {urls: ["*://*.ads.com/*"]},
                    ["blocking"]
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            // Named functions are treated as dynamic logic since we can't easily analyze them
            expect(result).toBeInstanceOf(MigrationError);
        });

        it('should handle resourceTypes filter', () => {
            const file = createMockJSFile(
                'background.js',
                `
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        return {cancel: true};
                    },
                    {
                        urls: ["*://*.ads.com/*"],
                        types: ["script", "image"]
                    },
                    ["blocking"]
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    const rule = rulesContent.rules[0];
                    expect(rule.condition.resourceTypes).toEqual(['script', 'image']);
                }
            }
        });

        it('should create one rule per URL pattern when multiple patterns are specified', () => {
            const file = createMockJSFile(
                'background.js',
                `
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        return {cancel: true};
                    },
                    {
                        urls: ["*://*.ads.com/*", "*://*.tracker.com/*", "*://*.analytics.com/*"],
                        types: ["script"]
                    },
                    ["blocking"]
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    // Should create 3 rules - one per URL pattern
                    expect(rulesContent.rules.length).toBe(3);

                    // Verify each rule has the correct URL pattern
                    expect(rulesContent.rules[0].condition.urlFilter).toBe('*://*.ads.com/*');
                    expect(rulesContent.rules[1].condition.urlFilter).toBe('*://*.tracker.com/*');
                    expect(rulesContent.rules[2].condition.urlFilter).toBe('*://*.analytics.com/*');

                    // Verify all rules have the same action and resource types
                    rulesContent.rules.forEach((rule: any) => {
                        expect(rule.action.type).toBe('block');
                        expect(rule.condition.resourceTypes).toEqual(['script']);
                    });
                }
            }
        });
    });
});
