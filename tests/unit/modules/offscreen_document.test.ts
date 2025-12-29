import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { OffscreenDocumentMigrator } from '../../../migrator/modules/offscreen_documents';
import { Extension } from '../../../migrator/types/extension';
import { MigrationError } from '../../../migrator/types/migration_module';
import { LazyFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';

jest.mock('../../../migrator/utils/logger', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

describe('OffscreenDocumentMigrator', () => {
    let baseExtension: Extension;
    let mockServiceWorkerFile: LazyFile;
    let mockOtherFile: LazyFile;

    beforeEach(() => {
        jest.clearAllMocks();

        mockServiceWorkerFile = {
            path: 'background.js',
            filetype: ExtFileType.JS,
            getContent: jest.fn(),
            getAST: jest.fn(),
            getSize: jest.fn().mockReturnValue(1000),
            getBuffer: jest.fn(),
            close: jest.fn(),
        } as unknown as LazyFile;

        mockOtherFile = {
            path: 'content.js',
            filetype: ExtFileType.JS,
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
                manifest_version: 3,
                description: 'A test extension',
                background: {
                    service_worker: 'background.js',
                },
            },
            files: [mockServiceWorkerFile, mockOtherFile],
        };
    });

    describe('migrate', () => {
        it('should add offscreen document for service worker with DOM access', async () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'const element = document.getElementById("test");'
            );

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.files).toHaveLength(4);
                expect(
                    result.files.some(
                        (f) =>
                            f!.path === OffscreenDocumentMigrator.testHelpers.OFFSCREEN_HTML_FILENAME
                    )
                ).toBe(true);
                expect(
                    result.files.some(
                        (f) =>
                            f!.path === OffscreenDocumentMigrator.testHelpers.OFFSCREEN_JS_FILENAME
                    )
                ).toBe(true);
            }
        });

        it('should add offscreen permission to manifest', async () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'document.querySelector(".test");'
            );

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.manifest.permissions).toContain('offscreen');
            }
        });

        it('should inject offscreen helpers into service worker', async () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'console.log(document.title);'
            );

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const serviceWorkerFile = result.files.find((f) => f!.path === 'background.js');
                expect(serviceWorkerFile).toBeDefined();
                if (serviceWorkerFile) {
                    const content = serviceWorkerFile.getContent();
                    expect(content).toContain('ensureOffscreenDocument');
                    expect(content).toContain('sendToOffscreen');
                }
            }
        });

        it('should return unchanged extension when no DOM access detected', async () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({}, () => {});'
            );

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.files).toHaveLength(2);
                expect(result).toBe(baseExtension);
            }
        });

        it('should return unchanged when offscreen document already exists', async () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'document.createElement("div");'
            );

            const offscreenHTMLFile = {
                path: OffscreenDocumentMigrator.testHelpers.OFFSCREEN_HTML_FILENAME,
                filetype: ExtFileType.HTML,
            } as LazyFile;

            baseExtension.files.push(offscreenHTMLFile);

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result).toBe(baseExtension);
                expect(result.files).toHaveLength(3);
            }
        });

        it('should return unchanged when no service worker exists', async () => {
            delete baseExtension.manifest.background;

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result).toBe(baseExtension);
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

            const result = await OffscreenDocumentMigrator.migrate(invalidExtension);

            expect(result).toBeInstanceOf(MigrationError);
            if (result instanceof MigrationError) {
                expect(result.extension).toBe(invalidExtension);
                expect(result.error).toBeDefined();
            }
        });

        it('should add OFFSCREEN_DOCUMENT_ADDED tag', async () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'const el = document.getElementById("test");' // Actual DOM access that needs offscreen
            );

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.tags).toContain('OFFSCREEN_DOCUMENT_ADDED');
            }
        });

        it('should handle service worker with multiple DOM access patterns', async () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(`
                const el = document.getElementById("test");
                window.localStorage.setItem("key", "value");
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
            `);

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.files).toHaveLength(4);
                expect(result.manifest.permissions).toContain('offscreen');
            }
        });

        it('should preserve existing permissions when adding offscreen', async () => {
            baseExtension.manifest.permissions = ['storage', 'tabs'];
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'document.body.appendChild(element);'
            );

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.manifest.permissions).toContain('storage');
                expect(result.manifest.permissions).toContain('tabs');
                expect(result.manifest.permissions).toContain('offscreen');
            }
        });

        it('should not duplicate offscreen permission if already exists', async () => {
            baseExtension.manifest.permissions = ['offscreen', 'storage'];
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'document.querySelector("div");'
            );

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const offscreenCount = result.manifest.permissions.filter(
                    (p: string) => p === 'offscreen'
                ).length;
                expect(offscreenCount).toBe(1);
            }
        });
    });

    describe('containsDOMAccess helper', () => {
        it('should detect document.getElementById', () => {
            const code = 'const el = document.getElementById("test");';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should detect document.querySelector', () => {
            const code = 'const el = document.querySelector(".test");';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should detect document.createElement', () => {
            const code = 'const div = document.createElement("div");';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should detect window.localStorage', () => {
            const code = 'window.localStorage.setItem("key", "value");';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should detect window.sessionStorage', () => {
            const code = 'const data = window.sessionStorage.getItem("key");';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should detect canvas operations', () => {
            const code = 'const ctx = canvas.getContext("2d");';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should detect DOMParser', () => {
            const code = 'const parser = new DOMParser();';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should detect Audio constructor', () => {
            const code = 'const audio = new Audio("sound.mp3");';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should detect addEventListener', () => {
            const code = 'element.addEventListener("click", handler);';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should detect innerHTML assignment', () => {
            const code = 'element.innerHTML = "<div>test</div>";';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should detect appendChild', () => {
            const code = 'parent.appendChild(child);';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should not detect chrome.windows API', () => {
            const code = 'chrome.windows.create({url: "https://example.com"});';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(false);
        });

        it('should not detect chrome APIs without DOM access', () => {
            const code = 'chrome.tabs.query({active: true}, callback);';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(false);
        });

        it('should not detect regular JavaScript without DOM', () => {
            const code = 'const data = { key: "value" }; console.log(data);';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(false);
        });

        it('should ignore DOM access in executeScript injected code', () => {
            const code = `
                chrome.tabs.executeScript(tabId, {
                    code: 'document.body.style.backgroundColor = "red";'
                }, callback);
            `;
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(false);
        });

        it('should detect DOM access outside of executeScript', () => {
            const code = `
                const title = document.title;
                chrome.tabs.executeScript(tabId, {
                    code: 'document.body.style.backgroundColor = "red";'
                }, callback);
            `;
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });

        it('should handle empty string', () => {
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess('')).toBe(false);
        });

        it('should detect multiple DOM patterns in same file', () => {
            const code = `
                const el = document.getElementById("test");
                window.localStorage.setItem("key", "value");
                const canvas = document.createElement("canvas");
            `;
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(true);
        });
    });

    describe('needsOffscreenDocument helper', () => {
        it('should return true for service worker with DOM access', () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'document.getElementById("test");'
            );

            const result =
                OffscreenDocumentMigrator.testHelpers.needsOffscreenDocument(baseExtension);
            expect(result).toBe(true);
        });

        it('should return false for service worker without DOM access', () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'chrome.tabs.query({}, () => {});'
            );

            const result =
                OffscreenDocumentMigrator.testHelpers.needsOffscreenDocument(baseExtension);
            expect(result).toBe(false);
        });

        it('should return false when no service worker exists', () => {
            delete baseExtension.manifest.background;

            const result =
                OffscreenDocumentMigrator.testHelpers.needsOffscreenDocument(baseExtension);
            expect(result).toBe(false);
        });

        it('should return false when service worker file not found', () => {
            baseExtension.files = [mockOtherFile];

            const result =
                OffscreenDocumentMigrator.testHelpers.needsOffscreenDocument(baseExtension);
            expect(result).toBe(false);
        });

        it('should return false when service worker is not JS file', () => {
            mockServiceWorkerFile.filetype = ExtFileType.HTML;

            const result =
                OffscreenDocumentMigrator.testHelpers.needsOffscreenDocument(baseExtension);
            expect(result).toBe(false);
        });

        it('should handle file read errors gracefully', () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockImplementation(() => {
                throw new Error('File read error');
            });

            const result =
                OffscreenDocumentMigrator.testHelpers.needsOffscreenDocument(baseExtension);
            expect(result).toBe(false);
        });
    });

    describe('createOffscreenHTML helper', () => {
        it('should create HTML file with correct structure', () => {
            const htmlFile = OffscreenDocumentMigrator.testHelpers.createOffscreenHTML();

            expect(htmlFile.path).toBe(
                OffscreenDocumentMigrator.testHelpers.OFFSCREEN_HTML_FILENAME
            );
            expect(htmlFile.filetype).toBe(ExtFileType.HTML);
        });

        it('should contain DOCTYPE and html tags', () => {
            const htmlFile = OffscreenDocumentMigrator.testHelpers.createOffscreenHTML();
            const content = htmlFile.getContent();

            expect(content).toContain('<!DOCTYPE html>');
            expect(content).toContain('<html>');
            expect(content).toContain('</html>');
        });

        it('should reference offscreen.js script', () => {
            const htmlFile = OffscreenDocumentMigrator.testHelpers.createOffscreenHTML();
            const content = htmlFile.getContent();

            expect(content).toContain(
                `<script src="${OffscreenDocumentMigrator.testHelpers.OFFSCREEN_JS_FILENAME}"></script>`
            );
        });

        it('should provide getSize method', () => {
            const htmlFile = OffscreenDocumentMigrator.testHelpers.createOffscreenHTML();
            expect(htmlFile.getSize()).toBeGreaterThan(0);
        });

        it('should provide close method that does nothing', () => {
            const htmlFile = OffscreenDocumentMigrator.testHelpers.createOffscreenHTML();
            expect(() => htmlFile.close()).not.toThrow();
        });
    });

    describe('createOffscreenJS helper', () => {
        it('should create JS file with correct structure', () => {
            const jsFile = OffscreenDocumentMigrator.testHelpers.createOffscreenJS();

            expect(jsFile.path).toBe(OffscreenDocumentMigrator.testHelpers.OFFSCREEN_JS_FILENAME);
            expect(jsFile.filetype).toBe(ExtFileType.JS);
        });

        it('should contain message listener', () => {
            const jsFile = OffscreenDocumentMigrator.testHelpers.createOffscreenJS();
            const content = jsFile.getContent();

            expect(content).toContain('chrome.runtime.onMessage.addListener');
        });

        it('should contain DOM operation handler', () => {
            const jsFile = OffscreenDocumentMigrator.testHelpers.createOffscreenJS();
            const content = jsFile.getContent();

            expect(content).toContain('handleDOMOperation');
            expect(content).toContain('DOM_OPERATION');
        });

        it('should contain canvas operation handler', () => {
            const jsFile = OffscreenDocumentMigrator.testHelpers.createOffscreenJS();
            const content = jsFile.getContent();

            expect(content).toContain('handleCanvasOperation');
            expect(content).toContain('CANVAS_OPERATION');
        });

        it('should contain audio operation handler', () => {
            const jsFile = OffscreenDocumentMigrator.testHelpers.createOffscreenJS();
            const content = jsFile.getContent();

            expect(content).toContain('handleAudioOperation');
            expect(content).toContain('AUDIO_OPERATION');
        });

        it('should check for target: offscreen in messages', () => {
            const jsFile = OffscreenDocumentMigrator.testHelpers.createOffscreenJS();
            const content = jsFile.getContent();

            expect(content).toContain("target !== 'offscreen'");
        });

        it('should provide getSize method', () => {
            const jsFile = OffscreenDocumentMigrator.testHelpers.createOffscreenJS();
            expect(jsFile.getSize()).toBeGreaterThan(0);
        });
    });

    describe('injectOffscreenHelpers helper', () => {
        it('should inject helper functions into service worker', () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'console.log("Service worker");'
            );

            const result = OffscreenDocumentMigrator.testHelpers.injectOffscreenHelpers(
                baseExtension,
                'background.js'
            );

            expect(result).not.toBeNull();
            if (result) {
                const content = result.getContent();
                expect(content).toContain('ensureOffscreenDocument');
                expect(content).toContain('sendToOffscreen');
                expect(content).toContain('console.log("Service worker");');
            }
        });

        it('should not duplicate helpers if already present', () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'function createOffscreenDocument() { }\nconsole.log("test");'
            );

            const result = OffscreenDocumentMigrator.testHelpers.injectOffscreenHelpers(
                baseExtension,
                'background.js'
            );

            expect(result).toBeNull();
        });

        it('should return null when service worker file not found', () => {
            const result = OffscreenDocumentMigrator.testHelpers.injectOffscreenHelpers(
                baseExtension,
                'missing.js'
            );

            expect(result).toBeNull();
        });

        it('should handle file read errors gracefully', () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockImplementation(() => {
                throw new Error('File read error');
            });

            const result = OffscreenDocumentMigrator.testHelpers.injectOffscreenHelpers(
                baseExtension,
                'background.js'
            );

            expect(result).toBeNull();
        });

        it('should reference correct offscreen.html filename in helpers', () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue('console.log("test");');

            const result = OffscreenDocumentMigrator.testHelpers.injectOffscreenHelpers(
                baseExtension,
                'background.js'
            );

            expect(result).not.toBeNull();
            if (result) {
                const content = result.getContent();
                expect(content).toContain(
                    `url: '${OffscreenDocumentMigrator.testHelpers.OFFSCREEN_HTML_FILENAME}'`
                );
            }
        });

        it('should include chrome.offscreen.createDocument call', () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue('console.log("test");');

            const result = OffscreenDocumentMigrator.testHelpers.injectOffscreenHelpers(
                baseExtension,
                'background.js'
            );

            expect(result).not.toBeNull();
            if (result) {
                const content = result.getContent();
                expect(content).toContain('chrome.offscreen.createDocument');
                expect(content).toContain('reasons:');
                expect(content).toContain('justification:');
            }
        });
    });

    describe('updateManifest helper', () => {
        it('should add offscreen permission to manifest', () => {
            const manifest = {
                name: 'Test',
                version: '1.0',
                permissions: ['storage'],
            };

            const result = OffscreenDocumentMigrator.testHelpers.updateManifest(manifest, {
                needsOffscreen: true,
            });

            expect(result.permissions).toContain('offscreen');
            expect(result.permissions).toContain('storage');
        });

        it('should not duplicate offscreen permission', () => {
            const manifest = {
                name: 'Test',
                version: '1.0',
                permissions: ['offscreen', 'storage'],
            };

            const result = OffscreenDocumentMigrator.testHelpers.updateManifest(manifest, {
                needsOffscreen: true,
            });

            const offscreenCount = result.permissions.filter(
                (p: string) => p === 'offscreen'
            ).length;
            expect(offscreenCount).toBe(1);
        });

        it('should create permissions array if not exists', () => {
            const manifest = {
                name: 'Test',
                version: '1.0',
            };

            const result = OffscreenDocumentMigrator.testHelpers.updateManifest(manifest, {
                needsOffscreen: true,
            });

            expect(result.permissions).toBeDefined();
            expect(result.permissions).toContain('offscreen');
        });

        it('should create deep copy of manifest', () => {
            const manifest = {
                name: 'Test',
                version: '1.0',
                permissions: ['storage'],
            };

            const result = OffscreenDocumentMigrator.testHelpers.updateManifest(manifest, {
                needsOffscreen: true,
            });

            expect(result).not.toBe(manifest);
            expect(result.permissions).not.toBe(manifest.permissions);
        });
    });

    describe('error handling and edge cases', () => {
        it('should handle extension with no files', async () => {
            baseExtension.files = [];

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result).toBe(baseExtension);
            }
        });

        it('should handle extension with background.scripts instead of service_worker', async () => {
            baseExtension.manifest.background = {
                scripts: ['background.js'],
            } as any;

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result).toBe(baseExtension);
            }
        });

        it('should handle service worker with only chrome.windows API', () => {
            const code = 'chrome.windows.create({url: "test.html"});';
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(false);
        });

        it('should handle complex executeScript patterns', () => {
            const code = `
                chrome.tabs.executeScript(tabId, {
                    code: \`
                        document.querySelectorAll('*').forEach((el, index) => {
                            if (index < 10) {
                                el.style.outline = '2px solid #ff6b6b';
                            }
                        });
                    \`
                });
            `;
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(false);
        });

        it('should handle chrome.scripting.executeScript patterns', () => {
            const code = `
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        document.body.style.backgroundColor = "red";
                    }
                });
            `;
            expect(OffscreenDocumentMigrator.testHelpers.containsDOMAccess(code)).toBe(false);
        });

        it('should measure and log performance metrics', async () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'document.getElementById("test");'
            );

            const startTime = Date.now();
            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            expect(Date.now() - startTime).toBeLessThan(1000);
        });
    });

    describe('integration scenarios', () => {
        it('should handle complete migration with all DOM patterns', async () => {
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(`
                const el = document.getElementById("test");
                const elements = document.querySelectorAll(".items");
                window.localStorage.setItem("key", "value");
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                const audio = new Audio("sound.mp3");
                element.addEventListener("click", handler);
            `);

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.files).toHaveLength(4);
                expect(result.manifest.permissions).toContain('offscreen');

                const htmlFile = result.files.find(
                    (f) => f!.path === OffscreenDocumentMigrator.testHelpers.OFFSCREEN_HTML_FILENAME
                );
                const jsFile = result.files.find(
                    (f) => f!.path === OffscreenDocumentMigrator.testHelpers.OFFSCREEN_JS_FILENAME
                );
                const serviceWorker = result.files.find((f) => f!.path === 'background.js');

                expect(htmlFile).toBeDefined();
                expect(jsFile).toBeDefined();
                expect(serviceWorker).toBeDefined();

                if (serviceWorker) {
                    const content = serviceWorker.getContent();
                    expect(content).toContain('ensureOffscreenDocument');
                    expect(content).toContain('sendToOffscreen');
                }
            }
        });

        it('should handle extension with existing permissions', async () => {
            baseExtension.manifest.permissions = ['storage', 'tabs', 'activeTab'];
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'document.createElement("div");'
            );

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.manifest.permissions).toHaveLength(4);
                expect(result.manifest.permissions).toContain('storage');
                expect(result.manifest.permissions).toContain('tabs');
                expect(result.manifest.permissions).toContain('activeTab');
                expect(result.manifest.permissions).toContain('offscreen');
            }
        });

        it('should not affect content scripts when adding offscreen document', async () => {
            baseExtension.manifest.content_scripts = [
                {
                    matches: ['<all_urls>'],
                    js: ['content.js'],
                },
            ];
            (mockServiceWorkerFile.getContent as jest.Mock).mockReturnValue(
                'document.body.innerHTML = "test";'
            );

            const result = await OffscreenDocumentMigrator.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
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
