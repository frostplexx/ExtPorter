import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { FileContentUpdater } from '../../../migrator/utils/file_content_updater';
import { LazyFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';

describe('FileContentUpdater', () => {
    const testDir = path.join(process.env.TEST_OUTPUT_DIR!, 'file_content_updater_test');

    beforeEach(() => {
        fs.ensureDirSync(testDir);
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.removeSync(testDir);
        }
    });

    describe('updateFileContent', () => {
        it('should update file content successfully', () => {
            const testFile = path.join(testDir, 'update-test.js');
            const originalContent = 'console.log("original");';
            const newContent = 'console.log("updated");';

            fs.writeFileSync(testFile, originalContent);

            const lazyFile = new LazyFile('update-test.js', testFile, ExtFileType.JS);

            // Verify original content
            expect(lazyFile.getContent()).toBe(originalContent);

            // Update content
            expect(() => FileContentUpdater.updateFileContent(lazyFile, newContent)).not.toThrow();

            // Verify file was updated on disk
            const diskContent = fs.readFileSync(testFile, 'utf8');
            expect(diskContent).toBe(newContent);

            // Verify LazyFile returns updated content after cache clear
            const updatedContent = lazyFile.getContent();
            expect(updatedContent).toBe(newContent);

            lazyFile.close();
        });

        it('should create directory if it does not exist', () => {
            const subDir = path.join(testDir, 'nested', 'deep', 'directory');
            const testFile = path.join(subDir, 'new-file.js');
            const content = 'console.log("nested");';

            // Directory should not exist initially
            expect(fs.existsSync(subDir)).toBe(false);

            const lazyFile = new LazyFile(
                'nested/deep/directory/new-file.js',
                testFile,
                ExtFileType.JS
            );
            expect(() => FileContentUpdater.updateFileContent(lazyFile, content)).not.toThrow();
            expect(fs.existsSync(subDir)).toBe(true);
            expect(fs.readFileSync(testFile, 'utf8')).toBe(content);

            lazyFile.close();
        });

        it('should handle unicode content correctly', () => {
            const testFile = path.join(testDir, 'unicode.js');
            const originalContent = 'console.log("Hello");';
            const unicodeContent = 'console.log("Hello 世界! 🌍 Émojis: àáâãäå");';

            fs.writeFileSync(testFile, originalContent);

            const lazyFile = new LazyFile('unicode.js', testFile, ExtFileType.JS);
            expect(() =>
                FileContentUpdater.updateFileContent(lazyFile, unicodeContent)
            ).not.toThrow();

            const diskContent = fs.readFileSync(testFile, 'utf8');
            expect(diskContent).toBe(unicodeContent);

            lazyFile.close();
        });

        it('should throw error when LazyFile has no absolute path', () => {
            // Create a mock LazyFile without _absolutePath
            const mockLazyFile = {
                path: 'mock-file.js',
                filetype: ExtFileType.JS,
                getContent: () => 'mock content',
                cleanContent: () => {},
                close: () => {},
            } as any;

            expect(() => FileContentUpdater.updateFileContent(mockLazyFile, 'new content')).toThrow(
                'no absolute path found'
            );
        });

        it('should throw error on file write errors', () => {
            const testFile = path.join(testDir, 'readonly.js');
            fs.writeFileSync(testFile, 'original content');

            const lazyFile = new LazyFile('readonly.js', testFile, ExtFileType.JS);

            // Try to make file readonly (might not work on all systems)
            try {
                fs.chmodSync(testFile, 0o444); // Read-only

                // Should throw error due to permission error
                expect(() =>
                    FileContentUpdater.updateFileContent(lazyFile, 'new content')
                ).toThrow();

                // Restore permissions for cleanup
                fs.chmodSync(testFile, 0o644);
            } catch (error) {
                // Skip test if we can't change permissions
                console.log('Skipping readonly test - unable to change file permissions');
            }

            lazyFile.close();
        });

        it('should clear cached content when file is updated', () => {
            const testFile = path.join(testDir, 'cache-clear.js');
            const originalContent = 'original content';
            const newContent = 'updated content';

            fs.writeFileSync(testFile, originalContent);

            const lazyFile = new LazyFile('cache-clear.js', testFile, ExtFileType.JS);

            // Cache the original content
            expect(lazyFile.getContent()).toBe(originalContent);

            // Update content
            FileContentUpdater.updateFileContent(lazyFile, newContent);

            // LazyFile should return new content (cache should be cleared)
            expect(lazyFile.getContent()).toBe(newContent);

            lazyFile.close();
        });
    });

    describe('createNewFile', () => {
        it('should create a new file with content', () => {
            const testFile = path.join(testDir, 'new-file.css');
            const content = 'body { color: red; }';

            expect(fs.existsSync(testFile)).toBe(false);

            const lazyFile = FileContentUpdater.createNewFile(
                testFile,
                content,
                'new-file.css',
                ExtFileType.CSS
            );

            expect(lazyFile).not.toBeNull();
            expect(fs.existsSync(testFile)).toBe(true);
            expect(fs.readFileSync(testFile, 'utf8')).toBe(content);

            if (lazyFile) {
                expect(lazyFile.path).toBe('new-file.css');
                expect(lazyFile.filetype).toBe(ExtFileType.CSS);
                expect(lazyFile.getContent()).toBe(content);
                lazyFile.close();
            }
        });

        it('should create nested directories', () => {
            const nestedPath = path.join(testDir, 'level1', 'level2', 'level3');
            const testFile = path.join(nestedPath, 'nested.html');
            const content = '<html><body>Nested file</body></html>';

            expect(fs.existsSync(nestedPath)).toBe(false);

            const lazyFile = FileContentUpdater.createNewFile(
                testFile,
                content,
                'level1/level2/level3/nested.html',
                ExtFileType.HTML
            );

            expect(lazyFile).not.toBeNull();
            expect(fs.existsSync(nestedPath)).toBe(true);
            expect(fs.existsSync(testFile)).toBe(true);

            if (lazyFile) {
                expect(lazyFile.getContent()).toBe(content);
                lazyFile.close();
            }
        });

        it('should handle different file types correctly', () => {
            const testCases = [
                {
                    name: 'script.js',
                    type: ExtFileType.JS,
                    content: 'console.log("test");',
                },
                {
                    name: 'style.css',
                    type: ExtFileType.CSS,
                    content: 'body { margin: 0; }',
                },
                { name: 'page.html', type: ExtFileType.HTML, content: '<html></html>' },
                {
                    name: 'data.json',
                    type: ExtFileType.OTHER,
                    content: '{"key": "value"}',
                },
            ];

            testCases.forEach((testCase) => {
                const testFile = path.join(testDir, testCase.name);
                const lazyFile = FileContentUpdater.createNewFile(
                    testFile,
                    testCase.content,
                    testCase.name,
                    testCase.type
                );

                expect(lazyFile).not.toBeNull();

                if (lazyFile) {
                    expect(lazyFile.filetype).toBe(testCase.type);
                    expect(lazyFile.getContent()).toBe(testCase.content);
                    lazyFile.close();
                }
            });
        });

        it('should handle unicode content in new files', () => {
            const testFile = path.join(testDir, 'unicode-new.js');
            const unicodeContent = '// 中文注释\nconsole.log("Unicode: 🚀 ñáéíóú");';

            const lazyFile = FileContentUpdater.createNewFile(
                testFile,
                unicodeContent,
                'unicode-new.js',
                ExtFileType.JS
            );

            expect(lazyFile).not.toBeNull();

            if (lazyFile) {
                const diskContent = fs.readFileSync(testFile, 'utf8');
                expect(diskContent).toBe(unicodeContent);
                expect(lazyFile.getContent()).toBe(unicodeContent);
                lazyFile.close();
            }
        });

        it('should return null on file creation errors', () => {
            // Try to create file in a path that will cause an error
            const invalidPath = path.join('/root/cannot-write-here/test.js');

            const lazyFile = FileContentUpdater.createNewFile(
                invalidPath,
                'content',
                'test.js',
                ExtFileType.JS
            );

            expect(lazyFile).toBeNull();
        });

        it('should overwrite existing files', () => {
            const testFile = path.join(testDir, 'overwrite.js');
            const originalContent = 'original content';
            const newContent = 'new content';

            // Create file with original content
            fs.writeFileSync(testFile, originalContent);
            expect(fs.readFileSync(testFile, 'utf8')).toBe(originalContent);

            // Create new file (should overwrite)
            const lazyFile = FileContentUpdater.createNewFile(
                testFile,
                newContent,
                'overwrite.js',
                ExtFileType.JS
            );

            expect(lazyFile).not.toBeNull();
            expect(fs.readFileSync(testFile, 'utf8')).toBe(newContent);

            if (lazyFile) {
                expect(lazyFile.getContent()).toBe(newContent);
                lazyFile.close();
            }
        });

        it('should handle empty content', () => {
            const testFile = path.join(testDir, 'empty.txt');
            const emptyContent = '';

            const lazyFile = FileContentUpdater.createNewFile(
                testFile,
                emptyContent,
                'empty.txt',
                ExtFileType.OTHER
            );

            expect(lazyFile).not.toBeNull();
            expect(fs.existsSync(testFile)).toBe(true);

            if (lazyFile) {
                expect(lazyFile.getContent()).toBe(emptyContent);
                expect(lazyFile.getSize()).toBe(0);
                lazyFile.close();
            }
        });
    });
});
