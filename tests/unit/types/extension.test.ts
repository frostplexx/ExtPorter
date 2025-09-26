import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Extension, closeExtensionFiles, isNewTabExtension } from '../../../migrator/types/extension';
import { LazyFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';

describe('Extension types and utilities', () => {
  const testDir = path.join(process.env.TEST_OUTPUT_DIR!, 'extension_test');

  beforeEach(() => {
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  describe('closeExtensionFiles', () => {
    it('should close all LazyFile instances in extension', () => {
      // Create test files
      const file1Path = path.join(testDir, 'file1.js');
      const file2Path = path.join(testDir, 'file2.css');
      fs.writeFileSync(file1Path, 'console.log("test");');
      fs.writeFileSync(file2Path, 'body { color: red; }');

      const lazyFile1 = new LazyFile('file1.js', file1Path, ExtFileType.JS);
      const lazyFile2 = new LazyFile('file2.css', file2Path, ExtFileType.CSS);

      // Access content to open file descriptors
      lazyFile1.getContent();
      lazyFile2.getContent();

      const extension: Extension = {
        id: 'test-extension',
        name: 'Test Extension',
        manifest_path: testDir,
        manifest: {
          name: 'Test Extension',
          version: '1.0',
          manifest_version: 2
        },
        files: [lazyFile1, lazyFile2]
      };

      // Close files
      closeExtensionFiles(extension);

      // File descriptors should be closed
      expect((lazyFile1 as any)._mmapFile).toBeUndefined();
      expect((lazyFile2 as any)._mmapFile).toBeUndefined();
    });

    it('should handle empty files array', () => {
      const extension: Extension = {
        id: 'empty-extension',
        name: 'Empty Extension',
        manifest_path: testDir,
        manifest: {
          name: 'Empty Extension',
          version: '1.0',
          manifest_version: 2
        },
        files: []
      };

      // Should not throw
      expect(() => closeExtensionFiles(extension)).not.toThrow();
    });

    it('should handle files that are already closed', () => {
      const filePath = path.join(testDir, 'already-closed.js');
      fs.writeFileSync(filePath, 'console.log("test");');

      const lazyFile = new LazyFile('already-closed.js', filePath, ExtFileType.JS);
      lazyFile.getContent(); // Open file
      lazyFile.close(); // Close file manually

      const extension: Extension = {
        id: 'pre-closed-extension',
        name: 'Pre-closed Extension',
        manifest_path: testDir,
        manifest: {
          name: 'Pre-closed Extension',
          version: '1.0',
          manifest_version: 2
        },
        files: [lazyFile]
      };

      // Should not throw even if file is already closed
      expect(() => closeExtensionFiles(extension)).not.toThrow();
    });

    it('should handle errors when closing files gracefully', () => {
      // Create a mock LazyFile that throws on close
      const mockFile = {
        path: 'mock-file.js',
        close: jest.fn(() => {
          throw new Error('Mock close error');
        })
      } as any;

      const extension: Extension = {
        id: 'error-extension',
        name: 'Error Extension',
        manifest_path: testDir,
        manifest: {
          name: 'Error Extension',
          version: '1.0',
          manifest_version: 2
        },
        files: [mockFile]
      };

      // Should not throw even if close() throws
      expect(() => closeExtensionFiles(extension)).not.toThrow();
      expect(mockFile.close).toHaveBeenCalled();
    });
  });

  describe('isNewTabExtension', () => {
    it('should return true for extensions with chrome_url_overrides.newtab', () => {
      const extension: Extension = {
        id: 'newtab-extension',
        name: 'New Tab Extension',
        manifest_path: testDir,
        manifest: {
          name: 'New Tab Extension',
          version: '1.0',
          manifest_version: 2,
          chrome_url_overrides: {
            newtab: 'newtab.html'
          }
        },
        files: []
      };

      expect(isNewTabExtension(extension)).toBe(true);
    });

    it('should return false for extensions without chrome_url_overrides', () => {
      const extension: Extension = {
        id: 'regular-extension',
        name: 'Regular Extension',
        manifest_path: testDir,
        manifest: {
          name: 'Regular Extension',
          version: '1.0',
          manifest_version: 2
        },
        files: []
      };

      expect(isNewTabExtension(extension)).toBe(false);
    });

    it('should return false for extensions with chrome_url_overrides but no newtab', () => {
      const extension: Extension = {
        id: 'other-override-extension',
        name: 'Other Override Extension',
        manifest_path: testDir,
        manifest: {
          name: 'Other Override Extension',
          version: '1.0',
          manifest_version: 2,
          chrome_url_overrides: {
            bookmarks: 'bookmarks.html'
          }
        },
        files: []
      };

      expect(isNewTabExtension(extension)).toBe(false);
    });

    it('should return false for extensions with empty chrome_url_overrides.newtab', () => {
      const extension: Extension = {
        id: 'empty-newtab-extension',
        name: 'Empty New Tab Extension',
        manifest_path: testDir,
        manifest: {
          name: 'Empty New Tab Extension',
          version: '1.0',
          manifest_version: 2,
          chrome_url_overrides: {
            newtab: null
          }
        },
        files: []
      };

      expect(isNewTabExtension(extension)).toBe(false);
    });

    it('should return true for extensions with newtab set to empty string', () => {
      const extension: Extension = {
        id: 'empty-string-newtab',
        name: 'Empty String New Tab',
        manifest_path: testDir,
        manifest: {
          name: 'Empty String New Tab',
          version: '1.0',
          manifest_version: 2,
          chrome_url_overrides: {
            newtab: ''
          }
        },
        files: []
      };

      // Empty string is truthy in terms of being set
      expect(isNewTabExtension(extension)).toBe(false);
    });

    it('should handle null manifest gracefully', () => {
      const extension: Extension = {
        id: 'null-manifest-extension',
        name: 'Null Manifest Extension',
        manifest_path: testDir,
        manifest: null as any,
        files: []
      };

      expect(isNewTabExtension(extension)).toBe(false);
    });

    it('should handle undefined manifest gracefully', () => {
      const extension: Extension = {
        id: 'undefined-manifest-extension',
        name: 'Undefined Manifest Extension',
        manifest_path: testDir,
        manifest: undefined as any,
        files: []
      };

      expect(isNewTabExtension(extension)).toBe(false);
    });
  });

  describe('Extension interface', () => {
    it('should allow creating valid extension objects', () => {
      const filePath = path.join(testDir, 'test.js');
      fs.writeFileSync(filePath, 'console.log("test");');

      const lazyFile = new LazyFile('test.js', filePath, ExtFileType.JS);

      const extension: Extension = {
        id: 'valid-extension-id',
        name: 'Valid Extension',
        manifest_path: '/path/to/extension',
        manifest: {
          name: 'Valid Extension',
          version: '2.1.0',
          manifest_version: 2,
          description: 'A valid test extension',
          permissions: ['activeTab', 'storage']
        },
        files: [lazyFile],
        isNewTabExtension: false,
        mv3_extension_id: 'mv3-converted-id'
      };

      expect(extension.id).toBe('valid-extension-id');
      expect(extension.name).toBe('Valid Extension');
      expect(extension.manifest.name).toBe('Valid Extension');
      expect(extension.files).toHaveLength(1);
      expect(extension.isNewTabExtension).toBe(false);
      expect(extension.mv3_extension_id).toBe('mv3-converted-id');

      lazyFile.close();
    });

    it('should allow optional properties to be undefined', () => {
      const extension: Extension = {
        id: 'minimal-extension',
        name: 'Minimal Extension',
        manifest_path: '/minimal/path',
        manifest: {
          name: 'Minimal Extension',
          version: '1.0',
          manifest_version: 2
        },
        files: []
        // isNewTabExtension and mv3_extension_id are optional
      };

      expect(extension.isNewTabExtension).toBeUndefined();
      expect(extension.mv3_extension_id).toBeUndefined();
    });
  });
});
