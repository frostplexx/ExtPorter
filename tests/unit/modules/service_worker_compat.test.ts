import { describe, it, expect, beforeEach } from '@jest/globals';
import { ServiceWorkerCompat } from '../../../migrator/modules/service_worker_compat';
import { Extension } from '../../../migrator/types/extension';
import { LazyFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';
import { MigrationError } from '../../../migrator/types/migration_module';

describe('ServiceWorkerCompat', () => {
    let baseExtension: Extension;
    let mockServiceWorkerFile: LazyFile;

    beforeEach(() => {
        mockServiceWorkerFile = {
            path: 'background.js',
            filetype: ExtFileType.JS,
            getContent: () => '',
            getAST: () => undefined,
            getSize: () => 0,
            getBuffer: () => Buffer.from(''),
            close: () => {},
        } as LazyFile;

        baseExtension = {
            id: 'test-extension',
            name: 'Test Extension',
            manifest_v2_path: '/test/path',
            manifest: {
                name: 'Test Extension',
                version: '1.0',
                manifest_version: 3,
                background: {
                    service_worker: 'background.js',
                },
                permissions: [],
            },
            files: [mockServiceWorkerFile],
        };
    });

    describe('needsMigration', () => {
        it('should detect window.onload usage', () => {
            mockServiceWorkerFile.getContent = () => `
                window.onload = function() {
                    console.log('loaded');
                };
            `;

            const result = ServiceWorkerCompat.testHelpers.needsMigration(baseExtension);

            expect(result.needsFix).toBe(true);
            expect(result.hasWindowOnload).toBe(true);
        });

        it('should detect localStorage.getItem', () => {
            mockServiceWorkerFile.getContent = () => `
                const data = localStorage.getItem('key');
            `;

            const result = ServiceWorkerCompat.testHelpers.needsMigration(baseExtension);

            expect(result.needsFix).toBe(true);
            expect(result.hasLocalStorage).toBe(true);
        });

        it('should detect localStorage.setItem', () => {
            mockServiceWorkerFile.getContent = () => `
                localStorage.setItem('key', 'value');
            `;

            const result = ServiceWorkerCompat.testHelpers.needsMigration(baseExtension);

            expect(result.needsFix).toBe(true);
            expect(result.hasLocalStorage).toBe(true);
        });

        it('should detect DOM download pattern', () => {
            mockServiceWorkerFile.getContent = () => `
                function download() {
                    var pom = document.createElement('a');
                    var blob = new Blob(['data'], {type: 'text/csv'});
                    var url = URL.createObjectURL(blob);
                    pom.href = url;
                    pom.download = 'file.csv';
                    pom.click();
                }
            `;

            const result = ServiceWorkerCompat.testHelpers.needsMigration(baseExtension);

            expect(result.needsFix).toBe(true);
            expect(result.hasDOMDownload).toBe(true);
        });

        it('should return false for MV2 extensions', () => {
            baseExtension.manifest.manifest_version = 2;

            const result = ServiceWorkerCompat.testHelpers.needsMigration(baseExtension);

            expect(result.needsFix).toBe(false);
        });

        it('should return false when no service worker', () => {
            delete baseExtension.manifest.background;

            const result = ServiceWorkerCompat.testHelpers.needsMigration(baseExtension);

            expect(result.needsFix).toBe(false);
        });

        it('should return false for clean service worker', () => {
            mockServiceWorkerFile.getContent = () => `
                chrome.runtime.onMessage.addListener((msg) => {
                    console.log(msg);
                });
            `;

            const result = ServiceWorkerCompat.testHelpers.needsMigration(baseExtension);

            expect(result.needsFix).toBe(false);
        });
    });

    describe('replaceWindowOnload', () => {
        it('should replace window.onload with IIFE', () => {
            const input = `
window.onload = function() {
    initializeApp();
};
            `;

            const result = ServiceWorkerCompat.testHelpers.replaceWindowOnload(input);

            expect(result).toContain('(async function initializeServiceWorker() {');
            expect(result).not.toContain('window.onload');
        });

        it('should handle window.onload with parameters', () => {
            const input = `
window.onload = function(event) {
    console.log(event);
};
            `;

            const result = ServiceWorkerCompat.testHelpers.replaceWindowOnload(input);

            expect(result).toContain('(async function initializeServiceWorker() {');
        });
    });

    describe('replaceLocalStorage', () => {
        it('should add storage helper', () => {
            const input = `localStorage.getItem('test');`;

            const result = ServiceWorkerCompat.testHelpers.replaceLocalStorage(input);

            expect(result).toContain('storageHelper');
            expect(result).toContain('async get(key)');
            expect(result).toContain('async set(key, value)');
        });

        it('should replace localStorage.getItem', () => {
            const input = `const value = localStorage.getItem('myKey');`;

            const result = ServiceWorkerCompat.testHelpers.replaceLocalStorage(input);

            expect(result).toContain(`await storageHelper.get('myKey')`);
            expect(result).not.toContain('localStorage.getItem');
        });

        it('should replace localStorage.setItem', () => {
            const input = `localStorage.setItem('myKey', 'myValue');`;

            const result = ServiceWorkerCompat.testHelpers.replaceLocalStorage(input);

            expect(result).toContain(`await storageHelper.set('myKey', 'myValue')`);
        });

        it('should handle JSON.stringify in setItem', () => {
            const input = `localStorage.setItem('data', JSON.stringify(obj));`;

            const result = ServiceWorkerCompat.testHelpers.replaceLocalStorage(input);

            expect(result).toContain(`await storageHelper.set('data', obj)`);
            expect(result).not.toContain('JSON.stringify');
        });

        it('should replace localStorage.removeItem', () => {
            const input = `localStorage.removeItem('myKey');`;

            const result = ServiceWorkerCompat.testHelpers.replaceLocalStorage(input);

            expect(result).toContain(`await storageHelper.remove('myKey')`);
        });

        it('should replace localStorage.clear', () => {
            const input = `localStorage.clear();`;

            const result = ServiceWorkerCompat.testHelpers.replaceLocalStorage(input);

            expect(result).toContain('await storageHelper.clear()');
        });

        it('should preserve importScripts placement', () => {
            const input = `importScripts('lib.js');\nlocalStorage.getItem('test');`;

            const result = ServiceWorkerCompat.testHelpers.replaceLocalStorage(input);

            const importIndex = result.indexOf('importScripts');
            const helperIndex = result.indexOf('storageHelper');

            expect(importIndex).toBeLessThan(helperIndex);
        });

        it('should not duplicate storage helper', () => {
            const input = `
const storageHelper = {};
localStorage.getItem('test');
            `;

            const result = ServiceWorkerCompat.testHelpers.replaceLocalStorage(input);

            const matches = result.match(/const storageHelper/g);
            expect(matches).toHaveLength(1);
        });
    });

    describe('replaceDOMDownloads', () => {
        it('should replace DOM download with chrome.downloads', () => {
            const input = `
function exportCSV() {
    var pom = document.createElement('a');
    var blob = new Blob([csvData], {type: 'text/csv;charset=utf-8;'});
    var url = URL.createObjectURL(blob);
    pom.href = url;
    pom.setAttribute('download', fileName);
    pom.click();
}
            `;

            const result = ServiceWorkerCompat.testHelpers.replaceDOMDownloads(input);

            expect(result).toContain('async function exportCSV');
            expect(result).toContain('chrome.downloads.download');
            expect(result).toContain('data:text/csv');
            expect(result).not.toContain('document.createElement');
        });

        it('should make function async if not already', () => {
            const input = `
function download() {
    var pom = document.createElement('a');
    var blob = new Blob([data], {type: 'text/plain'});
    var url = URL.createObjectURL(blob);
    pom.href = url;
    pom.setAttribute('download', 'file.txt');
    pom.click();
}
            `;

            const result = ServiceWorkerCompat.testHelpers.replaceDOMDownloads(input);

            expect(result).toContain('async function download');
        });

        it('should preserve already async functions', () => {
            const input = `
async function download() {
    var pom = document.createElement('a');
    var blob = new Blob([data], {type: 'application/json'});
    var url = URL.createObjectURL(blob);
    pom.href = url;
    pom.setAttribute('download', 'data.json');
    pom.click();
}
            `;

            const result = ServiceWorkerCompat.testHelpers.replaceDOMDownloads(input);

            expect(result).toContain('async function download');
            expect(result).toContain('chrome.downloads.download');
        });
    });

    describe('updateManifest', () => {
        it('should add storage permission for localStorage', () => {
            const manifest = {
                manifest_version: 3,
                permissions: [],
            };

            const result = ServiceWorkerCompat.testHelpers.updateManifest(manifest, {
                hasLocalStorage: true,
                hasDOMDownload: false,
            });

            expect(result.permissions).toContain('storage');
        });

        it('should add downloads permission for DOM downloads', () => {
            const manifest = {
                manifest_version: 3,
                permissions: [],
            };

            const result = ServiceWorkerCompat.testHelpers.updateManifest(manifest, {
                hasLocalStorage: false,
                hasDOMDownload: true,
            });

            expect(result.permissions).toContain('downloads');
        });

        it('should add both permissions when needed', () => {
            const manifest = {
                manifest_version: 3,
                permissions: [],
            };

            const result = ServiceWorkerCompat.testHelpers.updateManifest(manifest, {
                hasLocalStorage: true,
                hasDOMDownload: true,
            });

            expect(result.permissions).toContain('storage');
            expect(result.permissions).toContain('downloads');
        });

        it('should not duplicate existing permissions', () => {
            const manifest = {
                manifest_version: 3,
                permissions: ['storage', 'downloads'],
            };

            const result = ServiceWorkerCompat.testHelpers.updateManifest(manifest, {
                hasLocalStorage: true,
                hasDOMDownload: true,
            });

            expect(result.permissions.filter((p: string) => p === 'storage')).toHaveLength(1);
            expect(result.permissions.filter((p: string) => p === 'downloads')).toHaveLength(1);
        });

        it('should create permissions array if missing', () => {
            const manifest = {
                manifest_version: 3,
            };

            const result = ServiceWorkerCompat.testHelpers.updateManifest(manifest, {
                hasLocalStorage: true,
                hasDOMDownload: false,
            });

            expect(result.permissions).toBeDefined();
            expect(Array.isArray(result.permissions)).toBe(true);
        });
    });

    describe('migrate', () => {
        it('should return extension unchanged if no fixes needed', async () => {
            mockServiceWorkerFile.getContent = () => `
                chrome.runtime.onMessage.addListener(() => {});
            `;

            const result = await ServiceWorkerCompat.migrate(baseExtension);

            expect(result).toBe(baseExtension);
        });

        it('should migrate extension with window.onload', async () => {
            mockServiceWorkerFile.getContent = () => `
window.onload = function() {
    console.log('init');
};
            `;

            const result = await ServiceWorkerCompat.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const swFile = result.files.find((f) => f.path === 'background.js');
                expect(swFile).toBeDefined();
                const content = swFile!.getContent();
                expect(content).toContain('async function initializeServiceWorker');
                expect(content).not.toContain('window.onload');
            }
        });

        it('should migrate extension with localStorage', async () => {
            mockServiceWorkerFile.getContent = () => `
localStorage.setItem('key', 'value');
const val = localStorage.getItem('key');
            `;

            const result = await ServiceWorkerCompat.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const swFile = result.files.find((f) => f.path === 'background.js');
                const content = swFile!.getContent();
                expect(content).toContain('storageHelper');
                expect(content).toContain('await storageHelper.set');
                expect(result.manifest.permissions).toContain('storage');
            }
        });

        it('should migrate extension with DOM downloads', async () => {
            mockServiceWorkerFile.getContent = () => `
function exportFile() {
    var pom = document.createElement('a');
    var blob = new Blob(['test'], {type: 'text/plain'});
    var url = URL.createObjectURL(blob);
    pom.href = url;
    pom.setAttribute('download', 'test.txt');
    pom.click();
}
            `;

            const result = await ServiceWorkerCompat.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const swFile = result.files.find((f) => f.path === 'background.js');
                const content = swFile!.getContent();
                expect(content).toContain('chrome.downloads.download');
                expect(result.manifest.permissions).toContain('downloads');
            }
        });

        it('should handle all issues together', async () => {
            mockServiceWorkerFile.getContent = () => `
window.onload = function() {
    localStorage.setItem('init', 'true');
};

function exportData() {
    const data = localStorage.getItem('data');
    var pom = document.createElement('a');
    var blob = new Blob([data], {type: 'text/plain'});
    var url = URL.createObjectURL(blob);
    pom.href = url;
    pom.setAttribute('download', 'export.txt');
    pom.click();
}
            `;

            const result = await ServiceWorkerCompat.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                const swFile = result.files.find((f) => f.path === 'background.js');
                const content = swFile!.getContent();

                expect(content).toContain('async function initializeServiceWorker');
                expect(content).toContain('storageHelper');
                expect(content).toContain('chrome.downloads.download');

                expect(result.manifest.permissions).toContain('storage');
                expect(result.manifest.permissions).toContain('downloads');
            }
        });

        it('should skip MV2 extensions', async () => {
            baseExtension.manifest.manifest_version = 2;

            const result = await ServiceWorkerCompat.migrate(baseExtension);

            expect(result).toBe(baseExtension);
        });

        it('should handle missing service worker gracefully', async () => {
            delete baseExtension.manifest.background;

            const result = await ServiceWorkerCompat.migrate(baseExtension);

            expect(result).toBe(baseExtension);
        });
    });
});
