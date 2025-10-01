import { BridgeInjector } from '../../../migrator/modules/bridge_injector';
import { Extension } from '../../../migrator/types/extension';
import { MigrationError } from '../../../migrator/types/migration_module';
import { LazyFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';
import * as fs from 'fs';

// Mock the logger to avoid noise in tests
jest.mock('../migrator/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock fs for bridge file loading
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('BridgeInjector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock bridge file content
    mockFs.readFileSync.mockReturnValue('// Mock bridge content\nfunction bridgeFunction() {}');
  });

  // Helper function to create mock LazyFile
  function createMockFile(path: string, content: string, filetype: ExtFileType = ExtFileType.JS): LazyFile {
    const mockFile = Object.create(LazyFile.prototype);
    mockFile.path = path;
    mockFile.filetype = filetype;
    mockFile.getContent = jest.fn().mockReturnValue(content);
    mockFile.getSize = jest.fn().mockReturnValue(Buffer.byteLength(content, 'utf8'));
    mockFile.close = jest.fn();
    mockFile.getAST = jest.fn().mockReturnValue(undefined);
    return mockFile;
  }

  // Helper function to create mock extension
  function createMockExtension(options: {
    id?: string;
    name?: string;
    manifest?: any;
    files?: LazyFile[];
  } = {}): Extension {
    return {
      id: options.id || 'test-extension-id',
      name: options.name || 'Test Extension',
      manifest: options.manifest || { manifest_version: 3 },
      files: options.files || [],
      isNewTabExtension: false
    } as Extension;
  }

  describe('hasCallbackPatterns', () => {
    test('should detect chrome API with function callback', () => {
      const content = `
        chrome.storage.local.get(['key'], function(result) {
          console.log(result);
        });
      `;

      expect(BridgeInjector.testHelpers.hasCallbackPatterns(content)).toBe(true);
    });

    test('should detect chrome API with arrow function callback', () => {
      const content = `
        chrome.tabs.query({active: true}, (tabs) => {
          console.log(tabs);
        });
      `;

      expect(BridgeInjector.testHelpers.hasCallbackPatterns(content)).toBe(true);
    });

    test('should detect chrome.runtime.lastError usage', () => {
      const content = `
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
        }
      `;

      expect(BridgeInjector.testHelpers.hasCallbackPatterns(content)).toBe(true);
    });

    test('should detect nested chrome API calls', () => {
      const content = `
        chrome.storage.session.get(['data'], function(result) {
          chrome.tabs.sendMessage(tabId, result.data, callback);
        });
      `;

      expect(BridgeInjector.testHelpers.hasCallbackPatterns(content)).toBe(true);
    });

    test('should not detect non-callback chrome API usage', () => {
      const content = `
        const url = chrome.runtime.getURL('popup.html');
        chrome.action.setBadgeText({text: 'test'});
      `;

      expect(BridgeInjector.testHelpers.hasCallbackPatterns(content)).toBe(false);
    });

    test('should not detect non-chrome callback patterns', () => {
      const content = `
        setTimeout(function() { console.log('test'); }, 1000);
        document.addEventListener('click', (e) => {});
      `;

      expect(BridgeInjector.testHelpers.hasCallbackPatterns(content)).toBe(false);
    });
  });

  describe('needsBridge', () => {
    test('should return true for extension with callback patterns', () => {
      const files = [
        createMockFile('background.js', 'chrome.storage.local.get(["key"], function(result) {})'),
        createMockFile('content.js', 'regular javascript without chrome APIs')
      ];
      const extension = createMockExtension({ files });

      expect(BridgeInjector.testHelpers.needsBridge(extension)).toBe(true);
    });

    test('should return false for extension without callback patterns', () => {
      const files = [
        createMockFile('background.js', 'const url = chrome.runtime.getURL("popup.html");'),
        createMockFile('content.js', 'console.log("Hello world");')
      ];
      const extension = createMockExtension({ files });

      expect(BridgeInjector.testHelpers.needsBridge(extension)).toBe(false);
    });

    test('should return false for extension with no JS files', () => {
      const files = [
        createMockFile('manifest.json', '{}', ExtFileType.OTHER),
        createMockFile('style.css', 'body {}', ExtFileType.CSS)
      ];
      const extension = createMockExtension({ files });

      expect(BridgeInjector.testHelpers.needsBridge(extension)).toBe(false);
    });

    test('should handle empty files array', () => {
      const extension = createMockExtension({ files: [] });

      expect(BridgeInjector.testHelpers.needsBridge(extension)).toBe(false);
    });
  });

  describe('injectBridgeIntoManifest', () => {
    test('should inject bridge into background scripts (MV2 style)', () => {
      const manifest = {
        manifest_version: 2,
        background: {
          scripts: ['background.js']
        }
      };

      const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(manifest);

      expect(result.background.scripts).toEqual(['ext_bridge.js', 'background.js']);
      expect(result.background.scripts[0]).toBe('ext_bridge.js'); // Bridge should be first
    });

    test('should inject bridge into content scripts', () => {
      const manifest = {
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['*://*/*'],
            js: ['content.js']
          }
        ]
      };

      const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(manifest);

      expect(result.content_scripts[0].js).toEqual(['ext_bridge.js', 'content.js']);
    });

    test('should add web_accessible_resources for MV3', () => {
      const manifest = {
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['*://*/*'],
            js: ['content.js']
          }
        ]
      };

      const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(manifest);

      expect(result.web_accessible_resources).toEqual([
        {
          resources: ['ext_bridge.js'],
          matches: ['<all_urls>']
        }
      ]);
    });

    test('should add web_accessible_resources for MV2', () => {
      const manifest = {
        manifest_version: 2,
        content_scripts: [
          {
            matches: ['*://*/*'],
            js: ['content.js']
          }
        ]
      };

      const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(manifest);

      expect(result.web_accessible_resources).toEqual(['ext_bridge.js']);
    });

    test('should not duplicate bridge in existing scripts', () => {
      const manifest = {
        background: {
          scripts: ['ext_bridge.js', 'background.js']
        }
      };

      const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(manifest);

      expect(result.background.scripts).toEqual(['ext_bridge.js', 'background.js']);
    });

    test('should handle multiple content scripts', () => {
      const manifest = {
        content_scripts: [
          { matches: ['*://*.example.com/*'], js: ['content1.js'] },
          { matches: ['*://*.test.com/*'], js: ['content2.js'] }
        ]
      };

      const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(manifest);

      expect(result.content_scripts[0].js).toEqual(['ext_bridge.js', 'content1.js']);
      expect(result.content_scripts[1].js).toEqual(['ext_bridge.js', 'content2.js']);
    });

    test('should handle manifest with no background or content scripts', () => {
      const manifest = {
        manifest_version: 3,
        name: 'Test Extension'
      };

      const result = BridgeInjector.testHelpers.injectBridgeIntoManifest(manifest);

      expect(result).toEqual(manifest); // Should remain unchanged
    });
  });

  describe('createBridgeFile', () => {
    test('should create bridge file with correct properties', () => {
      const bridgeFile = BridgeInjector.testHelpers.createBridgeFile();

      expect(bridgeFile.path).toBe('ext_bridge.js');
      expect(bridgeFile.filetype).toBe(ExtFileType.JS);
      expect(bridgeFile.getContent()).toContain('// Mock bridge content');
      expect(typeof bridgeFile.getSize()).toBe('number');
      expect(bridgeFile.getSize()).toBeGreaterThan(0);
    });

    test('should handle bridge file loading errors', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      expect(() => {
        BridgeInjector.testHelpers.createBridgeFile();
      }).toThrow('Failed to load bridge file: File not found');
    });
  });

  describe('hasBridgeInManifest', () => {
    test('should detect bridge in background scripts', () => {
      const manifest = {
        background: {
          scripts: ['ext_bridge.js', 'background.js']
        }
      };

      expect(BridgeInjector.testHelpers.hasBridgeInManifest(manifest)).toBe(true);
    });

    test('should detect bridge in content scripts', () => {
      const manifest = {
        content_scripts: [
          {
            js: ['ext_bridge.js', 'content.js']
          }
        ]
      };

      expect(BridgeInjector.testHelpers.hasBridgeInManifest(manifest)).toBe(true);
    });

    test('should return false when bridge is not present', () => {
      const manifest = {
        background: {
          scripts: ['background.js']
        },
        content_scripts: [
          {
            js: ['content.js']
          }
        ]
      };

      expect(BridgeInjector.testHelpers.hasBridgeInManifest(manifest)).toBe(false);
    });

    test('should handle manifest with no scripts', () => {
      const manifest = {
        name: 'Test Extension'
      };

      expect(BridgeInjector.testHelpers.hasBridgeInManifest(manifest)).toBe(false);
    });
  });

  describe('migrate', () => {
    test('should inject bridge into extension that needs it', () => {
      const files = [
        createMockFile('background.js', 'chrome.storage.local.get(["key"], function(result) {})')
      ];
      const manifest = {
        manifest_version: 3,
        background: {
          scripts: ['background.js']
        }
      };
      const extension = createMockExtension({ files, manifest });

      const result = BridgeInjector.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        expect(result.files).toHaveLength(2); // original + bridge
        expect(result.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();
        expect(result.manifest.background.scripts).toEqual(['ext_bridge.js', 'background.js']);
      }
    });

    test('should not inject bridge into extension that does not need it', () => {
      const files = [
        createMockFile('background.js', 'const url = chrome.runtime.getURL("popup.html");')
      ];
      const extension = createMockExtension({ files });

      const result = BridgeInjector.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      expect(result).toBe(extension); // Should return original extension unchanged
    });

    test('should not inject bridge if already present', () => {
      const files = [
        createMockFile('background.js', 'chrome.storage.local.get(["key"], function(result) {})'),
        createMockFile('ext_bridge.js', '// Bridge content')
      ];
      const extension = createMockExtension({ files });

      const result = BridgeInjector.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      expect(result).toBe(extension); // Should return original extension unchanged
    });

    test('should handle invalid extension structure', () => {
      const invalidExtension = null as any;

      const result = BridgeInjector.migrate(invalidExtension);

      expect(result).toBeInstanceOf(MigrationError);
      if (result instanceof MigrationError) {
        expect(result.error.message).toBe('Invalid extension structure');
      }
    });

    test('should handle extension with missing properties', () => {
      const invalidExtension = {
        id: 'test-id'
        // missing files and manifest
      } as any;

      const result = BridgeInjector.migrate(invalidExtension);

      expect(result).toBeInstanceOf(MigrationError);
    });

    test('should handle bridge loading errors gracefully', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Bridge file not found');
      });

      const files = [
        createMockFile('background.js', 'chrome.storage.local.get(["key"], function(result) {})')
      ];
      const extension = createMockExtension({ files });

      const result = BridgeInjector.migrate(extension);

      expect(result).toBeInstanceOf(MigrationError);
      if (result instanceof MigrationError) {
        expect(result.error.message).toContain('Failed to load bridge file');
      }
    });

    test('should preserve original extension properties', () => {
      const files = [
        createMockFile('background.js', 'chrome.storage.local.get(["key"], function(result) {})')
      ];
      const originalExtension = createMockExtension({
        id: 'test-extension-123',
        name: 'My Test Extension',
        files
      });

      const result = BridgeInjector.migrate(originalExtension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        expect(result.id).toBe(originalExtension.id);
        expect(result.name).toBe(originalExtension.name);
        expect(result.isNewTabExtension).toBe(originalExtension.isNewTabExtension);
      }
    });
  });

  describe('edge cases and error handling', () => {
    test('should handle content with malformed JavaScript', () => {
      const content = `
        chrome.storage.local.get(["key"], function(result {
          // Malformed - missing closing parenthesis
        });
      `;

      // Should still detect the pattern despite malformed JS
      expect(BridgeInjector.testHelpers.hasCallbackPatterns(content)).toBe(true);
    });

    test('should handle empty file content', () => {
      const files = [
        createMockFile('background.js', '')
      ];
      const extension = createMockExtension({ files });

      expect(BridgeInjector.testHelpers.needsBridge(extension)).toBe(false);
    });

    test('should handle files that return null content', () => {
      const mockFile = Object.create(LazyFile.prototype);
      mockFile.path = 'background.js';
      mockFile.filetype = ExtFileType.JS;
      mockFile.getContent = jest.fn().mockReturnValue(null);
      mockFile.getSize = jest.fn().mockReturnValue(0);

      const extension = createMockExtension({ files: [mockFile] });

      expect(() => BridgeInjector.testHelpers.needsBridge(extension)).not.toThrow();
      expect(BridgeInjector.testHelpers.needsBridge(extension)).toBe(false);
    });

    test('should handle manifest with null values', () => {
      const manifest = {
        background: null,
        content_scripts: null
      };

      expect(() => {
        BridgeInjector.testHelpers.injectBridgeIntoManifest(manifest);
      }).not.toThrow();
    });
  });
});
