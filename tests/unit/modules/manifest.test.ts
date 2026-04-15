import { describe, it, expect, beforeEach } from '@jest/globals';
import { MigrateManifest } from '../../../migrator/modules/manifest';
import { Extension } from '../../../migrator/types/extension';
import { MigrationError } from '../../../migrator/types/migration_module';
import { createMockFile } from '../../fixtures/test_helpers';
import { ExtFileType } from '../../../migrator/types/ext_file_types';

describe('MigrateManifest', () => {
    let baseExtension: Extension;

    beforeEach(() => {
        baseExtension = {
            id: 'test-extension-id',
            name: 'Test Extension',
            manifest_v2_path: '/test/path',
            manifest: {
                name: 'Test Extension',
                version: '1.0',
                manifest_version: 2,
                description: 'A test extension',
            },
            files: [],
        };
    });

    describe('migrate', () => {
        it('should update manifest version from 2 to 3', async () => {
            const result = await MigrateManifest.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.manifest.manifest_version).toBe(3);
            }
        });

        it('should not add Content Security Policy (handled by MigrateCSP module)', async () => {
            const result = await MigrateManifest.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // CSP is now handled by the separate MigrateCSP module
                expect(result.manifest.content_security_policy).toBeUndefined();
            }
        });

        describe('permissions migration', () => {
            it('should split permissions into API permissions and host permissions', async () => {
                baseExtension.manifest.permissions = [
                    'activeTab',
                    'storage',
                    'http://example.com/*',
                    'https://api.example.com/*',
                ];

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.permissions).toEqual(['activeTab', 'storage']);
                    expect(result.manifest.host_permissions).toEqual([
                        'http://example.com/*',
                        'https://api.example.com/*',
                    ]);
                }
            });

            it('should convert webRequestBlocking to declarativeNetRequest', async () => {
                baseExtension.manifest.permissions = ['webRequestBlocking', 'activeTab'];

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.permissions).toContain('declarativeNetRequest');
                    expect(result.manifest.permissions).not.toContain('webRequestBlocking');
                    expect(result.manifest.permissions).toContain('activeTab');
                }
            });

            it('should handle empty permissions array', async () => {
                baseExtension.manifest.permissions = [];

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.permissions).toEqual([]);
                    expect(result.manifest.host_permissions).toEqual([]);
                }
            });

            it('should handle undefined permissions', async () => {
                delete baseExtension.manifest.permissions;

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.permissions).toEqual([]);
                    expect(result.manifest.host_permissions).toEqual([]);
                }
            });
        });

        describe('web_accessible_resources migration', () => {
            it('should convert array format to object format', async () => {
                baseExtension.manifest.web_accessible_resources = [
                    'images/*',
                    'styles/content.css',
                    'scripts/injected.js',
                ];

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.web_accessible_resources).toEqual([
                        {
                            resources: ['images/*', 'styles/content.css', 'scripts/injected.js'],
                            matches: ['*://*/*'],
                        },
                    ]);
                }
            });

            it('should handle empty web_accessible_resources', async () => {
                baseExtension.manifest.web_accessible_resources = [];

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.web_accessible_resources).toEqual([
                        {
                            resources: [],
                            matches: ['*://*/*'],
                        },
                    ]);
                }
            });

            it('should handle undefined web_accessible_resources', async () => {
                // web_accessible_resources not set

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    // Should not modify if undefined
                    expect(result.manifest.web_accessible_resources).toBeUndefined();
                }
            });
        });

        describe('action migration', () => {
            it('should migrate browser_action to action', async () => {
                baseExtension.manifest.browser_action = {
                    default_popup: 'popup.html',
                    default_title: 'Test Extension',
                    default_icon: {
                        16: 'icon16.png',
                        48: 'icon48.png',
                    },
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.action).toEqual({
                        default_popup: 'popup.html',
                        default_title: 'Test Extension',
                        default_icon: {
                            16: 'icon16.png',
                            48: 'icon48.png',
                        },
                    });
                    expect(result.manifest.browser_action).toBeUndefined();
                }
            });

            it('should migrate page_action to action', async () => {
                baseExtension.manifest.page_action = {
                    default_popup: 'page_popup.html',
                    default_title: 'Page Action',
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.action).toEqual({
                        default_popup: 'page_popup.html',
                        default_title: 'Page Action',
                    });
                    expect(result.manifest.page_action).toBeUndefined();
                }
            });

            it('should handle both browser_action and page_action', async () => {
                baseExtension.manifest.browser_action = {
                    default_popup: 'browser_popup.html',
                };
                baseExtension.manifest.page_action = {
                    default_title: 'Page Title',
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    // Should merge both actions
                    expect(result.manifest.action).toBeDefined();
                    expect(result.manifest.browser_action).toBeUndefined();
                    expect(result.manifest.page_action).toBeUndefined();
                }
            });

            it('should handle no actions', async () => {
                // No browser_action or page_action

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.action).toBeUndefined();
                }
            });

            it('should remove chrome_style from browser_action', async () => {
                baseExtension.manifest.browser_action = {
                    default_popup: 'popup.html',
                    chrome_style: true,
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.action).toBeDefined();
                    expect(result.manifest.action.chrome_style).toBeUndefined();
                    expect(result.manifest.action.default_popup).toBe('popup.html');
                }
            });

            it('should remove chrome_style from page_action', async () => {
                baseExtension.manifest.page_action = {
                    default_title: 'My Action',
                    chrome_style: false,
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.action).toBeDefined();
                    expect(result.manifest.action.chrome_style).toBeUndefined();
                    expect(result.manifest.action.default_title).toBe('My Action');
                }
            });

            it('should remove chrome_style when merging both browser_action and page_action', async () => {
                baseExtension.manifest.browser_action = {
                    default_popup: 'popup.html',
                    chrome_style: true,
                };
                baseExtension.manifest.page_action = {
                    default_title: 'Page Action',
                    chrome_style: false,
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.action).toBeDefined();
                    expect(result.manifest.action.chrome_style).toBeUndefined();
                    expect(result.manifest.action.default_popup).toBe('popup.html');
                    expect(result.manifest.action.default_title).toBe('Page Action');
                }
            });

            it('should migrate action without chrome_style unchanged', async () => {
                baseExtension.manifest.browser_action = {
                    default_popup: 'popup.html',
                    default_icon: { 16: 'icon16.png' },
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.action).toEqual({
                        default_popup: 'popup.html',
                        default_icon: { 16: 'icon16.png' },
                    });
                }
            });
        });

        describe('background migration', () => {
            it('should convert background scripts to service worker', async () => {
                // Create mock files for the background scripts
                const backgroundFile = createMockFile({
                    path: 'background.js',
                    content: 'console.log("background");',
                    filetype: ExtFileType.JS,
                });
                const helperFile = createMockFile({
                    path: 'helper.js',
                    content: 'console.log("helper");',
                    filetype: ExtFileType.JS,
                });

                baseExtension.manifest.background = {
                    scripts: ['background.js', 'helper.js'],
                    persistent: false,
                };
                baseExtension.files = [backgroundFile, helperFile];

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.background).toEqual({
                        service_worker: 'background.js',
                    });

                    // Verify that the background file was transformed in memory
                    const transformedBackgroundFile = result.files.find(
                        (f) => f!.path === 'background.js'
                    );
                    expect(transformedBackgroundFile).toBeDefined();

                    if (transformedBackgroundFile) {
                        const content = transformedBackgroundFile.getContent();
                        // Verify importScripts was injected
                        expect(content).toContain("importScripts('helper.js');");
                        // Verify original content is preserved
                        expect(content).toContain('console.log("background");');
                        // Verify import comes before original content
                        expect(content.indexOf("importScripts('helper.js');")).toBeLessThan(
                            content.indexOf('console.log("background");')
                        );
                    }
                }
            });

            it('should convert background page to service worker', async () => {
                baseExtension.manifest.background = {
                    page: 'background.html',
                    persistent: true,
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.background).toEqual({
                        service_worker: 'background.html',
                    });
                }
            });

            it('should handle single background script', async () => {
                baseExtension.manifest.background = {
                    scripts: ['single-script.js'],
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.background).toEqual({
                        service_worker: 'single-script.js',
                    });
                }
            });

            it('should inject all other scripts in order when multiple background scripts exist', async () => {
                // Create mock files for multiple background scripts
                const backgroundFile = createMockFile({
                    path: 'background.js',
                    content: 'console.log("background");',
                    filetype: ExtFileType.JS,
                });
                const utilsFile = createMockFile({
                    path: 'utils.js',
                    content: 'console.log("utils");',
                    filetype: ExtFileType.JS,
                });
                const helperFile = createMockFile({
                    path: 'helper.js',
                    content: 'console.log("helper");',
                    filetype: ExtFileType.JS,
                });
                const libFile = createMockFile({
                    path: 'lib.js',
                    content: 'console.log("lib");',
                    filetype: ExtFileType.JS,
                });

                baseExtension.manifest.background = {
                    scripts: ['background.js', 'utils.js', 'helper.js', 'lib.js'],
                };
                baseExtension.files = [backgroundFile, utilsFile, helperFile, libFile];

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    // Verify the service worker was set correctly
                    expect(result.manifest.background).toEqual({
                        service_worker: 'background.js',
                    });

                    // Verify that the background file was transformed in memory
                    const transformedBackgroundFile = result.files.find(
                        (f) => f!.path === 'background.js'
                    );
                    expect(transformedBackgroundFile).toBeDefined();

                    if (transformedBackgroundFile) {
                        const content = transformedBackgroundFile.getContent();

                        // Check that imports are in the correct order
                        expect(content).toContain("importScripts('utils.js');");
                        expect(content).toContain("importScripts('helper.js');");
                        expect(content).toContain("importScripts('lib.js');");

                        // Verify order: utils before helper, helper before lib
                        const utilsIndex = content.indexOf("importScripts('utils.js');");
                        const helperIndex = content.indexOf("importScripts('helper.js');");
                        const libIndex = content.indexOf("importScripts('lib.js');");

                        expect(utilsIndex).toBeLessThan(helperIndex);
                        expect(helperIndex).toBeLessThan(libIndex);

                        // Verify original content is preserved
                        expect(content).toContain('console.log("background");');
                    }
                }
            });

            it('should handle empty background scripts', async () => {
                baseExtension.manifest.background = {
                    scripts: [],
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    // Should not set service_worker if no scripts
                    expect(result.manifest.background).toEqual({});
                }
            });

            it('should handle undefined background', async () => {
                // No background field

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.background).toBeUndefined();
                }
            });

            it('should handle background with service_worker already set', async () => {
                baseExtension.manifest.background = {
                    service_worker: 'existing-worker.js',
                };

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    // Should preserve existing service_worker
                    expect(result.manifest.background).toEqual({
                        service_worker: 'existing-worker.js',
                    });
                }
            });
        });

        describe('error handling', () => {
            it('should return MigrationError when manifest is corrupted', async () => {
                const corruptedExtension = {
                    ...baseExtension,
                    manifest: null as any,
                };

                const result = await MigrateManifest.migrate(corruptedExtension);

                expect(result).toBeInstanceOf(MigrationError);
                if (result instanceof MigrationError) {
                    expect(result.extension).toBe(corruptedExtension);
                    expect(result.error).toBeDefined();
                }
            });

            it('should handle invalid permissions gracefully', async () => {
                baseExtension.manifest.permissions = [
                    null, // Invalid permission
                    'activeTab',
                    undefined,
                    'storage',
                ];

                const result = await MigrateManifest.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    // Should filter out invalid permissions
                    expect(result.manifest.permissions).toEqual(['activeTab', 'storage']);
                }
            });
        });

        describe('complex scenarios', () => {
            it('should handle complete extension migration', async () => {
                const complexExtension: Extension = {
                    id: 'complex-extension',
                    name: 'Complex Extension',
                    manifest_v2_path: '/complex/path',
                    manifest: {
                        name: 'Complex Extension',
                        version: '2.0',
                        manifest_version: 2,
                        description: 'A complex test extension',
                        permissions: [
                            'activeTab',
                            'storage',
                            'webRequestBlocking',
                            'http://example.com/*',
                            'https://api.example.com/*',
                        ],
                        web_accessible_resources: ['images/*', 'css/content.css'],
                        browser_action: {
                            default_popup: 'popup.html',
                            default_title: 'Complex Extension',
                        },
                        background: {
                            scripts: ['background.js', 'helper.js'],
                            persistent: false,
                        },
                        content_scripts: [
                            {
                                matches: ['<all_urls>'],
                                js: ['content.js'],
                            },
                        ],
                    },
                    files: [],
                };

                const result = await MigrateManifest.migrate(complexExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    // Verify all transformations
                    expect(result.manifest.manifest_version).toBe(3);
                    expect(result.manifest.permissions).toEqual([
                        'activeTab',
                        'storage',
                        'declarativeNetRequest',
                    ]);
                    expect(result.manifest.host_permissions).toEqual([
                        'http://example.com/*',
                        'https://api.example.com/*',
                    ]);
                    expect(result.manifest.web_accessible_resources).toEqual([
                        {
                            resources: ['images/*', 'css/content.css'],
                            matches: ['*://*/*'],
                        },
                    ]);
                    expect(result.manifest.action).toEqual({
                        default_popup: 'popup.html',
                        default_title: 'Complex Extension',
                    });
                    expect(result.manifest.background).toEqual({
                        service_worker: 'background.js',
                    });
                    // CSP is now handled by the separate MigrateCSP module
                    expect(result.manifest.content_security_policy).toBeUndefined();
                    expect(result.manifest.browser_action).toBeUndefined();
                    expect(result.manifest.content_scripts).toEqual([
                        {
                            matches: ['<all_urls>'],
                            js: ['content.js'],
                        },
                    ]);
                }
            });
        });
    });
});
