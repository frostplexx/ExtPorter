import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { find_extensions } from '../../../migrator/utils/find_extensions';
import { ExtFileType } from '../../../migrator/types/ext_file_types';

describe('find_extensions', () => {
    const testDir = path.join(process.env.TEST_OUTPUT_DIR!, 'find_extensions_test');

    beforeEach(() => {
        fs.ensureDirSync(testDir);
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.removeSync(testDir);
        }
    });

    describe('when path does not exist', () => {
        it('should return empty array and log error', () => {
            const nonExistentPath = path.join(testDir, 'non-existent');
            const result = find_extensions(nonExistentPath);

            expect(result).toEqual([]);
        });
    });

    describe('when path is a directory with manifest.json', () => {
        it('should find single extension with valid manifest', () => {
            const extensionDir = path.join(testDir, 'test-extension');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'Test Extension',
                version: '1.0',
                manifest_version: 2,
                description: 'A test extension',
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);
            fs.writeFileSync(path.join(extensionDir, 'content.js'), 'console.log("test");');
            fs.writeFileSync(path.join(extensionDir, 'style.css'), 'body { color: red; }');

            const result = find_extensions(extensionDir);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Test Extension');
            expect(result[0].manifest).toEqual(manifest);
            expect(result[0].files).toHaveLength(2); // content.js and style.css
            expect(result[0].id).toBeDefined();
            expect(result[0].id).toMatch(/^[a-z]{32}$/); // 32 lowercase letters
        });

        it('should handle localized extension names', () => {
            const extensionDir = path.join(testDir, 'localized-extension');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: '__MSG_name__',
                version: '1.0',
                manifest_version: 2,
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            // Create locales directory
            const localesDir = path.join(extensionDir, '_locales', 'en_US');
            fs.ensureDirSync(localesDir);

            const messages = {
                name: {
                    message: 'Localized Extension Name',
                },
            };

            fs.writeJsonSync(path.join(localesDir, 'messages.json'), messages);

            const result = find_extensions(extensionDir);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Localized Extension Name');
        });

        it('should skip manifest v3 extensions by default', () => {
            const extensionDir = path.join(testDir, 'mv3-extension');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'MV3 Extension',
                version: '1.0',
                manifest_version: 3,
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            const result = find_extensions(extensionDir);
            expect(result).toHaveLength(0);
        });

        it('should include manifest v3 extensions when includes_mv3 is true', () => {
            const extensionDir = path.join(testDir, 'mv3-extension');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'MV3 Extension',
                version: '1.0',
                manifest_version: 3,
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            const result = find_extensions(extensionDir, true);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('MV3 Extension');
        });

        it('should skip Chrome Apps (deprecated)', () => {
            const extensionDir = path.join(testDir, 'chrome-app');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'Test Chrome App',
                version: '1.0',
                manifest_version: 2,
                app: {
                    background: {
                        scripts: ['background.js'],
                    },
                },
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            const result = find_extensions(extensionDir);
            expect(result).toHaveLength(0);
        });

        it('should skip Chrome Apps even when includes_mv3 is true', () => {
            const extensionDir = path.join(testDir, 'chrome-app-mv3');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'Test Chrome App MV3',
                version: '1.0',
                manifest_version: 2,
                app: {
                    background: {
                        scripts: ['background.js'],
                    },
                },
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            const result = find_extensions(extensionDir, true);
            expect(result).toHaveLength(0);
        });

        it('should identify new tab extensions correctly', () => {
            const extensionDir = path.join(testDir, 'newtab-extension');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'New Tab Extension',
                version: '1.0',
                manifest_version: 2,
                chrome_url_overrides: {
                    newtab: 'newtab.html',
                },
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            const result = find_extensions(extensionDir);
            expect(result).toHaveLength(1);
            expect(result[0].isNewTabExtension).toBe(true);
        });

        it('should identify theme extensions correctly', () => {
            const extensionDir = path.join(testDir, 'theme-extension');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'Theme Extension',
                version: '1.0',
                manifest_version: 2,
                theme: {
                    colors: {
                        frame: [255, 0, 0],
                        tab_background_text: [0, 0, 0],
                    },
                },
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            const result = find_extensions(extensionDir);
            expect(result).toHaveLength(1);
            expect(result[0].isThemeExtension).toBe(true);
        });

        it('should not identify regular extensions as themes', () => {
            const extensionDir = path.join(testDir, 'regular-extension');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'Regular Extension',
                version: '1.0',
                manifest_version: 2,
                background: {
                    scripts: ['background.js'],
                },
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            const result = find_extensions(extensionDir);
            expect(result).toHaveLength(1);
            expect(result[0].isThemeExtension).toBe(false);
        });
    });

    describe('when path is a directory without manifest.json', () => {
        it('should search subdirectories recursively', () => {
            const rootDir = path.join(testDir, 'extensions-root');
            fs.ensureDirSync(rootDir);

            // Create first extension
            const ext1Dir = path.join(rootDir, 'extension1');
            fs.ensureDirSync(ext1Dir);
            fs.writeJsonSync(path.join(ext1Dir, 'manifest.json'), {
                name: 'Extension 1',
                version: '1.0',
                manifest_version: 2,
            });

            // Create second extension in subdirectory
            const ext2Dir = path.join(rootDir, 'subdir', 'extension2');
            fs.ensureDirSync(ext2Dir);
            fs.writeJsonSync(path.join(ext2Dir, 'manifest.json'), {
                name: 'Extension 2',
                version: '1.0',
                manifest_version: 2,
            });

            const result = find_extensions(rootDir);

            expect(result).toHaveLength(2);
            const names = result.map((ext) => ext.name).sort();
            expect(names).toEqual(['Extension 1', 'Extension 2']);
        });

        it('should filter Chrome Apps when searching recursively', () => {
            const rootDir = path.join(testDir, 'mixed-extensions-root');
            fs.ensureDirSync(rootDir);

            // Create regular extension
            const ext1Dir = path.join(rootDir, 'extension1');
            fs.ensureDirSync(ext1Dir);
            fs.writeJsonSync(path.join(ext1Dir, 'manifest.json'), {
                name: 'Regular Extension',
                version: '1.0',
                manifest_version: 2,
            });

            // Create Chrome App (should be filtered)
            const appDir = path.join(rootDir, 'chrome-app');
            fs.ensureDirSync(appDir);
            fs.writeJsonSync(path.join(appDir, 'manifest.json'), {
                name: 'Chrome App',
                version: '1.0',
                manifest_version: 2,
                app: {
                    background: {
                        scripts: ['background.js'],
                    },
                },
            });

            // Create another regular extension
            const ext2Dir = path.join(rootDir, 'extension2');
            fs.ensureDirSync(ext2Dir);
            fs.writeJsonSync(path.join(ext2Dir, 'manifest.json'), {
                name: 'Another Extension',
                version: '1.0',
                manifest_version: 2,
            });

            const result = find_extensions(rootDir);

            // Should only find the 2 regular extensions, not the Chrome App
            expect(result).toHaveLength(2);
            const names = result.map((ext) => ext.name).sort();
            expect(names).toEqual(['Another Extension', 'Regular Extension']);
        });
    });

    describe('file type detection', () => {
        it('should correctly categorize different file types', () => {
            const extensionDir = path.join(testDir, 'filetype-extension');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'File Type Test',
                version: '1.0',
                manifest_version: 2,
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            // Create different file types
            fs.writeFileSync(path.join(extensionDir, 'script.js'), 'console.log("js");');
            fs.writeFileSync(path.join(extensionDir, 'style.css'), 'body { color: red; }');
            fs.writeFileSync(path.join(extensionDir, 'popup.html'), '<html></html>');
            fs.writeFileSync(path.join(extensionDir, 'data.json'), '{"key": "value"}');
            fs.writeFileSync(path.join(extensionDir, 'image.png'), 'fake image data');
            fs.writeFileSync(path.join(extensionDir, 'README.md'), '# Test'); // Should be skipped

            const result = find_extensions(extensionDir);

            expect(result).toHaveLength(1);
            const extension = result[0];

            expect(extension.files).toHaveLength(5); // Excludes README.md and manifest.json

            const jsFiles = extension.files.filter((f) => f.filetype === ExtFileType.JS);
            const cssFiles = extension.files.filter((f) => f.filetype === ExtFileType.CSS);
            const htmlFiles = extension.files.filter((f) => f.filetype === ExtFileType.HTML);
            const otherFiles = extension.files.filter((f) => f.filetype === ExtFileType.OTHER);

            expect(jsFiles).toHaveLength(1);
            expect(cssFiles).toHaveLength(1);
            expect(htmlFiles).toHaveLength(1);
            expect(otherFiles).toHaveLength(2); // json and png
        });

        it('should skip very small files', () => {
            const extensionDir = path.join(testDir, 'small-files-extension');
            fs.ensureDirSync(extensionDir);

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), {
                name: 'Small Files Test',
                version: '1.0',
                manifest_version: 2,
            });

            // Create very small file (less than 10 bytes)
            fs.writeFileSync(path.join(extensionDir, 'tiny.js'), 'x');
            // Create normal file
            fs.writeFileSync(path.join(extensionDir, 'normal.js'), 'console.log("test");');

            const result = find_extensions(extensionDir);

            expect(result).toHaveLength(1);
            expect(result[0].files).toHaveLength(1); // Only normal.js
            expect(result[0].files[0].path).toBe('normal.js');
        });
    });

    describe('error handling', () => {
        it('should handle invalid JSON in manifest', () => {
            const extensionDir = path.join(testDir, 'invalid-manifest');
            fs.ensureDirSync(extensionDir);

            fs.writeFileSync(path.join(extensionDir, 'manifest.json'), 'invalid json');

            const result = find_extensions(extensionDir);
            expect(result).toEqual([]);
        });

        it('should handle missing localization files gracefully', () => {
            const extensionDir = path.join(testDir, 'missing-locale');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: '__MSG_name__',
                version: '1.0',
                manifest_version: 2,
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            const result = find_extensions(extensionDir);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('name'); // Falls back to key name
        });
    });

    describe('extension ID generation', () => {
        it('should generate consistent IDs for the same path', () => {
            const extensionDir = path.join(testDir, 'id-test-extension');
            fs.ensureDirSync(extensionDir);

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), {
                name: 'ID Test',
                version: '1.0',
                manifest_version: 2,
            });

            const result1 = find_extensions(extensionDir);
            const result2 = find_extensions(extensionDir);

            expect(result1[0].id).toBe(result2[0].id);
        });

        it('should generate different IDs for different paths', () => {
            const extensionDir1 = path.join(testDir, 'extension1');
            const extensionDir2 = path.join(testDir, 'extension2');

            fs.ensureDirSync(extensionDir1);
            fs.ensureDirSync(extensionDir2);

            fs.writeJsonSync(path.join(extensionDir1, 'manifest.json'), {
                name: 'Extension 1',
                version: '1.0',
                manifest_version: 2,
            });

            fs.writeJsonSync(path.join(extensionDir2, 'manifest.json'), {
                name: 'Extension 2',
                version: '1.0',
                manifest_version: 2,
            });

            const result1 = find_extensions(extensionDir1);
            const result2 = find_extensions(extensionDir2);

            expect(result1[0].id).not.toBe(result2[0].id);
        });
    });

    describe('CWS info extraction', () => {
        it('should parse CWS info from store.html if present', () => {
            const extensionDir = path.join(testDir, 'extension-with-cws');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'Test Extension',
                version: '1.0',
                manifest_version: 2,
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            // Create a store.html with CWS data
            const cwsHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="This is a Chrome Web Store extension">
                </head>
                <body>
                    <div class="rsw-stars" title="4.5"></div>
                    <div class="q-N-O-k">1,000 ratings</div>
                    <div class="e-f-Me">Test Developer</div>
                </body>
                </html>
            `;

            fs.writeFileSync(path.join(extensionDir, 'store.html'), cwsHtml);

            const result = find_extensions(extensionDir);

            expect(result).toHaveLength(1);
            expect(result[0].cws_info).toBeDefined();
            expect(result[0].cws_info?.description).toBe('This is a Chrome Web Store extension');
            expect(result[0].cws_info?.rating).toBe(4.5);
            expect(result[0].cws_info?.rating_count).toBe(1000);
            expect(result[0].cws_info?.developer).toBe('Test Developer');
        });

        it('should have undefined cws_info if no HTML file present', () => {
            const extensionDir = path.join(testDir, 'extension-no-cws');
            fs.ensureDirSync(extensionDir);

            const manifest = {
                name: 'Test Extension',
                version: '1.0',
                manifest_version: 2,
            };

            fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), manifest);

            const result = find_extensions(extensionDir);

            expect(result).toHaveLength(1);
            expect(result[0].cws_info).toBeUndefined();
        });
    });
});
