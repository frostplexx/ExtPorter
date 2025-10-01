import { BridgeInjector } from '../../../migrator/modules/bridge_injector';
import { RenameAPIS } from '../../../migrator/modules/api_renames';
import { MigrateManifest } from '../../../migrator/modules/manifest';
import { MigrationError } from '../../../migrator/types/migration_module';
import { createMockExtension, createMockFile, CALLBACK_PATTERNS, NON_CALLBACK_PATTERNS } from '../../fixtures/test_helpers';
import { ExtFileType } from '../../../migrator/types/ext_file_types';

// Mock the logger and file system
jest.mock('../../../migrator/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('fs');
import mockFs from 'fs';

describe('Bridge Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock bridge file content
    mockFs.readFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('ext_bridge.js')) {
        return '// Mock bridge content\nfunction bridgeFunction() {}';
      }
      if (filePath.includes('api_mappings.json')) {
        return JSON.stringify({
          mappings: [
            {
              source: {
                body: "return chrome.extension.sendMessage(extensionId, message, options, responseCallback);"
              },
              target: {
                body: "return chrome.runtime.sendMessage(extensionId, message, options, responseCallback);"
              }
            }
          ]
        });
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    });
  });

  describe('Full migration pipeline with bridge injection', () => {
    test('should inject bridge into callback-based extension during migration', () => {
      // Create extension with callback patterns
      const backgroundFile = createMockFile({
        path: 'background.js',
        content: CALLBACK_PATTERNS.storageGet + '\n' + CALLBACK_PATTERNS.tabsQuery,
        filetype: ExtFileType.JS
      });

      const contentFile = createMockFile({
        path: 'content.js',
        content: CALLBACK_PATTERNS.runtimeSendMessage,
        filetype: ExtFileType.JS
      });

      const manifest = {
        manifest_version: 2,
        name: 'Callback Extension',
        version: '1.0.0',
        background: {
          scripts: ['background.js']
        },
        content_scripts: [{
          matches: ['*://*/*'],
          js: ['content.js']
        }]
      };

      const extension = createMockExtension({
        id: 'callback-extension',
        name: 'Callback Extension',
        manifest,
        files: [backgroundFile, contentFile]
      });

      // Run bridge injection
      const result = BridgeInjector.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // Verify bridge was injected
        expect(result.files).toHaveLength(3); // original 2 + bridge
        expect(result.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();

        // Verify manifest was updated
        expect(result.manifest.background.scripts).toEqual(['ext_bridge.js', 'background.js']);
        expect(result.manifest.content_scripts[0].js).toEqual(['ext_bridge.js', 'content.js']);

        // Verify web_accessible_resources was added
        expect(result.manifest.web_accessible_resources).toEqual(['ext_bridge.js']);
      }
    });

    test('should not inject bridge into non-callback extension', () => {
      // Create extension without callback patterns
      const backgroundFile = createMockFile({
        path: 'background.js',
        content: NON_CALLBACK_PATTERNS.getURL + '\n' + NON_CALLBACK_PATTERNS.setBadge,
        filetype: ExtFileType.JS
      });

      const extension = createMockExtension({
        files: [backgroundFile]
      });

      const result = BridgeInjector.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      expect(result).toBe(extension); // Should return unchanged
    });

    test('should work with manifest migration', () => {
      // Create MV2 extension with callbacks
      const backgroundFile = createMockFile({
        path: 'background.js',
        content: CALLBACK_PATTERNS.storageGet,
        filetype: ExtFileType.JS
      });

      const mv2Manifest = {
        manifest_version: 2,
        name: 'Test Extension',
        version: '1.0.0',
        background: {
          scripts: ['background.js']
        },
        browser_action: {
          default_title: 'Test'
        }
      };

      let extension = createMockExtension({
        manifest: mv2Manifest,
        files: [backgroundFile]
      });

      // First run manifest migration (MV2 -> MV3)
      const manifestResult = MigrateManifest.migrate(extension);
      expect(manifestResult).not.toBeInstanceOf(MigrationError);

      if (!(manifestResult instanceof MigrationError)) {
        extension = manifestResult;

        // Then run bridge injection
        const bridgeResult = BridgeInjector.migrate(extension);
        expect(bridgeResult).not.toBeInstanceOf(MigrationError);

        if (!(bridgeResult instanceof MigrationError)) {
          // Verify both migrations worked
          expect(bridgeResult.manifest.manifest_version).toBe(3);
          expect(bridgeResult.manifest.action).toBeDefined(); // MV3 action instead of browser_action
          expect(bridgeResult.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();
        }
      }
    });

    test('should preserve existing migrations when injecting bridge', () => {
      // Create extension that needs both API renames and bridge
      const backgroundFile = createMockFile({
        path: 'background.js',
        content: 'chrome.extension.sendMessage("test", function(response) { console.log(response); });',
        filetype: ExtFileType.JS
      });

      let extension = createMockExtension({
        files: [backgroundFile]
      });

      // First run API renames
      const apiResult = RenameAPIS.migrate(extension);

      // API rename might succeed or fail, but bridge should still work
      if (!(apiResult instanceof MigrationError)) {
        extension = apiResult;
      }

      // Then run bridge injection
      const bridgeResult = BridgeInjector.migrate(extension);
      expect(bridgeResult).not.toBeInstanceOf(MigrationError);

      if (!(bridgeResult instanceof MigrationError)) {
        // Verify bridge was added (regardless of API rename success)
        expect(bridgeResult.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();
      }
    });
  });

  describe('Edge cases and error handling', () => {
    test('should handle extension with mixed callback and promise usage', () => {
      const mixedFile = createMockFile({
        path: 'mixed.js',
        content: `
          // Callback usage (needs bridge)
          chrome.storage.local.get(['key'], function(result) {
            console.log(result);
          });

          // Promise usage (doesn't need bridge but should still work)
          chrome.storage.local.set({key: 'value'}).then(() => {
            console.log('saved');
          });

          // Synchronous usage (doesn't need bridge)
          const url = chrome.runtime.getURL('popup.html');
        `,
        filetype: ExtFileType.JS
      });

      const extension = createMockExtension({
        files: [mixedFile]
      });

      const result = BridgeInjector.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // Should inject bridge due to callback usage
        expect(result.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();
      }
    });

    test('should handle large extension with many files', () => {
      const files = [];

      // Create 10 JS files, some with callbacks, some without
      for (let i = 0; i < 10; i++) {
        const hasCallbacks = i % 3 === 0; // Every third file has callbacks
        const content = hasCallbacks
          ? CALLBACK_PATTERNS.storageGet
          : NON_CALLBACK_PATTERNS.getURL;

        files.push(createMockFile({
          path: `script${i}.js`,
          content,
          filetype: ExtFileType.JS
        }));
      }

      // Add some non-JS files
      files.push(createMockFile({
        path: 'style.css',
        content: 'body { color: red; }',
        filetype: ExtFileType.CSS
      }));

      files.push(createMockFile({
        path: 'popup.html',
        content: '<html><body>Popup</body></html>',
        filetype: ExtFileType.HTML
      }));

      const extension = createMockExtension({
        files
      });

      const result = BridgeInjector.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // Should inject bridge because some files have callbacks
        expect(result.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();
        expect(result.files).toHaveLength(files.length + 1); // original files + bridge
      }
    });

    test('should handle extension with complex manifest structure', () => {
      const backgroundFile = createMockFile({
        path: 'background.js',
        content: CALLBACK_PATTERNS.storageGet,
        filetype: ExtFileType.JS
      });

      const manifest = {
        manifest_version: 2,
        name: 'Complex Extension',
        version: '2.1.0',
        background: {
          scripts: ['background.js']
        },
        content_scripts: [
          {
            matches: ['*://*.example.com/*'],
            js: ['content1.js'],
            css: ['style1.css']
          },
          {
            matches: ['*://*.test.com/*'],
            js: ['content2.js', 'utils.js'],
            css: ['style2.css'],
            run_at: 'document_end'
          }
        ],
        web_accessible_resources: [
          'images/*',
          'data.json'
        ],
        permissions: [
          'storage',
          'tabs',
          'activeTab',
          '*://*/*'
        ]
      };

      const extension = createMockExtension({
        manifest,
        files: [backgroundFile]
      });

      const result = BridgeInjector.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // Verify bridge was injected into all content scripts
        expect(result.manifest.content_scripts[0].js).toEqual(['ext_bridge.js', 'content1.js']);
        expect(result.manifest.content_scripts[1].js).toEqual(['ext_bridge.js', 'content2.js', 'utils.js']);

        // Verify web_accessible_resources includes bridge
        expect(result.manifest.web_accessible_resources).toContain('ext_bridge.js');
        expect(result.manifest.web_accessible_resources).toContain('images/*'); // Preserve existing
        expect(result.manifest.web_accessible_resources).toContain('data.json'); // Preserve existing
      }
    });

    test('should handle service worker manifest (MV3)', () => {
      const serviceWorkerFile = createMockFile({
        path: 'service-worker.js',
        content: CALLBACK_PATTERNS.storageGet,
        filetype: ExtFileType.JS
      });

      const manifest = {
        manifest_version: 3,
        name: 'Service Worker Extension',
        version: '1.0.0',
        background: {
          service_worker: 'service-worker.js'
        }
      };

      const extension = createMockExtension({
        manifest,
        files: [serviceWorkerFile]
      });

      const result = BridgeInjector.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // Bridge should be injected
        expect(result.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();
        // Service worker handling is noted but doesn't fail
        expect(result.manifest.background.service_worker).toBe('service-worker.js');
      }
    });
  });

  describe('Performance and optimization', () => {
    test('should efficiently handle extension without JS files', () => {
      const files = [
        createMockFile({
          path: 'style.css',
          content: 'body { color: blue; }',
          filetype: ExtFileType.CSS
        }),
        createMockFile({
          path: 'popup.html',
          content: '<html><body>Popup</body></html>',
          filetype: ExtFileType.HTML
        }),
        createMockFile({
          path: 'manifest.json',
          content: '{"manifest_version": 3}',
          filetype: ExtFileType.OTHER
        })
      ];

      const extension = createMockExtension({
        files
      });

      const result = BridgeInjector.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      expect(result).toBe(extension); // Should return unchanged quickly
    });

    test('should handle files with null or empty content gracefully', () => {
      const emptyFile = createMockFile({
        path: 'empty.js',
        content: '',
        filetype: ExtFileType.JS
      });

      const nullContentFile = Object.create(emptyFile);
      nullContentFile.path = 'null.js';
      nullContentFile.getContent = jest.fn().mockReturnValue(null);

      const extension = createMockExtension({
        files: [emptyFile, nullContentFile]
      });

      expect(() => {
        const result = BridgeInjector.migrate(extension);
        expect(result).not.toBeInstanceOf(MigrationError);
      }).not.toThrow();
    });
  });
});
