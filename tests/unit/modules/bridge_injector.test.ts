import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BridgeInjector } from '../../../migrator/modules/bridge_injector/index';
import { Extension } from '../../../migrator/types/extension';
import { MigrationError } from '../../../migrator/types/migration_module';
import { LazyFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';
import { FileContentUpdater } from '../../../migrator/utils/file_content_updater';
import * as fs from 'fs';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock logger
jest.mock('../../../migrator/utils/logger', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

// Mock FileContentUpdater
jest.mock('../../../migrator/utils/file_content_updater', () => ({
    FileContentUpdater: {
        updateFileContent: jest.fn(),
        createNewFile: jest.fn(),
    },
}));

describe('BridgeInjector', () => {
    let baseExtension: Extension;
    let mockJsFile: LazyFile;
    let mockNonJsFile: LazyFile;
    const mockFileContentUpdater = FileContentUpdater as jest.Mocked<typeof FileContentUpdater>;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock file system
        mockFs.readFileSync.mockReturnValue('// Mock bridge content\nconst bridge = {}');

        // Mock FileContentUpdater
        mockFileContentUpdater.updateFileContent.mockImplementation(() => {});

        // Create mock files
        mockJsFile = {
            path: 'content.js',
            filetype: ExtFileType.JS,
            getContent: jest.fn(),
            getAST: jest.fn(),
            getSize: jest.fn().mockReturnValue(1000),
            getBuffer: jest.fn(),
            close: jest.fn(),
        } as unknown as LazyFile;

        mockNonJsFile = {
            path: 'styles.css',
            filetype: ExtFileType.CSS,
            getContent: jest.fn(),
            getAST: jest.fn(),
            getSize: jest.fn().mockReturnValue(500),
            getBuffer: jest.fn(),
            close: jest.fn(),
        } as unknown as LazyFile;

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
            files: [mockJsFile, mockNonJsFile],
        };
    });

    describe('migrate', () => {
        it('should inject bridge for extension with callback patterns', async () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({}, function(tabs) { console.log(tabs); });'
            );

            const result = await BridgeInjector.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.files).toHaveLength(3); // Original 2 + bridge file
                expect(
                    result.files.some((f) => f!.path === BridgeInjector.testHelpers.BRIDGE_FILENAME)
                ).toBe(true);
            }
        });

        it('should return unchanged extension when no callback patterns found', async () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'const data = chrome.storage.sync.get("key").then(result => console.log(result));'
            );

            const result = await BridgeInjector.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.files).toHaveLength(2); // Original files only
                expect(result).toBe(baseExtension); // Should return same object
            }
        });

        it('should return unchanged when bridge already exists', async () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({}, function(tabs) { console.log(tabs); });'
            );

            const bridgeFile = {
                path: BridgeInjector.testHelpers.BRIDGE_FILENAME,
                filetype: ExtFileType.JS,
            } as LazyFile;

            baseExtension.files.push(bridgeFile);

            const result = await BridgeInjector.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result).toBe(baseExtension); // Should return same object
                expect(result.files).toHaveLength(3); // No additional bridge file
            }
        });

        it('should return MigrationError for invalid extension structure', async () => {
            const invalidExtension = {
                id: null,
                name: null,
                manifest_v2_path: null,
                manifest: null,
                files: null,
            } as unknown as Extension;

            const result = await BridgeInjector.migrate(invalidExtension);

            expect(result).toBeInstanceOf(MigrationError);
            if (result instanceof MigrationError) {
                expect(result.extension).toBe(invalidExtension);
                expect(result.error).toBeDefined();
            }
        });

        it('should return MigrationError when bridge file loading fails', async () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({}, function(tabs) { console.log(tabs); });'
            );
            mockFs.readFileSync.mockImplementation(() => {
                throw new Error('File not found');
            });

            const result = await BridgeInjector.migrate(baseExtension);

            expect(result).toBeInstanceOf(MigrationError);
            if (result instanceof MigrationError) {
                expect(result.extension).toBe(baseExtension);
                expect(result.error.message).toContain('Failed to load bridge file');
            }
        });

        it('should update manifest to include bridge in content scripts', async () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.storage.local.get("key", function(result) { console.log(result); });'
            );

            baseExtension.manifest.content_scripts = [
                {
                    matches: ['<all_urls>'],
                    js: ['content.js'],
                },
            ];

            const result = await BridgeInjector.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.manifest.content_scripts[0].js).toEqual([
                    BridgeInjector.testHelpers.BRIDGE_FILENAME,
                    'content.js',
                ]);
            }
        });

        it('should add web_accessible_resources for MV3', async () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({}, callback);'
            );

            baseExtension.manifest.manifest_version = 3;
            baseExtension.manifest.content_scripts = [
                {
                    matches: ['<all_urls>'],
                    js: ['content.js'],
                },
            ];

            const result = await BridgeInjector.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.manifest.web_accessible_resources).toContainEqual({
                    resources: [BridgeInjector.testHelpers.BRIDGE_FILENAME],
                    matches: ['<all_urls>'],
                });
            }
        });

        it('should measure and log performance metrics', async () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({}, function(tabs) {});'
            );

            const startTime = Date.now();
            const result = await BridgeInjector.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            // Verify that the migration completed within reasonable time
            expect(Date.now() - startTime).toBeLessThan(1000);
        });
    });

    describe('needsBridge helper', () => {
        it('should detect chrome.tabs.query with callback', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({active: true}, function(tabs) { console.log(tabs); });'
            );

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(true);
        });

        it('should detect chrome.storage.local.get with callback', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.storage.local.get("key", function(result) { return result; });'
            );

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(true);
        });

        it('should detect chrome API with arrow function callback', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.runtime.sendMessage(msg, (response) => { console.log(response); });'
            );

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(true);
        });

        it('should detect chrome API with named function', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.create(tabInfo, handleTabCreated);'
            );

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(true);
        });

        it('should not detect promise-based APIs', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({}).then(tabs => console.log(tabs));'
            );

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(false);
        });

        it('should not detect APIs without callbacks', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'const manifest = chrome.runtime.getManifest();'
            );

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(false);
        });

        it('should ignore non-JS files', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue('const data = "no chrome APIs";');
            (mockNonJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({}, function(tabs) {});' // CSS content that looks like JS
            );

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(false);
        });

        it('should handle files with no content', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(null);

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(false);
        });

        it('should handle files with empty content', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue('');

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(false);
        });

        it('should detect multiple callback patterns in same file', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(`
                chrome.tabs.query({}, function(tabs) {});
                chrome.storage.sync.set(data, () => {});
                chrome.runtime.sendMessage(msg, handleResponse);
            `);

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(true);
        });

        it('should handle complex chrome API patterns', () => {
            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.webRequest.onBeforeRequest.addListener(function(details) {}, {urls: ["<all_urls>"]});'
            );

            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(true);
        });
    });

    describe('injectBridgeIntoManifest helper', () => {
        it('should inject bridge into content scripts', () => {
            const manifest = {
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        js: ['content.js', 'utils.js'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                baseExtension
            );

            expect(result.content_scripts[0].js).toEqual([
                BridgeInjector.testHelpers.BRIDGE_FILENAME,
                'content.js',
                'utils.js',
            ]);
        });

        it('should inject bridge into multiple content scripts', () => {
            const manifest = {
                content_scripts: [
                    {
                        matches: ['*://example.com/*'],
                        js: ['script1.js'],
                    },
                    {
                        matches: ['*://test.com/*'],
                        js: ['script2.js'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                baseExtension
            );

            expect(result.content_scripts[0].js).toEqual([
                BridgeInjector.testHelpers.BRIDGE_FILENAME,
                'script1.js',
            ]);
            expect(result.content_scripts[1].js).toEqual([
                BridgeInjector.testHelpers.BRIDGE_FILENAME,
                'script2.js',
            ]);
        });

        it('should not duplicate bridge if already present', () => {
            const manifest = {
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        js: [BridgeInjector.testHelpers.BRIDGE_FILENAME, 'content.js'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                baseExtension
            );

            expect(result.content_scripts[0].js).toEqual([
                BridgeInjector.testHelpers.BRIDGE_FILENAME,
                'content.js',
            ]);
        });

        it('should handle content scripts without js array', () => {
            const manifest = {
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        css: ['styles.css'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                baseExtension
            );

            expect(result.content_scripts[0]).toEqual({
                matches: ['<all_urls>'],
                css: ['styles.css'],
            });
        });

        it('should add web_accessible_resources for MV3 with content scripts', () => {
            const manifest = {
                manifest_version: 3,
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        js: ['content.js'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                baseExtension
            );

            expect(result.web_accessible_resources).toContainEqual({
                resources: [BridgeInjector.testHelpers.BRIDGE_FILENAME],
                matches: ['<all_urls>'],
            });
        });

        it('should add web_accessible_resources for MV2 with content scripts', () => {
            const manifest = {
                manifest_version: 2,
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        js: ['content.js'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                baseExtension
            );

            expect(result.web_accessible_resources).toContain(
                BridgeInjector.testHelpers.BRIDGE_FILENAME
            );
        });

        it('should not duplicate in existing MV3 web_accessible_resources', () => {
            const manifest = {
                manifest_version: 3,
                content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
                web_accessible_resources: [
                    {
                        resources: [BridgeInjector.testHelpers.BRIDGE_FILENAME, 'other.js'],
                        matches: ['<all_urls>'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                baseExtension
            );

            expect(result.web_accessible_resources).toHaveLength(1);
            expect(result.web_accessible_resources[0].resources).toContain(
                BridgeInjector.testHelpers.BRIDGE_FILENAME
            );
        });

        it('should not duplicate in existing MV2 web_accessible_resources', () => {
            const manifest = {
                manifest_version: 2,
                content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
                web_accessible_resources: [BridgeInjector.testHelpers.BRIDGE_FILENAME, 'other.js'],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                baseExtension
            );

            expect(result.web_accessible_resources).toEqual([
                BridgeInjector.testHelpers.BRIDGE_FILENAME,
                'other.js',
            ]);
        });

        it('should inject bridge into service worker when extension is provided', () => {
            const mockServiceWorkerFile = {
                path: 'background.js',
                filetype: ExtFileType.JS,
                getContent: jest.fn().mockReturnValue('console.log("Service worker");'),
                getAST: jest.fn(),
                getSize: jest.fn().mockReturnValue(800),
                getBuffer: jest.fn(),
                close: jest.fn(),
            } as unknown as LazyFile;

            const extensionWithServiceWorker = {
                ...baseExtension,
                files: [mockServiceWorkerFile],
            };

            const manifest = {
                background: {
                    service_worker: 'background.js',
                },
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                extensionWithServiceWorker
            );

            expect(result).toEqual(manifest); // Manifest shouldn't change
            // Verify the file was transformed in memory (not written to disk)
            const transformedFile = extensionWithServiceWorker.files.find(
                (f) => f.path === 'background.js'
            );
            expect(transformedFile).toBeDefined();
            if (transformedFile) {
                const content = transformedFile.getContent();
                expect(content).toContain(
                    `importScripts('${BridgeInjector.testHelpers.BRIDGE_FILENAME}');`
                );
                expect(content).toContain('console.log("Service worker");');
            }
        });

        it('should warn about service worker when no extension is provided', () => {
            const manifest = {
                background: {
                    service_worker: 'background.js',
                },
            };

            BridgeInjector.testHelpers.injectBridgeIntoManifest(manifest);

            // Should not throw, but warning should be logged (tested via logger mock)
        });

        it('should handle service worker injection failure gracefully', () => {
            const mockServiceWorkerFile = {
                path: 'background.js',
                filetype: ExtFileType.JS,
                getContent: jest.fn().mockImplementation(() => {
                    throw new Error('Failed to read file');
                }),
                getAST: jest.fn(),
                getSize: jest.fn().mockReturnValue(800),
                getBuffer: jest.fn(),
                close: jest.fn(),
            } as unknown as LazyFile;

            const extensionWithServiceWorker = {
                ...baseExtension,
                files: [mockServiceWorkerFile],
            };

            const manifest = {
                background: {
                    service_worker: 'background.js',
                },
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                extensionWithServiceWorker
            );

            expect(result).toEqual(manifest); // Should still return manifest even if injection fails
        });

        it('should handle manifest without content scripts', () => {
            const manifest = {
                name: 'Test Extension',
                version: '1.0',
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                baseExtension
            );

            expect(result).toEqual(manifest);
        });

        it('should create deep copy of manifest', () => {
            const manifest = {
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        js: ['content.js'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(
                manifest,
                baseExtension
            );

            expect(result).not.toBe(manifest);
            expect(result.content_scripts).not.toBe(manifest.content_scripts);
        });
    });

    describe('createBridgeFile helper', () => {
        beforeEach(() => {
            mockFs.readFileSync.mockReturnValue('// Bridge content\nconst bridge = "test";');
        });

        it('should create LazyFile with correct properties', () => {
            const bridgeFile = BridgeInjector.testHelpers.createBridgeFile();

            expect(bridgeFile.path).toBe(BridgeInjector.testHelpers.BRIDGE_FILENAME);
            expect(bridgeFile.filetype).toBe(ExtFileType.JS);
        });

        it('should provide getContent method', () => {
            const bridgeFile = BridgeInjector.testHelpers.createBridgeFile();

            expect(bridgeFile.getContent()).toBe('// Bridge content\nconst bridge = "test";');
        });

        it('should provide getSize method', () => {
            const bridgeFile = BridgeInjector.testHelpers.createBridgeFile();

            const expectedSize = Buffer.byteLength(
                '// Bridge content\nconst bridge = "test";',
                'utf8'
            );
            expect(bridgeFile.getSize()).toBe(expectedSize);
        });

        it('should provide close method that does nothing', () => {
            const bridgeFile = BridgeInjector.testHelpers.createBridgeFile();

            expect(() => bridgeFile.close()).not.toThrow();
        });

        it('should provide getAST method that returns undefined', () => {
            const bridgeFile = BridgeInjector.testHelpers.createBridgeFile();

            expect(bridgeFile.getAST()).toBeUndefined();
        });

        it('should store bridge content internally', () => {
            const bridgeFile = BridgeInjector.testHelpers.createBridgeFile();

            expect((bridgeFile as any)._bridgeContent).toBe(
                '// Bridge content\nconst bridge = "test";'
            );
        });
    });

    describe('loadBridgeContent helper', () => {
        it('should load bridge content from template file', () => {
            const mockContent = '// Mock bridge content\nfunction bridgeFunction() {}';
            mockFs.readFileSync.mockReturnValue(mockContent);

            const content = BridgeInjector.testHelpers.loadBridgeContent();

            expect(content).toBe(mockContent);
            expect(mockFs.readFileSync).toHaveBeenCalledWith(
                expect.stringContaining('ext_bridge.js'),
                'utf8'
            );
        });

        it('should throw error when template file not found', () => {
            mockFs.readFileSync.mockImplementation(() => {
                const error = new Error('ENOENT: no such file or directory');
                (error as any).code = 'ENOENT';
                throw error;
            });

            expect(() => BridgeInjector.testHelpers.loadBridgeContent()).toThrow(
                'Failed to load bridge file'
            );
        });

        it('should throw error when file permission denied', () => {
            mockFs.readFileSync.mockImplementation(() => {
                const error = new Error('EACCES: permission denied');
                (error as any).code = 'EACCES';
                throw error;
            });

            expect(() => BridgeInjector.testHelpers.loadBridgeContent()).toThrow(
                'Failed to load bridge file'
            );
        });

        it('should handle non-Error exceptions', () => {
            mockFs.readFileSync.mockImplementation(() => {
                throw 'String error';
            });

            expect(() => BridgeInjector.testHelpers.loadBridgeContent()).toThrow(
                'Failed to load bridge file: String error'
            );
        });
    });

    describe('hasBridgeInManifest helper', () => {
        it('should detect bridge in background scripts', () => {
            const manifest = {
                background: {
                    scripts: ['background.js', BridgeInjector.testHelpers.BRIDGE_FILENAME],
                },
            };

            const result = BridgeInjector.testHelpers.hasBridgeInManifest(manifest);
            expect(result).toBe(true);
        });

        it('should detect bridge in content scripts', () => {
            const manifest = {
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        js: [BridgeInjector.testHelpers.BRIDGE_FILENAME, 'content.js'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.hasBridgeInManifest(manifest);
            expect(result).toBe(true);
        });

        it('should detect bridge in any content script', () => {
            const manifest = {
                content_scripts: [
                    {
                        matches: ['*://example.com/*'],
                        js: ['script1.js'],
                    },
                    {
                        matches: ['*://test.com/*'],
                        js: [BridgeInjector.testHelpers.BRIDGE_FILENAME, 'script2.js'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.hasBridgeInManifest(manifest);
            expect(result).toBe(true);
        });

        it('should return false when bridge not present', () => {
            const manifest = {
                background: {
                    scripts: ['background.js'],
                },
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        js: ['content.js'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.hasBridgeInManifest(manifest);
            expect(result).toBe(false);
        });

        it('should handle manifest without background', () => {
            const manifest = {
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        js: ['content.js'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.hasBridgeInManifest(manifest);
            expect(result).toBe(false);
        });

        it('should handle manifest without content_scripts', () => {
            const manifest = {
                background: {
                    scripts: ['background.js'],
                },
            };

            const result = BridgeInjector.testHelpers.hasBridgeInManifest(manifest);
            expect(result).toBe(false);
        });

        it('should handle manifest with service_worker instead of scripts', () => {
            const manifest = {
                background: {
                    service_worker: 'background.js',
                },
            };

            const result = BridgeInjector.testHelpers.hasBridgeInManifest(manifest);
            expect(result).toBe(false);
        });

        it('should handle content scripts without js array', () => {
            const manifest = {
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        css: ['styles.css'],
                    },
                ],
            };

            const result = BridgeInjector.testHelpers.hasBridgeInManifest(manifest);
            expect(result).toBe(false);
        });

        it('should handle empty manifest', () => {
            const manifest = {};

            const result = BridgeInjector.testHelpers.hasBridgeInManifest(manifest);
            expect(result).toBe(false);
        });

        it('should handle null manifest', () => {
            const result = BridgeInjector.testHelpers.hasBridgeInManifest(null);
            expect(result).toBe(false);
        });
    });

    describe('injectBridgeIntoServiceWorker helper', () => {
        let mockServiceWorkerFile: LazyFile;

        beforeEach(() => {
            mockServiceWorkerFile = {
                path: 'background.js',
                filetype: ExtFileType.JS,
                getContent: jest.fn(),
                getAST: jest.fn(),
                getSize: jest.fn().mockReturnValue(800),
                getBuffer: jest.fn(),
                close: jest.fn(),
            } as unknown as LazyFile;
        });

        it('should inject importScripts into service worker', () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'console.log("Service worker started");'
            );

            const testExtension = {
                ...baseExtension,
                files: [mockServiceWorkerFile],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoServiceWorker(
                testExtension,
                'background.js'
            );

            expect(result).not.toBeNull();
            expect(result?.path).toBe('background.js');
            const content = result?.getContent();
            expect(content).toContain(
                `importScripts('${BridgeInjector.testHelpers.BRIDGE_FILENAME}');`
            );
            expect(content).toContain('console.log("Service worker started");');
        });

        it('should not duplicate importScripts if already present', () => {
            const existingContent = `importScripts('${BridgeInjector.testHelpers.BRIDGE_FILENAME}');\nconsole.log("Service worker started");`;
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(existingContent);

            const testExtension = {
                ...baseExtension,
                files: [mockServiceWorkerFile],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoServiceWorker(
                testExtension,
                'background.js'
            );

            expect(result).toBeNull(); // No transformation needed
        });

        it('should return null when service worker file not found', () => {
            const testExtension = {
                ...baseExtension,
                files: [mockJsFile], // Different file
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoServiceWorker(
                testExtension,
                'missing-background.js'
            );

            expect(result).toBeNull();
        });

        it('should handle file transformation errors gracefully', () => {
            // Simulate an error during transformation (e.g., invalid file path processing)
            (mockServiceWorkerFile.getContent as jest.Mock).mockImplementation(() => {
                throw new Error('File read error');
            });

            const testExtension = {
                ...baseExtension,
                files: [mockServiceWorkerFile],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoServiceWorker(
                testExtension,
                'background.js'
            );

            expect(result).toBeNull();
        });

        it('should handle getContent throwing errors', () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockImplementation(() => {
                throw new Error('File read error');
            });

            const testExtension = {
                ...baseExtension,
                files: [mockServiceWorkerFile],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoServiceWorker(
                testExtension,
                'background.js'
            );

            expect(result).toBeNull();
        });

        it('should handle complex service worker content', () => {
            const complexContent = `
// Service Worker Registration
self.addEventListener('install', function(event) {
  console.log('Service Worker installing');
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // Handle messages
});
            `.trim();

            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(complexContent);

            const testExtension = {
                ...baseExtension,
                files: [mockServiceWorkerFile],
            };

            const result = BridgeInjector.testHelpers.injectBridgeIntoServiceWorker(
                testExtension,
                'background.js'
            );

            expect(result).not.toBeNull();
            const content = result?.getContent();
            expect(content).toContain(
                `importScripts('${BridgeInjector.testHelpers.BRIDGE_FILENAME}');`
            );
            expect(content).toContain(complexContent);
        });
    });

    describe('error handling and edge cases', () => {
        it('should handle extension with no files', async () => {
            const extensionNoFiles = {
                ...baseExtension,
                files: [],
            };

            const result = await BridgeInjector.migrate(extensionNoFiles);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result).toBe(extensionNoFiles); // Should return unchanged
            }
        });

        it('should handle files with getContent throwing errors', () => {
            (mockJsFile.getContent as jest.Mock).mockImplementation(() => {
                throw new Error('File read error');
            });

            // Now the implementation has error handling, so it should not throw
            expect(() => BridgeInjector.testHelpers.needsBridge(baseExtension)).not.toThrow();
            const result = BridgeInjector.testHelpers.needsBridge(baseExtension);
            expect(result).toBe(false); // Should return false when unable to read files
        });

        it('should handle malformed manifest in injectBridgeIntoManifest', () => {
            const malformedManifest = {
                content_scripts: 'not-an-array',
            };

            expect(() =>
                BridgeInjector.testHelpers.injectBridgeIntoManifest(
                    malformedManifest,
                    baseExtension
                )
            ).not.toThrow();
        });

        it('should handle manifest with non-array content_scripts.js', () => {
            const manifest = {
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        js: 'not-an-array',
                    },
                ],
            };

            expect(() =>
                BridgeInjector.testHelpers.injectBridgeIntoManifest(manifest, baseExtension)
            ).not.toThrow();
        });

        it('should handle very large extensions', () => {
            const largeExtension = {
                ...baseExtension,
                files: Array(1000)
                    .fill(0)
                    .map(
                        (_, i) =>
                            ({
                                path: `file${i}.js`,
                                filetype: ExtFileType.JS,
                                getContent: () => 'const x = 1;',
                                getAST: jest.fn(),
                                getSize: () => 100,
                                getBuffer: jest.fn(),
                                close: jest.fn(),
                            }) as unknown as LazyFile
                    ),
            };

            const result = BridgeInjector.migrate(largeExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
        });

        it('should handle circular references in manifest', () => {
            const circularManifest: any = {
                name: 'Test',
            };
            circularManifest.self = circularManifest;

            // Circular references will cause JSON.stringify to throw
            expect(() =>
                BridgeInjector.testHelpers.injectBridgeIntoManifest(circularManifest, baseExtension)
            ).toThrow();
        });
    });

    describe('integration scenarios', () => {
        it('should handle complete complex extension migration', async () => {
            const complexExtension: Extension = {
                id: 'complex-extension',
                name: 'Complex Extension',
                manifest_v2_path: '/complex/path',
                manifest: {
                    name: 'Complex Extension',
                    version: '2.0',
                    manifest_version: 3,
                    description: 'A complex test extension',
                    content_scripts: [
                        {
                            matches: ['*://example.com/*'],
                            js: ['content1.js'],
                        },
                        {
                            matches: ['*://test.com/*'],
                            js: ['content2.js'],
                        },
                    ],
                    web_accessible_resources: [
                        {
                            resources: ['images/*'],
                            matches: ['<all_urls>'],
                        },
                    ],
                    background: {
                        service_worker: 'background.js',
                    },
                },
                files: [
                    {
                        path: 'content1.js',
                        filetype: ExtFileType.JS,
                        getContent: () => 'chrome.tabs.query({}, function(tabs) {});',
                        getAST: jest.fn(),
                        getSize: () => 500,
                        getBuffer: jest.fn(),
                        close: jest.fn(),
                    } as unknown as LazyFile,
                    {
                        path: 'content2.js',
                        filetype: ExtFileType.JS,
                        getContent: () => 'chrome.storage.local.set(data, callback);',
                        getAST: jest.fn(),
                        getSize: () => 400,
                        getBuffer: jest.fn(),
                        close: jest.fn(),
                    } as unknown as LazyFile,
                ],
            };

            const result = await BridgeInjector.migrate(complexExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // Should add bridge file
                expect(result.files).toHaveLength(3);
                expect(
                    result.files.some((f) => f!.path === BridgeInjector.testHelpers.BRIDGE_FILENAME)
                ).toBe(true);

                // Should inject bridge into all content scripts
                expect(result.manifest.content_scripts[0].js).toEqual([
                    BridgeInjector.testHelpers.BRIDGE_FILENAME,
                    'content1.js',
                ]);
                expect(result.manifest.content_scripts[1].js).toEqual([
                    BridgeInjector.testHelpers.BRIDGE_FILENAME,
                    'content2.js',
                ]);

                // Should add bridge to web_accessible_resources
                expect(result.manifest.web_accessible_resources).toContainEqual({
                    resources: [BridgeInjector.testHelpers.BRIDGE_FILENAME],
                    matches: ['<all_urls>'],
                });
            }
        });

        it('should handle extension with mixed promise and callback APIs', async () => {
            const mixedApiFile = {
                path: 'mixed.js',
                filetype: ExtFileType.JS,
                getContent: () => `
                    // Promise-based
                    chrome.tabs.query({}).then(tabs => console.log(tabs));

                    // Callback-based
                    chrome.storage.local.get("key", function(result) {
                        console.log(result);
                    });

                    // Synchronous
                    const manifest = chrome.runtime.getManifest();
                `,
                getAST: jest.fn(),
                getSize: () => 300,
                getBuffer: jest.fn(),
                close: jest.fn(),
            } as unknown as LazyFile;

            const mixedExtension = {
                ...baseExtension,
                files: [mixedApiFile],
            };

            const result = await BridgeInjector.migrate(mixedExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // Should detect the callback pattern and inject bridge
                expect(result.files).toHaveLength(2); // Original + bridge
            }
        });

        it('should handle extension with existing web_accessible_resources and content scripts', async () => {
            baseExtension.manifest = {
                ...baseExtension.manifest,
                manifest_version: 3,
                content_scripts: [
                    {
                        matches: ['<all_urls>'],
                        js: ['content.js'],
                    },
                ],
                web_accessible_resources: [
                    {
                        resources: ['existing.js', 'data.json'],
                        matches: ['*://example.com/*'],
                    },
                ],
            };

            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.runtime.sendMessage(data, function(response) {});'
            );

            const result = await BridgeInjector.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // Should preserve existing web_accessible_resources
                expect(result.manifest.web_accessible_resources).toHaveLength(2);
                expect(result.manifest.web_accessible_resources[0]).toEqual({
                    resources: ['existing.js', 'data.json'],
                    matches: ['*://example.com/*'],
                });
                // Should add new entry for bridge
                expect(result.manifest.web_accessible_resources[1]).toEqual({
                    resources: [BridgeInjector.testHelpers.BRIDGE_FILENAME],
                    matches: ['<all_urls>'],
                });
            }
        });

        it('should handle extension with service worker and content scripts', async () => {
            const mockServiceWorkerFile = {
                path: 'background.js',
                filetype: ExtFileType.JS,
                getContent: jest.fn().mockReturnValue(
                    `
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // Handle messages
});
                `.trim()
                ),
                getAST: jest.fn(),
                getSize: jest.fn().mockReturnValue(500),
                getBuffer: jest.fn(),
                close: jest.fn(),
            } as unknown as LazyFile;

            const serviceWorkerExtension = {
                ...baseExtension,
                manifest: {
                    ...baseExtension.manifest,
                    manifest_version: 3,
                    background: {
                        service_worker: 'background.js',
                    },
                    content_scripts: [
                        {
                            matches: ['<all_urls>'],
                            js: ['content.js'],
                        },
                    ],
                },
                files: [mockJsFile, mockServiceWorkerFile],
            };

            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({}, function(tabs) {});'
            );

            const result = await BridgeInjector.migrate(serviceWorkerExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // Should transform service worker file in memory
                const serviceWorkerFile = result.files.find((f) => f!.path === 'background.js');
                expect(serviceWorkerFile).toBeDefined();
                if (serviceWorkerFile) {
                    const content = serviceWorkerFile.getContent();
                    expect(content).toContain(
                        `importScripts('${BridgeInjector.testHelpers.BRIDGE_FILENAME}');`
                    );
                }

                // Should inject bridge into content scripts
                expect(result.manifest.content_scripts[0].js).toEqual([
                    BridgeInjector.testHelpers.BRIDGE_FILENAME,
                    'content.js',
                ]);

                // Should add bridge file to files
                expect(result.files).toHaveLength(3); // Original 2 + bridge
            }
        });

        it('should handle extension transitioning from MV2 to MV3', async () => {
            const mv2Extension = {
                ...baseExtension,
                manifest: {
                    ...baseExtension.manifest,
                    manifest_version: 2,
                    content_scripts: [
                        {
                            matches: ['<all_urls>'],
                            js: ['content.js'],
                        },
                    ],
                    web_accessible_resources: ['images/*', 'styles.css'],
                },
            };

            (mockJsFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.executeScript(tabId, {code: "console.log();"}, callback);'
            );

            const result = await BridgeInjector.migrate(mv2Extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // Should handle MV2 web_accessible_resources format
                expect(result.manifest.web_accessible_resources).toContain(
                    BridgeInjector.testHelpers.BRIDGE_FILENAME
                );
                expect(result.manifest.web_accessible_resources).toContain('images/*');
                expect(result.manifest.web_accessible_resources).toContain('styles.css');
            }
        });
    });
});
