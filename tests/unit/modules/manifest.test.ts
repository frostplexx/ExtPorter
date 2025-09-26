import { describe, it, expect, beforeEach } from '@jest/globals';
import { MigrateManifest } from '../../../migrator/modules/manifest';
import { Extension } from '../../../migrator/types/extension';
import { MigrationError } from '../../../migrator/types/migration_module';

describe('MigrateManifest', () => {
  let baseExtension: Extension;

  beforeEach(() => {
    baseExtension = {
      id: 'test-extension-id',
      name: 'Test Extension',
      manifest_path: '/test/path',
      manifest: {
        name: 'Test Extension',
        version: '1.0',
        manifest_version: 2,
        description: 'A test extension'
      },
      files: []
    };
  });

  describe('migrate', () => {
    it('should update manifest version from 2 to 3', () => {
      const result = MigrateManifest.migrate(baseExtension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        expect(result.manifest.manifest_version).toBe(3);
      }
    });

    it('should add Content Security Policy for MV3', () => {
      const result = MigrateManifest.migrate(baseExtension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        expect(result.manifest.content_security_policy).toEqual({
          extension_pages: "script-src 'self'; object-src 'self';"
        });
      }
    });

    describe('permissions migration', () => {
      it('should split permissions into API permissions and host permissions', () => {
        baseExtension.manifest.permissions = [
          'activeTab',
          'storage',
          'http://example.com/*',
          'https://api.example.com/*'
        ];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.permissions).toEqual(['activeTab', 'storage']);
          expect(result.manifest.host_permissions).toEqual([
            'http://example.com/*',
            'https://api.example.com/*'
          ]);
        }
      });

      it('should convert webRequestBlocking to declarativeNetRequest', () => {
        baseExtension.manifest.permissions = [
          'webRequestBlocking',
          'activeTab'
        ];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.permissions).toContain('declarativeNetRequest');
          expect(result.manifest.permissions).not.toContain('webRequestBlocking');
          expect(result.manifest.permissions).toContain('activeTab');
        }
      });

      it('should handle empty permissions array', () => {
        baseExtension.manifest.permissions = [];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.permissions).toEqual([]);
          expect(result.manifest.host_permissions).toEqual([]);
        }
      });

      it('should handle undefined permissions', () => {
        delete baseExtension.manifest.permissions;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.permissions).toEqual([]);
          expect(result.manifest.host_permissions).toEqual([]);
        }
      });
    });

    describe('web_accessible_resources migration', () => {
      it('should convert array format to object format', () => {
        baseExtension.manifest.web_accessible_resources = [
          'images/*',
          'styles/content.css',
          'scripts/injected.js'
        ];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.web_accessible_resources).toEqual([{
            resources: ['images/*', 'styles/content.css', 'scripts/injected.js'],
            matches: ['*://*/*']
          }]);
        }
      });

      it('should handle empty web_accessible_resources', () => {
        baseExtension.manifest.web_accessible_resources = [];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.web_accessible_resources).toEqual([{
            resources: [],
            matches: ['*://*/*']
          }]);
        }
      });

      it('should handle undefined web_accessible_resources', () => {
        // web_accessible_resources not set

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Should not modify if undefined
          expect(result.manifest.web_accessible_resources).toBeUndefined();
        }
      });
    });

    describe('action migration', () => {
      it('should migrate browser_action to action', () => {
        baseExtension.manifest.browser_action = {
          default_popup: 'popup.html',
          default_title: 'Test Extension',
          default_icon: {
            16: 'icon16.png',
            48: 'icon48.png'
          }
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.action).toEqual({
            default_popup: 'popup.html',
            default_title: 'Test Extension',
            default_icon: {
              16: 'icon16.png',
              48: 'icon48.png'
            }
          });
          expect(result.manifest.browser_action).toBeUndefined();
        }
      });

      it('should migrate page_action to action', () => {
        baseExtension.manifest.page_action = {
          default_popup: 'page_popup.html',
          default_title: 'Page Action'
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.action).toEqual({
            default_popup: 'page_popup.html',
            default_title: 'Page Action'
          });
          expect(result.manifest.page_action).toBeUndefined();
        }
      });

      it('should handle both browser_action and page_action', () => {
        baseExtension.manifest.browser_action = {
          default_popup: 'browser_popup.html'
        };
        baseExtension.manifest.page_action = {
          default_title: 'Page Title'
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Should merge both actions
          expect(result.manifest.action).toBeDefined();
          expect(result.manifest.browser_action).toBeUndefined();
          expect(result.manifest.page_action).toBeUndefined();
        }
      });

      it('should handle no actions', () => {
        // No browser_action or page_action

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.action).toBeUndefined();
        }
      });
    });

    describe('background migration', () => {
      it('should convert background scripts to service worker', () => {
        baseExtension.manifest.background = {
          scripts: ['background.js', 'helper.js'],
          persistent: false
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.background).toEqual({
            service_worker: 'background.js'
          });
        }
      });

      it('should convert background page to service worker', () => {
        baseExtension.manifest.background = {
          page: 'background.html',
          persistent: true
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.background).toEqual({
            service_worker: 'background.html'
          });
        }
      });

      it('should handle single background script', () => {
        baseExtension.manifest.background = {
          scripts: ['single-script.js']
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.background).toEqual({
            service_worker: 'single-script.js'
          });
        }
      });

      it('should handle empty background scripts', () => {
        baseExtension.manifest.background = {
          scripts: []
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Should not set service_worker if no scripts
          expect(result.manifest.background).toEqual({});
        }
      });

      it('should handle undefined background', () => {
        // No background field

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.background).toBeUndefined();
        }
      });

      it('should handle background with service_worker already set', () => {
        baseExtension.manifest.background = {
          service_worker: 'existing-worker.js'
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Should preserve existing service_worker
          expect(result.manifest.background).toEqual({
            service_worker: 'existing-worker.js'
          });
        }
      });
    });

    describe('error handling', () => {
      it('should return MigrationError when manifest is corrupted', () => {
        const corruptedExtension = {
          ...baseExtension,
          manifest: null as any
        };

        const result = MigrateManifest.migrate(corruptedExtension);

        expect(result).toBeInstanceOf(MigrationError);
        if (result instanceof MigrationError) {
          expect(result.extension).toBe(corruptedExtension);
          expect(result.error).toBeDefined();
        }
      });

      it('should handle invalid permissions gracefully', () => {
        baseExtension.manifest.permissions = [
          null, // Invalid permission
          'activeTab',
          undefined,
          'storage'
        ];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Should filter out invalid permissions
          expect(result.manifest.permissions).toEqual(['activeTab', 'storage']);
        }
      });
    });

    describe('complex scenarios', () => {
      it('should handle complete extension migration', () => {
        const complexExtension: Extension = {
          id: 'complex-extension',
          name: 'Complex Extension',
          manifest_path: '/complex/path',
          manifest: {
            name: 'Complex Extension',
            version: '2.0',
            manifest_version: 2,
            description: 'A complex test extension',
            permissions: [
              'activeTab',
              'storage',
              'webRequestBlocking',
              'http://example.com/*',
              'https://api.example.com/*'
            ],
            web_accessible_resources: [
              'images/*',
              'css/content.css'
            ],
            browser_action: {
              default_popup: 'popup.html',
              default_title: 'Complex Extension'
            },
            background: {
              scripts: ['background.js', 'helper.js'],
              persistent: false
            },
            content_scripts: [{
              matches: ['<all_urls>'],
              js: ['content.js']
            }]
          },
          files: []
        };

        const result = MigrateManifest.migrate(complexExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Verify all transformations
          expect(result.manifest.manifest_version).toBe(3);
          expect(result.manifest.permissions).toEqual(['activeTab', 'storage', 'declarativeNetRequest']);
          expect(result.manifest.host_permissions).toEqual(['http://example.com/*', 'https://api.example.com/*']);
          expect(result.manifest.web_accessible_resources).toEqual([{
            resources: ['images/*', 'css/content.css'],
            matches: ['*://*/*']
          }]);
          expect(result.manifest.action).toEqual({
            default_popup: 'popup.html',
            default_title: 'Complex Extension'
          });
          expect(result.manifest.background).toEqual({
            service_worker: 'background.js'
          });
          expect(result.manifest.content_security_policy).toEqual({
            extension_pages: "script-src 'self'; object-src 'self';"
          });
          expect(result.manifest.browser_action).toBeUndefined();
          expect(result.manifest.content_scripts).toEqual([{
            matches: ['<all_urls>'],
            js: ['content.js']
          }]);
        }
      });
    });
  });
});
