import { describe, it, expect } from '@jest/globals';
import { WebRequestMigrator } from '../../../migrator/modules/web_request_migrator/web_request_migrator';
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
        it('should return original extension if no webRequest usage found', async () => {
            const file = createMockJSFile('background.js', 'console.log("No webRequest here");');
            const extension = createMockExtension([file]);

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).toEqual(extension);
            expect(result).not.toBeInstanceOf(MigrationError);
        });

        it('should ignore non-blocking webRequest listeners', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            // Should not create any rules since these are non-blocking
            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f!.path === 'rules.json');
                expect(rulesFile).toBeUndefined();
            }
        });

        it('should only migrate blocking listeners when mixed with non-blocking', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            // Should create exactly 1 rule for the blocking listener
            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f!.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    expect(Array.isArray(rulesContent)).toBe(true);
                    expect(rulesContent.length).toBe(1);
                    expect(rulesContent[0].action.type).toBe('block');
                }
            }
        });

        it('should create rules.json for static blocking webRequest', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // Check that rules.json was created
                const rulesFile = result.files.find((f) => f!.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    expect(Array.isArray(rulesContent)).toBe(true);
                    expect(rulesContent.length).toBeGreaterThan(0);

                    // Check rule structure
                    const rule = rulesContent[0];
                    expect(rule.id).toBeDefined();
                    expect(rule.action.type).toBe('block');
                    expect(rule.condition).toBeDefined();
                }
            }
        });

        it('should fail migration for webRequest with dynamic logic', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).toBeInstanceOf(MigrationError);
            if (result instanceof MigrationError) {
                expect(result.error.message).toContain('dynamic logic');
            }
        });

        it('should fail migration for webRequest with external API calls', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).toBeInstanceOf(MigrationError);
        });

        it('should fail migration for webRequest with XMLHttpRequest', async () => {
            const file = createMockJSFile(
                'background.js',
                `
                chrome.webRequest.onBeforeRequest.addListener(
                    function(details) {
                        var xhr = new XMLHttpRequest();
                        xhr.open('GET', '/api/check');
                        xhr.send();
                        return {cancel: false};
                    },
                    {urls: ["<all_urls>"]},
                    ["blocking"]
                );
                `
            );
            const extension = createMockExtension([file]);

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).toBeInstanceOf(MigrationError);
            if (result instanceof MigrationError) {
                expect(result.error.message).toContain('external API/database calls');
            }
        });

        it('should fail migration for webRequest with loops', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).toBeInstanceOf(MigrationError);
        });

        it('should handle multiple webRequest listeners', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f!.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    expect(Array.isArray(rulesContent)).toBe(true);
                    expect(rulesContent.length).toBe(2);
                }
            }
        });

        it('should handle redirect action', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f!.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    expect(Array.isArray(rulesContent)).toBe(true);
                    const rule = rulesContent[0];
                    expect(rule.action.type).toBe('redirect');
                    expect(rule.action.redirect).toBeDefined();
                }
            }
        });

        it('should fail for named function callback', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            // Named functions are treated as dynamic logic since we can't easily analyze them
            expect(result).toBeInstanceOf(MigrationError);
        });

        it('should handle resourceTypes filter', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f!.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    expect(Array.isArray(rulesContent)).toBe(true);
                    const rule = rulesContent[0];
                    expect(rule.condition.resourceTypes).toEqual(['script', 'image']);
                }
            }
        });

        it('should create one rule per URL pattern when multiple patterns are specified', async () => {
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

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const rulesFile = result.files.find((f) => f!.path === 'rules.json');
                expect(rulesFile).toBeDefined();

                if (rulesFile) {
                    const rulesContent = JSON.parse(rulesFile.getContent());
                    expect(Array.isArray(rulesContent)).toBe(true);
                    // Should create 3 rules - one per URL pattern
                    expect(rulesContent.length).toBe(3);

                    // Verify each rule has the correct URL pattern
                    expect(rulesContent[0].condition.urlFilter).toBe('*://*.ads.com/*');
                    expect(rulesContent[1].condition.urlFilter).toBe('*://*.tracker.com/*');
                    expect(rulesContent[2].condition.urlFilter).toBe('*://*.analytics.com/*');

                    // Verify all rules have the same action and resource types
                    rulesContent.forEach((rule: any) => {
                        expect(rule.action.type).toBe('block');
                        expect(rule.condition.resourceTypes).toEqual(['script']);
                    });
                }
            }
        });

        it('should comment out migrated webRequest code in JavaScript files', async () => {
            const originalCode = `chrome.webRequest.onBeforeRequest.addListener(
  function(details) { return {cancel: true}; },
  {
    urls: [
      "*://login.di.se/check-paywall*",
      "*://login.di.se/assets/adblk*"
    ],
    types: ["script"]
  },
  ["blocking"]
);`;
            const file = createMockJSFile('blockstop.js', originalCode);
            const extension = createMockExtension([file]);

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // Find the transformed JavaScript file
                const transformedFile = result.files.find((f) => f!.path === 'blockstop.js');
                expect(transformedFile).toBeDefined();

                if (transformedFile) {
                    const transformedContent = transformedFile.getContent();

                    // Verify original code is commented out
                    expect(transformedContent).toContain('/* MIGRATED TO DECLARATIVE_NET_REQUEST');
                    expect(transformedContent).toContain(
                        'This blocking webRequest has been converted to declarativeNetRequest rules'
                    );
                    expect(transformedContent).toContain('See rules.json');

                    // Verify original code is preserved in comments
                    expect(transformedContent).toContain('chrome.webRequest.onBeforeRequest');

                    // Verify the code is NOT executable (should be commented)
                    expect(transformedContent).not.toMatch(
                        /^chrome\.webRequest\.onBeforeRequest/m
                    );
                }
            }
        });

        it('should comment out multiple webRequest calls in the same file', async () => {
            const originalCode = `chrome.webRequest.onBeforeRequest.addListener(
  function(details) { return {cancel: true}; },
  {urls: ["*://*.ads.com/*"]},
  ["blocking"]
);

chrome.webRequest.onBeforeRequest.addListener(
  function(details) { return {cancel: true}; },
  {urls: ["*://*.tracker.com/*"]},
  ["blocking"]
);`;
            const file = createMockJSFile('background.js', originalCode);
            const extension = createMockExtension([file]);

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const transformedFile = result.files.find((f) => f!.path === 'background.js');
                expect(transformedFile).toBeDefined();

                if (transformedFile) {
                    const transformedContent = transformedFile.getContent();

                    // Count the number of migration comments
                    const migrationComments = transformedContent.match(
                        /MIGRATED TO DECLARATIVE_NET_REQUEST/g
                    );
                    expect(migrationComments).toHaveLength(2);

                    // Verify no executable webRequest code remains
                    const executableWebRequests = transformedContent.match(
                        /^chrome\.webRequest\.onBeforeRequest/gm
                    );
                    expect(executableWebRequests).toBeNull();
                }
            }
        });

        it('should not modify files without webRequest usage', async () => {
            const file1 = createMockJSFile('content.js', 'console.log("content script");');
            const file2Code = `chrome.webRequest.onBeforeRequest.addListener(
  function(details) { return {cancel: true}; },
  {urls: ["*://*.ads.com/*"]},
  ["blocking"]
);`;
            const file2 = createMockJSFile('background.js', file2Code);
            const extension = createMockExtension([file1, file2]);

            const result = await WebRequestMigrator.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // content.js should remain unchanged
                const contentFile = result.files.find((f) => f!.path === 'content.js');
                expect(contentFile).toBeDefined();
                if (contentFile) {
                    expect(contentFile.getContent()).toBe('console.log("content script");');
                }

                // background.js should be commented
                const backgroundFile = result.files.find((f) => f!.path === 'background.js');
                expect(backgroundFile).toBeDefined();
                if (backgroundFile) {
                    expect(backgroundFile.getContent()).toContain('MIGRATED TO DECLARATIVE_NET_REQUEST');
                }
            }
        });
    });
});
