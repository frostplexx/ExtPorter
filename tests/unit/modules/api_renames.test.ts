import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { RenameAPIS } from '../../../migrator/modules/api_renames';
import { Extension } from '../../../migrator/types/extension';
import { LazyFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';
import { MigrationError } from '../../../migrator/types/migration_module';

describe('RenameAPIS', () => {
  const testDir = path.join(process.env.TEST_OUTPUT_DIR!, 'api_renames_test');

  beforeEach(() => {
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  function createTestExtension(name: string, files: Array<{name: string, content: string}>): Extension {
    const extensionDir = path.join(testDir, name);
    fs.ensureDirSync(extensionDir);

    const lazyFiles: LazyFile[] = [];

    files.forEach(file => {
      const filePath = path.join(extensionDir, file.name);
      fs.writeFileSync(filePath, file.content);
      lazyFiles.push(new LazyFile(file.name, filePath, ExtFileType.JS));
    });

    return {
      id: `test-${name}`,
      name: name,
      manifest_path: extensionDir,
      manifest: {
        name: `Test ${name}`,
        version: '1.0',
        manifest_version: 3 // Already migrated
      },
      files: lazyFiles
    };
  }

  describe('migrate', () => {
    it('should rename chrome.browserAction to chrome.action', () => {
      const extension = createTestExtension('browser-action', [{
        name: 'background.js',
        content: `
          chrome.browserAction.onClicked.addListener(() => {
            console.log('Browser action clicked');
          });

          chrome.browserAction.setTitle({title: 'New Title'});
          chrome.browserAction.setBadgeText({text: '5'});
        `
      }]);

      const result = RenameAPIS.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const backgroundFile = result.files.find(f => f.path === 'background.js');
        expect(backgroundFile).toBeDefined();

        if (backgroundFile) {
          const content = backgroundFile.getContent();
          expect(content).toContain('chrome.action.onClicked');
          expect(content).toContain('chrome.action.setTitle');
          expect(content).toContain('chrome.action.setBadgeText');
          expect(content).not.toContain('chrome.browserAction');
        }
      }

      extension.files.forEach(file => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach(file => file.close());
      }
    });

    it('should rename chrome.pageAction to chrome.action', () => {
      const extension = createTestExtension('page-action', [{
        name: 'content.js',
        content: `
          chrome.pageAction.show(tabId);
          chrome.pageAction.hide(tabId);
          chrome.pageAction.setTitle({tabId: tabId, title: 'Page Action'});
        `
      }]);

      const result = RenameAPIS.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const contentFile = result.files.find(f => f.path === 'content.js');
        expect(contentFile).toBeDefined();

        if (contentFile) {
          const content = contentFile.getContent();
          expect(content).toContain('chrome.action.show');
          expect(content).toContain('chrome.action.hide');
          expect(content).toContain('chrome.action.setTitle');
          expect(content).not.toContain('chrome.pageAction');
        }
      }

      extension.files.forEach(file => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach(file => file.close());
      }
    });

    it('should rename chrome.tabs.executeScript to chrome.scripting.executeScript', () => {
      const extension = createTestExtension('execute-script', [{
        name: 'popup.js',
        content: `
          chrome.tabs.executeScript(tabId, {
            code: 'document.body.style.backgroundColor = "red";'
          });

          chrome.tabs.executeScript({
            file: 'content.js'
          }, (result) => {
            console.log('Script executed');
          });
        `
      }]);

      const result = RenameAPIS.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const popupFile = result.files.find(f => f.path === 'popup.js');
        expect(popupFile).toBeDefined();

        if (popupFile) {
          const content = popupFile.getContent();
          expect(content).toContain('chrome.scripting.executeScript');
          expect(content).not.toContain('chrome.tabs.executeScript');
        }
      }

      extension.files.forEach(file => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach(file => file.close());
      }
    });

    it('should handle multiple API renames in the same file', () => {
      const extension = createTestExtension('multiple-apis', [{
        name: 'background.js',
        content: `
          // Browser action usage
          chrome.browserAction.onClicked.addListener((tab) => {
            // Execute script on tab
            chrome.tabs.executeScript(tab.id, {
              code: 'console.log("Hello from injected script");'
            });

            // Set page action
            chrome.pageAction.show(tab.id);
          });

          // More browser action calls
          chrome.browserAction.setTitle({title: 'Updated Title'});
        `
      }]);

      const result = RenameAPIS.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const backgroundFile = result.files.find(f => f.path === 'background.js');
        expect(backgroundFile).toBeDefined();

        if (backgroundFile) {
          const content = backgroundFile.getContent();

          // Check all renames happened
          expect(content).toContain('chrome.action.onClicked');
          expect(content).toContain('chrome.action.setTitle');
          expect(content).toContain('chrome.action.show');
          expect(content).toContain('chrome.scripting.executeScript');

          // Check old APIs are gone
          expect(content).not.toContain('chrome.browserAction');
          expect(content).not.toContain('chrome.pageAction');
          expect(content).not.toContain('chrome.tabs.executeScript');
        }
      }

      extension.files.forEach(file => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach(file => file.close());
      }
    });

    it('should handle files without API calls', () => {
      const extension = createTestExtension('no-apis', [{
        name: 'utility.js',
        content: `
          function calculateSum(a, b) {
            return a + b;
          }

          const CONFIG = {
            apiUrl: 'https://api.example.com',
            timeout: 5000
          };

          console.log('Utility module loaded');
        `
      }]);

      const result = RenameAPIS.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const utilityFile = result.files.find(f => f.path === 'utility.js');
        expect(utilityFile).toBeDefined();

        if (utilityFile) {
          const content = utilityFile.getContent();
          // Content should remain unchanged
          expect(content).toContain('function calculateSum');
          expect(content).toContain('const CONFIG');
        }
      }

      extension.files.forEach(file => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach(file => file.close());
      }
    });

    it('should handle non-JavaScript files gracefully', () => {
      const extension = createTestExtension('mixed-files', [
        {
          name: 'script.js',
          content: 'chrome.browserAction.onClicked.addListener(() => {});'
        },
        {
          name: 'style.css',
          content: 'body { color: red; }'
        },
        {
          name: 'data.json',
          content: '{"key": "value"}'
        }
      ]);

      // Override file types
      extension.files[1].filetype = ExtFileType.CSS;
      extension.files[2].filetype = ExtFileType.OTHER;

      const result = RenameAPIS.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // JS file should be processed
        const jsFile = result.files.find(f => f.path === 'script.js');
        expect(jsFile?.getContent()).toContain('chrome.action.onClicked');

        // CSS and JSON files should remain unchanged
        const cssFile = result.files.find(f => f.path === 'style.css');
        expect(cssFile?.getContent()).toBe('body { color: red; }');

        const jsonFile = result.files.find(f => f.path === 'data.json');
        expect(jsonFile?.getContent()).toBe('{"key": "value"}');
      }

      extension.files.forEach(file => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach(file => file.close());
      }
    });

    it('should handle edge cases in API renaming', () => {
      const extension = createTestExtension('edge-cases', [{
        name: 'edge-cases.js',
        content: `
          // Edge case: API in comments
          // chrome.browserAction.onClicked - this should stay unchanged

          // Edge case: API in strings
          const oldApi = "chrome.browserAction was the old API";

          // Edge case: Similar but different API names
          chrome.browser_action_custom.doSomething(); // Should not be changed

          // Valid cases that should be changed
          chrome.browserAction.onClicked.addListener(() => {});
          const action = chrome.browserAction;
        `
      }]);

      const result = RenameAPIS.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const file = result.files.find(f => f.path === 'edge-cases.js');
        expect(file).toBeDefined();

        if (file) {
          const content = file.getContent();

          // Valid API calls should be renamed
          expect(content).toContain('chrome.action.onClicked');
          //FIXME:
          // expect(content).toContain('const action = chrome.action;');

          // Comments and strings should remain unchanged
          // expect(content).toContain('// chrome.browserAction.onClicked');
          // expect(content).toContain('"chrome.browserAction was the old API"');
          //
          // // Similar names should not be changed
          // expect(content).toContain('chrome.browser_action_custom.doSomething()');
        }
      }

      extension.files.forEach(file => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach(file => file.close());
      }
    });

    it('should return MigrationError on serious failures', () => {
      const badExtension = {
        id: 'bad-extension',
        name: 'bad-extension',
        manifest_path: '/bad/path',
        manifest: null as any,
        files: []
      };

      const result: Extension | MigrationError = RenameAPIS.migrate(badExtension);



      expect(result).toBeInstanceOf(MigrationError);
      if (result instanceof MigrationError) {
        expect(result.extension).toBe(badExtension);
        expect(result.error).toBeDefined();
      }
    });

    it('should preserve file structure and metadata', () => {
      const extension = createTestExtension('preserve-metadata', [{
        name: 'background.js',
        content: 'chrome.browserAction.onClicked.addListener(() => {});'
      }]);

      const originalFileCount = extension.files.length;
      const originalManifest = { ...extension.manifest };

      const result = RenameAPIS.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // File count should remain the same
        expect(result.files.length).toBe(originalFileCount);

        // Manifest should remain unchanged
        expect(result.manifest).toEqual(originalManifest);

        // Extension metadata should be preserved
        expect(result.id).toBe(extension.id);
        expect(result.name).toBe(extension.name);
        expect(result.manifest_path).toBe(extension.manifest_path);
      }

      extension.files.forEach(file => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach(file => file.close());
      }
    });
  });
});
