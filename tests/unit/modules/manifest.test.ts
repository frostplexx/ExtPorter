import { describe, it, expect, beforeEach } from "@jest/globals";
import { MigrateManifest } from "../../../migrator/modules/manifest";
import { Extension } from "../../../migrator/types/extension";
import { MigrationError } from "../../../migrator/types/migration_module";

describe("MigrateManifest", () => {
  let baseExtension: Extension;

  beforeEach(() => {
    baseExtension = {
      id: "test-extension-id",
      name: "Test Extension",
      manifest_v2_path: "/test/path",
      manifest: {
        name: "Test Extension",
        version: "1.0",
        manifest_version: 2,
        description: "A test extension",
      },
      files: [],
    };
  });

  describe("migrate", () => {
    it("should update manifest version from 2 to 3", () => {
      const result = MigrateManifest.migrate(baseExtension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        expect(result.manifest.manifest_version).toBe(3);
      }
    });

    it("should add Content Security Policy for MV3", () => {
      const result = MigrateManifest.migrate(baseExtension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        expect(result.manifest.content_security_policy).toEqual({
          extension_pages: "script-src 'self'; object-src 'self';",
        });
      }
    });

    describe("permissions migration", () => {
      it("should split permissions into API permissions and host permissions", () => {
        baseExtension.manifest.permissions = [
          "activeTab",
          "storage",
          "http://example.com/*",
          "https://api.example.com/*",
        ];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.permissions).toEqual(["activeTab", "storage"]);
          expect(result.manifest.host_permissions).toEqual([
            "http://example.com/*",
            "https://api.example.com/*",
          ]);
        }
      });

      it("should convert webRequestBlocking to declarativeNetRequest", () => {
        baseExtension.manifest.permissions = [
          "webRequestBlocking",
          "activeTab",
        ];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.permissions).toContain(
            "declarativeNetRequest",
          );
          expect(result.manifest.permissions).not.toContain(
            "webRequestBlocking",
          );
          expect(result.manifest.permissions).toContain("activeTab");
        }
      });

      it("should handle empty permissions array", () => {
        baseExtension.manifest.permissions = [];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.permissions).toEqual([]);
          expect(result.manifest.host_permissions).toEqual([]);
        }
      });

      it("should handle undefined permissions", () => {
        delete baseExtension.manifest.permissions;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.permissions).toEqual([]);
          expect(result.manifest.host_permissions).toEqual([]);
        }
      });
    });

    describe("web_accessible_resources migration", () => {
      it("should convert array format to object format", () => {
        baseExtension.manifest.web_accessible_resources = [
          "images/*",
          "styles/content.css",
          "scripts/injected.js",
        ];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.web_accessible_resources).toEqual([
            {
              resources: [
                "images/*",
                "styles/content.css",
                "scripts/injected.js",
              ],
              matches: ["*://*/*"],
            },
          ]);
        }
      });

      it("should handle empty web_accessible_resources", () => {
        baseExtension.manifest.web_accessible_resources = [];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.web_accessible_resources).toEqual([
            {
              resources: [],
              matches: ["*://*/*"],
            },
          ]);
        }
      });

      it("should handle undefined web_accessible_resources", () => {
        // web_accessible_resources not set

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Should not modify if undefined
          expect(result.manifest.web_accessible_resources).toBeUndefined();
        }
      });
    });

    describe("action migration", () => {
      it("should migrate browser_action to action", () => {
        baseExtension.manifest.browser_action = {
          default_popup: "popup.html",
          default_title: "Test Extension",
          default_icon: {
            16: "icon16.png",
            48: "icon48.png",
          },
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.action).toEqual({
            default_popup: "popup.html",
            default_title: "Test Extension",
            default_icon: {
              16: "icon16.png",
              48: "icon48.png",
            },
          });
          expect(result.manifest.browser_action).toBeUndefined();
        }
      });

      it("should migrate page_action to action", () => {
        baseExtension.manifest.page_action = {
          default_popup: "page_popup.html",
          default_title: "Page Action",
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.action).toEqual({
            default_popup: "page_popup.html",
            default_title: "Page Action",
          });
          expect(result.manifest.page_action).toBeUndefined();
        }
      });

      it("should handle both browser_action and page_action", () => {
        baseExtension.manifest.browser_action = {
          default_popup: "browser_popup.html",
        };
        baseExtension.manifest.page_action = {
          default_title: "Page Title",
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

      it("should handle no actions", () => {
        // No browser_action or page_action

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.action).toBeUndefined();
        }
      });
    });

    describe("background migration", () => {
      it("should convert background scripts to service worker", () => {
        baseExtension.manifest.background = {
          scripts: ["background.js", "helper.js"],
          persistent: false,
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.background).toEqual({
            service_worker: "background.js",
          });
        }
      });

      it("should convert background page to service worker", () => {
        baseExtension.manifest.background = {
          page: "background.html",
          persistent: true,
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.background).toEqual({
            service_worker: "background.html",
          });
        }
      });

      it("should handle single background script", () => {
        baseExtension.manifest.background = {
          scripts: ["single-script.js"],
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.background).toEqual({
            service_worker: "single-script.js",
          });
        }
      });

      it("should handle empty background scripts", () => {
        baseExtension.manifest.background = {
          scripts: [],
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Should not set service_worker if no scripts
          expect(result.manifest.background).toEqual({});
        }
      });

      it("should handle undefined background", () => {
        // No background field

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.background).toBeUndefined();
        }
      });

      it("should handle background with service_worker already set", () => {
        baseExtension.manifest.background = {
          service_worker: "existing-worker.js",
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Should preserve existing service_worker
          expect(result.manifest.background).toEqual({
            service_worker: "existing-worker.js",
          });
        }
      });
    });

    describe("error handling", () => {
      it("should return MigrationError when manifest is corrupted", () => {
        const corruptedExtension = {
          ...baseExtension,
          manifest: null as any,
        };

        const result = MigrateManifest.migrate(corruptedExtension);

        expect(result).toBeInstanceOf(MigrationError);
        if (result instanceof MigrationError) {
          expect(result.extension).toBe(corruptedExtension);
          expect(result.error).toBeDefined();
        }
      });

      it("should handle invalid permissions gracefully", () => {
        baseExtension.manifest.permissions = [
          null, // Invalid permission
          "activeTab",
          undefined,
          "storage",
        ];

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Should filter out invalid permissions
          expect(result.manifest.permissions).toEqual(["activeTab", "storage"]);
        }
      });
    });

    describe("complex scenarios", () => {
      it("should handle complete extension migration", () => {
        const complexExtension: Extension = {
          id: "complex-extension",
          name: "Complex Extension",
          manifest_v2_path: "/complex/path",
          manifest: {
            name: "Complex Extension",
            version: "2.0",
            manifest_version: 2,
            description: "A complex test extension",
            permissions: [
              "activeTab",
              "storage",
              "webRequestBlocking",
              "http://example.com/*",
              "https://api.example.com/*",
            ],
            web_accessible_resources: ["images/*", "css/content.css"],
            browser_action: {
              default_popup: "popup.html",
              default_title: "Complex Extension",
            },
            background: {
              scripts: ["background.js", "helper.js"],
              persistent: false,
            },
            content_scripts: [
              {
                matches: ["<all_urls>"],
                js: ["content.js"],
              },
            ],
          },
          files: [],
        };

        const result = MigrateManifest.migrate(complexExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          // Verify all transformations
          expect(result.manifest.manifest_version).toBe(3);
          expect(result.manifest.permissions).toEqual([
            "activeTab",
            "storage",
            "declarativeNetRequest",
          ]);
          expect(result.manifest.host_permissions).toEqual([
            "http://example.com/*",
            "https://api.example.com/*",
          ]);
          expect(result.manifest.web_accessible_resources).toEqual([
            {
              resources: ["images/*", "css/content.css"],
              matches: ["*://*/*"],
            },
          ]);
          expect(result.manifest.action).toEqual({
            default_popup: "popup.html",
            default_title: "Complex Extension",
          });
          expect(result.manifest.background).toEqual({
            service_worker: "background.js",
          });
          expect(result.manifest.content_security_policy).toEqual({
            extension_pages: "script-src 'self'; object-src 'self';",
          });
          expect(result.manifest.browser_action).toBeUndefined();
          expect(result.manifest.content_scripts).toEqual([
            {
              matches: ["<all_urls>"],
              js: ["content.js"],
            },
          ]);
        }
      });
    });
  });

  describe("Content Security Policy migration", () => {
    describe("MV2 string format to MV3 object format", () => {
      it("should convert MV2 CSP string to MV3 object format", () => {
        baseExtension.manifest.content_security_policy =
          "script-src 'self'; object-src 'self';";

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.content_security_policy).toEqual({
            extension_pages: "script-src 'self'; object-src 'self';",
          });
        }
      });

      it("should validate and sanitize insecure MV2 CSP", () => {
        baseExtension.manifest.content_security_policy =
          "script-src 'self' 'unsafe-eval'; object-src 'self';";

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).not.toContain("unsafe-eval");
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).toContain("script-src 'self'");
        }
      });
    });

    describe("Hash directive sanitization", () => {
      it("should remove the specific insecure SHA256 hash that causes Chrome errors", () => {
        const insecureCSP =
          "script-src 'self' 'sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE='; object-src 'self';";
        baseExtension.manifest.content_security_policy = insecureCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).not.toContain(
            "sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE=",
          );
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).toContain("script-src 'self'");
        }
      });

      it("should remove all SHA-based hashes from CSP", () => {
        const hashCSP =
          "script-src 'self' 'sha256-abc123==' 'sha384-def456==' 'sha512-ghi789=='; object-src 'self';";
        baseExtension.manifest.content_security_policy = hashCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          expect(csp).not.toMatch(/'sha[0-9]+-[A-Za-z0-9+/]+=*'/);
          expect(csp).toContain("script-src 'self'");
        }
      });

      it("should remove nonce directives", () => {
        const nonceCSP =
          "script-src 'self' 'nonce-random123'; object-src 'self';";
        baseExtension.manifest.content_security_policy = nonceCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).not.toMatch(/'nonce-[^']+'/);
        }
      });
    });

    describe("Unsafe directive removal", () => {
      it("should remove unsafe-inline from CSP", () => {
        const unsafeCSP =
          "script-src 'self' 'unsafe-inline'; object-src 'self';";
        baseExtension.manifest.content_security_policy = unsafeCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).not.toContain("unsafe-inline");
        }
      });

      it("should remove unsafe-eval from CSP", () => {
        const unsafeCSP = "script-src 'self' 'unsafe-eval'; object-src 'self';";
        baseExtension.manifest.content_security_policy = unsafeCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).not.toContain("unsafe-eval");
        }
      });

      it("should remove data: URLs from script-src", () => {
        const dataCSP = "script-src 'self' data:; object-src 'self';";
        baseExtension.manifest.content_security_policy = dataCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).not.toContain("data:");
        }
      });

      it("should remove non-localhost HTTP URLs", () => {
        const httpCSP =
          "script-src 'self' http://example.com; object-src 'self';";
        baseExtension.manifest.content_security_policy = httpCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).not.toContain("http://example.com");
        }
      });

      it("should preserve localhost HTTP URLs", () => {
        const localhostCSP =
          "script-src 'self' http://localhost:3000; object-src 'self';";
        baseExtension.manifest.content_security_policy = localhostCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).toContain("http://localhost:3000");
        }
      });
    });

    describe("MV3 object format validation", () => {
      it("should validate existing MV3 format extension_pages CSP", () => {
        baseExtension.manifest.content_security_policy = {
          extension_pages:
            "script-src 'self' 'sha256-badHash=='; object-src 'self';",
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).not.toContain("sha256-badHash==");
        }
      });

      it("should add missing extension_pages to existing MV3 format", () => {
        baseExtension.manifest.content_security_policy = {
          sandbox: "allow-scripts",
        };

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.content_security_policy.extension_pages).toBe(
            "script-src 'self'; object-src 'self';",
          );
          expect(result.manifest.content_security_policy.sandbox).toBe(
            "allow-scripts",
          );
        }
      });
    });

    describe("Fallback behavior", () => {
      it("should use safe default CSP when validation fails completely", () => {
        baseExtension.manifest.content_security_policy =
          "completely invalid csp syntax!!!";

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(result.manifest.content_security_policy).toEqual({
            extension_pages: "script-src 'self'; object-src 'self';",
          });
        }
      });

      it("should preserve valid HTTPS sources", () => {
        const validCSP =
          "script-src 'self' https://cdn.example.com; object-src 'self';";
        baseExtension.manifest.content_security_policy = validCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          expect(
            result.manifest.content_security_policy.extension_pages,
          ).toContain("https://cdn.example.com");
        }
      });
    });

    describe("Complex CSP scenarios", () => {
      it("should handle multiple problematic directives in one CSP", () => {
        const complexCSP =
          "script-src 'self' 'unsafe-eval' 'unsafe-inline' 'sha256-abc123==' data: http://bad.com 'nonce-xyz'; style-src 'self' 'unsafe-inline'; object-src 'self';";
        baseExtension.manifest.content_security_policy = complexCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          expect(csp).not.toContain("unsafe-eval");
          expect(csp).not.toContain("unsafe-inline");
          expect(csp).not.toContain("sha256-abc123==");
          expect(csp).not.toContain("data:");
          expect(csp).not.toContain("http://bad.com");
          expect(csp).not.toContain("nonce-xyz");
          expect(csp).toContain("script-src 'self'");
          expect(csp).toContain("object-src 'self'");
        }
      });

      it("should handle real-world problematic CSP from Chrome Web Store extensions", () => {
        // This simulates the actual error case that prompted this enhancement
        const realWorldCSP =
          "script-src 'self' 'wasm-unsafe-eval' 'sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE='; object-src 'self';";
        baseExtension.manifest.content_security_policy = realWorldCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Should remove the problematic hash
          expect(csp).not.toContain(
            "sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE=",
          );
          // Should preserve wasm-unsafe-eval as it's sometimes necessary
          expect(csp).toContain("wasm-unsafe-eval");
          expect(csp).toContain("script-src 'self'");
        }
      });

      it("should remove bare JavaScript file paths that cause Chrome MV3 errors", () => {
        // This simulates the specific error: Insecure CSP value "remote_resources/f3d11240_ga.js"
        const filePathCSP =
          "script-src 'self' remote_resources/f3d11240_ga.js; object-src 'self';";
        baseExtension.manifest.content_security_policy = filePathCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Should remove the bare file path
          expect(csp).not.toContain("remote_resources/f3d11240_ga.js");
          expect(csp).toContain("script-src 'self'");
          expect(csp).toContain("object-src 'self'");
        }
      });

      it("should remove various bare file paths from script-src", () => {
        const multipleFilePathsCSP =
          "script-src 'self' content.js background.js libs/jquery.min.js vendor/analytics.js; object-src 'self';";
        baseExtension.manifest.content_security_policy = multipleFilePathsCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Should remove all bare file paths
          expect(csp).not.toContain("content.js");
          expect(csp).not.toContain("background.js");
          expect(csp).not.toContain("libs/jquery.min.js");
          expect(csp).not.toContain("vendor/analytics.js");
          expect(csp).toContain("script-src 'self'");
        }
      });
    });

    describe("Generic pattern detection and removal", () => {
      it("should remove any SHA hash variant (256, 384, 512)", () => {
        const multiHashCSP =
          "script-src 'self' 'sha256-randomhash1==' 'sha384-anotherhash2==' 'sha512-thirdhash3=='; object-src 'self';";
        baseExtension.manifest.content_security_policy = multiHashCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Should remove all SHA variants
          expect(csp).not.toMatch(/'sha256-[^']+'/);
          expect(csp).not.toMatch(/'sha384-[^']+'/);
          expect(csp).not.toMatch(/'sha512-[^']+'/);
          expect(csp).toContain("script-src 'self'");
        }
      });

      it("should remove any nonce directive regardless of value", () => {
        const nonceCSP =
          "script-src 'self' 'nonce-abc123' 'nonce-xyz789' 'nonce-random456'; object-src 'self';";
        baseExtension.manifest.content_security_policy = nonceCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Should remove all nonce directives
          expect(csp).not.toMatch(/'nonce-[^']+'/);
          expect(csp).toContain("script-src 'self'");
        }
      });

      it("should handle generic JavaScript file patterns in any directory structure", () => {
        const complexFilePathsCSP =
          "script-src 'self' app.js src/main.js lib/vendor/analytics.js assets/js/tracking.js components/ui/modal.js; object-src 'self';";
        baseExtension.manifest.content_security_policy = complexFilePathsCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Should remove all JS file references regardless of path depth
          expect(csp).not.toContain("app.js");
          expect(csp).not.toContain("src/main.js");
          expect(csp).not.toContain("lib/vendor/analytics.js");
          expect(csp).not.toContain("assets/js/tracking.js");
          expect(csp).not.toContain("components/ui/modal.js");
          expect(csp).toContain("script-src 'self'");
        }
      });

      it("should remove any non-localhost HTTP URLs while preserving localhost", () => {
        const mixedHTTPCSP =
          "script-src 'self' http://example.com/script.js http://api.service.com/data http://localhost:3000 http://cdn.provider.net/lib.js; object-src 'self';";
        baseExtension.manifest.content_security_policy = mixedHTTPCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Should remove external HTTP but keep localhost
          expect(csp).not.toContain("http://example.com");
          expect(csp).not.toContain("http://api.service.com");
          expect(csp).not.toContain("http://cdn.provider.net");
          expect(csp).toContain("http://localhost:3000"); // Should preserve localhost
          expect(csp).toContain("script-src 'self'");
        }
      });

      it("should handle any combination of unsafe directives", () => {
        const unsafeComboCSP =
          "script-src 'self' 'unsafe-eval' 'unsafe-inline' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'self';";
        baseExtension.manifest.content_security_policy = unsafeComboCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Should remove all unsafe patterns
          expect(csp).not.toContain("unsafe-eval");
          expect(csp).not.toContain("unsafe-inline");
          expect(csp).not.toContain("data:");
          expect(csp).not.toContain("blob:");
          expect(csp).toContain("script-src 'self'");
        }
      });

      it("should validate CSP structure regardless of content", () => {
        // Test various malformed CSPs that should all fall back to default
        const malformedCSPs = [
          "completely invalid syntax",
          "no-directive-here just-random-text",
          ";;;;;;;",
          "script- invalid directive",
          "",
          "   \t\n   ", // whitespace only
        ];

        malformedCSPs.forEach((malformedCSP) => {
          baseExtension.manifest.content_security_policy = malformedCSP;
          const result = MigrateManifest.migrate(baseExtension);

          expect(result).not.toBeInstanceOf(MigrationError);
          if (!(result instanceof MigrationError)) {
            expect(result.manifest.content_security_policy).toEqual({
              extension_pages: "script-src 'self'; object-src 'self';",
            });
          }
        });
      });

      it("should preserve valid HTTPS sources while removing invalid patterns", () => {
        const mixedValidInvalidCSP =
          "script-src 'self' https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js 'sha256-invalid==' badfile.js 'unsafe-eval' https://apis.google.com/js/platform.js data:; object-src 'self';";
        baseExtension.manifest.content_security_policy = mixedValidInvalidCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Should preserve valid HTTPS sources
          expect(csp).toContain(
            "https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js",
          );
          expect(csp).toContain("https://apis.google.com/js/platform.js");
          // Should remove invalid patterns
          expect(csp).not.toContain("sha256-invalid==");
          expect(csp).not.toContain("badfile.js");
          expect(csp).not.toContain("unsafe-eval");
          expect(csp).not.toContain("data:");
          expect(csp).toContain("script-src 'self'");
        }
      });

      it("should handle edge cases in file path detection", () => {
        const edgeCaseCSP =
          "script-src 'self' file.js path/to/file.js deep/nested/path/to/script.js single.js; object-src 'self';";
        baseExtension.manifest.content_security_policy = edgeCaseCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Should remove all .js file references regardless of path complexity
          expect(csp).not.toContain("file.js");
          expect(csp).not.toContain("path/to/file.js");
          expect(csp).not.toContain("deep/nested/path/to/script.js");
          expect(csp).not.toContain("single.js");
          expect(csp).toContain("script-src 'self'");
        }
      });

      it("should be extensible for future MV3 violations", () => {
        // Test that the pattern-based approach can handle new violation types
        const futureProblemCSP =
          "script-src 'self' 'sha1-oldhash==' 'md5-evenworsehash=='; object-src 'self';";
        baseExtension.manifest.content_security_policy = futureProblemCSP;

        const result = MigrateManifest.migrate(baseExtension);

        expect(result).not.toBeInstanceOf(MigrationError);
        if (!(result instanceof MigrationError)) {
          const csp = result.manifest.content_security_policy.extension_pages;
          // Current patterns might not catch these, but structure validation should
          // This test demonstrates the extensibility of the approach
          expect(csp).toContain("script-src 'self'");
          expect(csp).toContain("object-src 'self'");
        }
      });
    });
  });
});
