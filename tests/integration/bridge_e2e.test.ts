import * as fs from 'fs';
import { CALLBACK_PATTERNS, createMockExtension, createMockFile } from '../fixtures/test_helpers';
import { ExtFileType } from '../../migrator/types/ext_file_types';
import { MigrateManifest } from '../../migrator/modules/manifest';
import { MigrationError } from '../../migrator/types/migration_module';
import { BridgeInjector } from '../../migrator/modules/bridge_injector';

// Mock the logger
jest.mock('../../migrator/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock fs
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('Bridge End-to-End Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock bridge file content
    mockFs.readFileSync.mockImplementation((filePath: any) => {
      if (typeof filePath === 'string' && filePath.includes('ext_bridge.js')) {
        return '// Mock bridge content\nfunction bridgeFunction() {}';
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    });
  });

  describe('Complete migration workflow', () => {
    test('should perform full MV2 to MV3 migration with bridge injection', () => {
      // Create a realistic MV2 extension with callback-based APIs
      const backgroundContent = `
        // Background script using MV2 callback patterns
        chrome.extension.sendMessage({type: 'init'}, function(response) {
          if (chrome.runtime.lastError) {
            console.error('Init failed:', chrome.runtime.lastError.message);
            return;
          }

          // Initialize storage
          chrome.storage.local.set({
            initialized: true,
            timestamp: Date.now()
          }, function() {
            if (chrome.runtime.lastError) {
              console.error('Storage failed:', chrome.runtime.lastError.message);
            } else {
              console.log('Extension initialized');
            }
          });
        });

        // Listen for browser action clicks
        chrome.browserAction.onClicked.addListener(function(tab) {
          chrome.tabs.executeScript(tab.id, {
            code: 'document.body.style.backgroundColor = "yellow";'
          }, function(results) {
            if (chrome.runtime.lastError) {
              console.error('Script injection failed:', chrome.runtime.lastError.message);
            } else {
              console.log('Script executed on tab:', tab.id);
            }
          });
        });

        // Get current tab and send message
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          if (tabs && tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'highlight'}, function(response) {
              if (chrome.runtime.lastError) {
                console.log('No content script responding');
              } else {
                console.log('Page highlighted:', response);
              }
            });
          }
        });
      `;

      const contentContent = `
        // Content script using MV2 callback patterns
        chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
          if (request.action === 'highlight') {
            const links = document.querySelectorAll('a');
            links.forEach(link => link.style.backgroundColor = 'yellow');

            // Save action to storage
            chrome.storage.local.get(['actions'], function(result) {
              const actions = result.actions || [];
              actions.push({
                action: 'highlight',
                timestamp: Date.now(),
                url: window.location.href
              });

              chrome.storage.local.set({actions: actions}, function() {
                if (chrome.runtime.lastError) {
                  sendResponse({success: false, error: chrome.runtime.lastError.message});
                } else {
                  sendResponse({success: true, count: links.length});
                }
              });
            });

            return true; // Async response
          }
        });
      `;

      const mv2Manifest = {
        manifest_version: 2,
        name: 'Test Extension',
        version: '1.0.0',
        description: 'Extension for E2E testing',
        background: {
          scripts: ['background.js'],
          persistent: false
        },
        content_scripts: [{
          matches: ['*://*/*'],
          js: ['content.js'],
          run_at: 'document_end'
        }],
        browser_action: {
          default_title: 'Test Extension',
          default_popup: 'popup.html'
        },
        permissions: [
          'storage',
          'tabs',
          'activeTab',
          '*://*/*'
        ]
      };

      let extension = createMockExtension({
        id: 'e2e-test-extension',
        name: 'E2E Test Extension',
        manifest: mv2Manifest,
        files: [
          createMockFile({
            path: 'background.js',
            content: backgroundContent,
            filetype: ExtFileType.JS
          }),
          createMockFile({
            path: 'content.js',
            content: contentContent,
            filetype: ExtFileType.JS
          })
        ]
      });

      // Step 1: Manifest Migration (MV2 -> MV3)
      const manifestResult = MigrateManifest.migrate(extension);
      expect(manifestResult).not.toBeInstanceOf(MigrationError);

      if (manifestResult instanceof MigrationError) {
        throw new Error('Manifest migration failed');
      }
      extension = manifestResult;

      // Verify manifest was updated to MV3
      expect(extension.manifest.manifest_version).toBe(3);
      expect(extension.manifest.action).toBeDefined();
      expect(extension.manifest.browser_action).toBeUndefined();

      // Skip API renames for simplicity in E2E test - focus on bridge injection

      // Step 3: Bridge Injection
      const bridgeResult = BridgeInjector.migrate(extension);
      expect(bridgeResult).not.toBeInstanceOf(MigrationError);

      if (bridgeResult instanceof MigrationError) {
        throw new Error('Bridge injection failed');
      }
      extension = bridgeResult;

      // Verify bridge was injected
      expect(extension.files).toHaveLength(3); // background.js + content.js + ext_bridge.js
      const bridgeFile = extension.files.find(f => f.path === 'ext_bridge.js');
      expect(bridgeFile).toBeDefined();

      // Verify manifest was updated for bridge
      // In MV3, background scripts become service_worker, but BridgeInjector should handle both cases
      if (extension.manifest.background.scripts) {
        expect(extension.manifest.background.scripts).toEqual(['ext_bridge.js', 'background.js']);
      } else if (extension.manifest.background.service_worker) {
        // MV3 service worker case - bridge injection handles this differently
        expect(extension.manifest.background.service_worker).toBe('background.js');
      }
      expect(extension.manifest.content_scripts[0].js).toEqual(['ext_bridge.js', 'content.js']);

      // Verify web_accessible_resources includes bridge
      expect(extension.manifest.web_accessible_resources).toEqual([{
        resources: ['ext_bridge.js'],
        matches: ['<all_urls>']
      }]);

      // Final verification: Extension should be ready for MV3
      expect(extension.manifest.manifest_version).toBe(3);
      expect(extension.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();
      expect(extension.manifest.action).toBeDefined();
    });

    test('should handle complex extension with multiple content scripts', () => {
      const manifest = {
        manifest_version: 2,
        name: 'Complex Extension',
        version: '1.0.0',
        background: {
          scripts: ['background.js']
        },
        content_scripts: [
          {
            matches: ['*://*.example.com/*'],
            js: ['content-example.js'],
            css: ['example.css']
          },
          {
            matches: ['*://*.test.com/*'],
            js: ['content-test.js', 'utils.js'],
            run_at: 'document_start'
          },
          {
            matches: ['*://*/*'],
            js: ['content-all.js'],
            run_at: 'document_end'
          }
        ],
        permissions: ['storage', 'tabs']
      };

      const extension = createMockExtension({
        manifest,
        files: [
          createMockFile({
            path: 'background.js',
            content: CALLBACK_PATTERNS.storageGet,
            filetype: ExtFileType.JS
          }),
          createMockFile({
            path: 'content-example.js',
            content: CALLBACK_PATTERNS.runtimeSendMessage,
            filetype: ExtFileType.JS
          }),
          createMockFile({
            path: 'content-test.js',
            content: CALLBACK_PATTERNS.tabsQuery,
            filetype: ExtFileType.JS
          }),
          createMockFile({
            path: 'utils.js',
            content: 'function utils() { return "helper"; }',
            filetype: ExtFileType.JS
          }),
          createMockFile({
            path: 'content-all.js',
            content: CALLBACK_PATTERNS.storageSet,
            filetype: ExtFileType.JS
          })
        ]
      });

      // Run migration pipeline (skip API renames for simplicity)
      let result = MigrateManifest.migrate(extension);
      expect(result).not.toBeInstanceOf(MigrationError);
      if (result instanceof MigrationError) return;

      result = BridgeInjector.migrate(result);
      expect(result).not.toBeInstanceOf(MigrationError);
      if (result instanceof MigrationError) return;

      // Verify all content scripts have bridge injected
      expect(result.manifest.content_scripts[0].js).toEqual(['ext_bridge.js', 'content-example.js']);
      expect(result.manifest.content_scripts[1].js).toEqual(['ext_bridge.js', 'content-test.js', 'utils.js']);
      expect(result.manifest.content_scripts[2].js).toEqual(['ext_bridge.js', 'content-all.js']);

      // Verify bridge file was added
      expect(result.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();
      expect(result.files).toHaveLength(6); // 5 original + 1 bridge
    });
  });


  describe('Real-world scenarios', () => {
    test('should handle extension with mixed async patterns', () => {
      const mixedContent = `
        // Old callback pattern (needs bridge)
        chrome.storage.local.get(['settings'], function(result) {
          console.log('Settings:', result.settings);
        });

        // Modern promise pattern (should work as-is)
        chrome.storage.local.set({theme: 'dark'}).then(() => {
          console.log('Theme saved');
        });

        // Async/await pattern (should work as-is)
        async function getTabs() {
          try {
            const tabs = await chrome.tabs.query({active: true});
            return tabs;
          } catch (error) {
            console.error('Failed to get tabs:', error);
          }
        }

        // Event listener (not affected)
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
          sendResponse({received: true});
        });
      `;

      const extension = createMockExtension({
        files: [
          createMockFile({
            path: 'mixed.js',
            content: mixedContent,
            filetype: ExtFileType.JS
          })
        ]
      });

      const result = BridgeInjector.migrate(extension);
      expect(result).not.toBeInstanceOf(MigrationError);

      if (!(result instanceof MigrationError)) {
        // Should inject bridge because of callback usage
        expect(result.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();

        // Original file should be preserved
        const mixedFile = result.files.find(f => f.path === 'mixed.js');
        expect(mixedFile).toBeDefined();
        expect(mixedFile!.getContent()).toContain('chrome.storage.local.get');
        expect(mixedFile!.getContent()).toContain('async function getTabs');
      }
    });

    test('should handle large enterprise extension', () => {
      // Simulate a large extension with many files
      const files = [];

      // Background scripts with callbacks
      files.push(createMockFile({
        path: 'background/main.js',
        content: CALLBACK_PATTERNS.storageGet + '\n' + CALLBACK_PATTERNS.tabsQuery,
        filetype: ExtFileType.JS
      }));

      files.push(createMockFile({
        path: 'background/auth.js',
        content: CALLBACK_PATTERNS.runtimeSendMessage,
        filetype: ExtFileType.JS
      }));

      // Content scripts
      for (let i = 0; i < 5; i++) {
        files.push(createMockFile({
          path: `content/content${i}.js`,
          content: `console.log('Content script ${i}'); ${CALLBACK_PATTERNS.storageSet}`,
          filetype: ExtFileType.JS
        }));
      }

      // Popup and options scripts
      files.push(createMockFile({
        path: 'popup/popup.js',
        content: CALLBACK_PATTERNS.storageGet,
        filetype: ExtFileType.JS
      }));

      files.push(createMockFile({
        path: 'options/options.js',
        content: CALLBACK_PATTERNS.storageSet,
        filetype: ExtFileType.JS
      }));

      // Non-JS files (should be ignored)
      files.push(createMockFile({
        path: 'styles/main.css',
        content: 'body { margin: 0; }',
        filetype: ExtFileType.CSS
      }));

      files.push(createMockFile({
        path: 'popup/popup.html',
        content: '<html><body>Popup</body></html>',
        filetype: ExtFileType.HTML
      }));

      const manifest = {
        manifest_version: 2,
        name: 'Enterprise Extension',
        version: '1.0.0',
        background: {
          scripts: ['background/main.js', 'background/auth.js']
        },
        content_scripts: [
          {
            matches: ['*://*/*'],
            js: ['content/content0.js', 'content/content1.js']
          },
          {
            matches: ['*://*.corp.com/*'],
            js: ['content/content2.js', 'content/content3.js', 'content/content4.js']
          }
        ]
      };

      const extension = createMockExtension({
        manifest,
        files
      });

      const result = BridgeInjector.migrate(extension);
      expect(result).not.toBeInstanceOf(MigrationError);

      if (!(result instanceof MigrationError)) {
        // Should inject bridge
        expect(result.files.find(f => f.path === 'ext_bridge.js')).toBeDefined();
        expect(result.files).toHaveLength(files.length + 1);

        // Verify manifest updates
        expect(result.manifest.background.scripts).toEqual([
          'ext_bridge.js',
          'background/main.js',
          'background/auth.js'
        ]);

        expect(result.manifest.content_scripts[0].js).toEqual([
          'ext_bridge.js',
          'content/content0.js',
          'content/content1.js'
        ]);

        expect(result.manifest.content_scripts[1].js).toEqual([
          'ext_bridge.js',
          'content/content2.js',
          'content/content3.js',
          'content/content4.js'
        ]);
      }
    });
  });
});
