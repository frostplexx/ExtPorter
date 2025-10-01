/**
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

// Load the bridge file content for testing
const bridgePath = path.join(__dirname, '../../../migrator/templates/ext_bridge.js');

describe('ext_bridge.js structure and content', () => {
  let bridgeContent: string;

  beforeAll(() => {
    bridgeContent = fs.readFileSync(bridgePath, 'utf8');
  });

  describe('bridge file structure', () => {
    test('should exist and be readable', () => {
      expect(bridgeContent).toBeDefined();
      expect(bridgeContent.length).toBeGreaterThan(0);
    });

    test('should be wrapped in IIFE to avoid global pollution', () => {
      expect(bridgeContent).toMatch(/^\s*\(function\s*\(\)\s*\{/);
      expect(bridgeContent).toMatch(/\}\)\(\);\s*$/);
    });

    test('should include bridge loaded check', () => {
      expect(bridgeContent).toContain('_chromeExtBridgeLoaded');
      expect(bridgeContent).toContain('if (window._chromeExtBridgeLoaded)');
    });

    test('should check for chrome object availability', () => {
      expect(bridgeContent).toContain('window.chrome');
      expect(bridgeContent).toContain('originalChrome');
    });
  });

  describe('core functionality', () => {
    test('should use generic callback detection without hardcoded API list', () => {
      expect(bridgeContent).toContain('typeof lastArg === \'function\'');
      expect(bridgeContent).toContain('if (typeof lastArg === \'function\')');
      // Should NOT contain hardcoded API mappings
      expect(bridgeContent).not.toContain('ASYNC_APIS');
      expect(bridgeContent).not.toContain('new Set([');
    });

    test('should define createCallbackCompatibleMethod function', () => {
      expect(bridgeContent).toContain('createCallbackCompatibleMethod');
      expect(bridgeContent).toContain('function createCallbackCompatibleMethod');
    });

    test('should define wrapChromeAPI function', () => {
      expect(bridgeContent).toContain('wrapChromeAPI');
      expect(bridgeContent).toContain('function wrapChromeAPI');
    });

    test('should handle chrome.runtime.lastError', () => {
      expect(bridgeContent).toContain('chrome.runtime.lastError');
      expect(bridgeContent).toContain('delete chrome.runtime.lastError');
    });
  });

  describe('error handling', () => {
    test('should handle promise rejections', () => {
      expect(bridgeContent).toContain('.catch(error =>');
      expect(bridgeContent).toContain('chrome.runtime.lastError = {');
      expect(bridgeContent).toContain('message: error.message || \'Unknown error\'');
    });

    test('should handle synchronous errors', () => {
      expect(bridgeContent).toContain('try {');
      expect(bridgeContent).toContain('} catch (error) {');
    });

    test('should clean up lastError after callback', () => {
      expect(bridgeContent).toContain('setTimeout(() => delete chrome.runtime.lastError');
      expect(bridgeContent).toContain('delete chrome.runtime.lastError');
    });
  });

  describe('callback detection', () => {
    test('should detect function callbacks', () => {
      expect(bridgeContent).toContain('typeof lastArg === \'function\'');
      expect(bridgeContent).toContain('const lastArg = args[args.length - 1]');
    });

    test('should use generic callback detection logic', () => {
      expect(bridgeContent).toContain('if (typeof lastArg === \'function\')');
      // Should NOT check API whitelist
      expect(bridgeContent).not.toContain('ASYNC_APIS.has');
    });
  });

  describe('compatibility features', () => {
    test('should include legacy callbackify function', () => {
      expect(bridgeContent).toContain('function callbackify');
      expect(bridgeContent).toContain('const cb = args.pop()');
    });

    test('should export functions for testing', () => {
      expect(bridgeContent).toContain('module.exports');
      expect(bridgeContent).toContain('createCallbackCompatibleMethod');
      expect(bridgeContent).toContain('wrapChromeAPI');
      expect(bridgeContent).toContain('callbackify');
      // Should NOT export ASYNC_APIS since it no longer exists
      expect(bridgeContent).not.toContain('ASYNC_APIS');
    });
  });

  describe('runtime preservation', () => {
    test('should ensure runtime object exists', () => {
      expect(bridgeContent).toContain('if (!wrappedChrome.runtime)');
      expect(bridgeContent).toContain('wrappedChrome.runtime = {}');
    });

    test('should handle runtime object creation', () => {
      expect(bridgeContent).toContain('if (!chrome.runtime)');
      expect(bridgeContent).toContain('chrome.runtime = {}');
    });
  });

  describe('code quality', () => {
    test('should use strict mode', () => {
      expect(bridgeContent).toContain('\'use strict\'');
    });

    test('should avoid infinite recursion with runtime', () => {
      expect(bridgeContent).toContain('key !== \'runtime\'');
    });

    test('should handle null and undefined values', () => {
      expect(bridgeContent).toContain('if (!obj || typeof obj !== \'object\')');
      expect(bridgeContent).toContain('value !== null');
    });
  });

  describe('generic compatibility', () => {
    test('should work with any Chrome API that uses callbacks', () => {
      // Bridge should not contain hardcoded API lists
      expect(bridgeContent).not.toContain('chrome.storage.local.get');
      expect(bridgeContent).not.toContain('chrome.tabs.query');

      // Instead, it should use generic detection
      expect(bridgeContent).toContain('typeof lastArg === \'function\'');
      expect(bridgeContent).toContain('if (typeof lastArg === \'function\')');
    });
  });
});
