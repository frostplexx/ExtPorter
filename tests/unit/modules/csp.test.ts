import { describe, it, expect, beforeEach } from '@jest/globals';
import { MigrateCSP } from '../../../migrator/modules/csp';
import { cspValidator } from '../../../migrator/modules/csp/csp-validator';
import { Extension } from '../../../migrator/types/extension';
import { MigrationError } from '../../../migrator/types/migration_module';

describe('MigrateCSP', () => {
    let baseExtension: Extension;

    beforeEach(() => {
        baseExtension = {
            id: 'test-extension-id',
            name: 'Test Extension',
            manifest_v2_path: '/test/path',
            manifest: {
                name: 'Test Extension',
                version: '1.0',
                manifest_version: 3,
                description: 'A test extension',
            },
            files: [],
        };
    });

    describe('migrate', () => {
        it('should add default CSP when no CSP is present', async () => {
            const result = await MigrateCSP.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.manifest.content_security_policy).toHaveProperty('extension_pages');
                expect(result.manifest.content_security_policy).toHaveProperty('sandbox');
                expect(result.manifest.content_security_policy.extension_pages).toBe(
                    "script-src 'self'; object-src 'self';"
                );
            }
        });

        describe('MV2 string format to MV3 object format', () => {
            it('should convert MV2 CSP string to MV3 object format', async () => {
                baseExtension.manifest.content_security_policy =
                    "script-src 'self'; object-src 'self';";

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy).toHaveProperty(
                        'extension_pages'
                    );
                    expect(result.manifest.content_security_policy).toHaveProperty('sandbox');
                    expect(result.manifest.content_security_policy.extension_pages).toBe(
                        "script-src 'self'; object-src 'self';"
                    );
                }
            });

            it('should validate and sanitize insecure MV2 CSP', async () => {
                baseExtension.manifest.content_security_policy =
                    "script-src 'self' 'unsafe-eval'; object-src 'self';";

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'unsafe-eval'
                    );
                    expect(result.manifest.content_security_policy.extension_pages).toContain(
                        "script-src 'self'"
                    );
                }
            });
        });

        describe('MV3 allowed directives', () => {
            it('should strip SHA256 hashes from extension_pages as they are not allowed in MV3', async () => {
                const hashCSP = "script-src 'self' 'sha256-abc123=='; object-src 'self';";
                baseExtension.manifest.content_security_policy = hashCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        "'sha256-abc123=='"
                    );
                    expect(result.manifest.content_security_policy.extension_pages).toContain(
                        "script-src 'self'"
                    );
                }
            });

            it('should strip all SHA hash variants (256, 384, 512) from extension_pages', async () => {
                const hashCSP =
                    "script-src 'self' 'sha256-abc123==' 'sha384-def456==' 'sha512-ghi789=='; object-src 'self';";
                baseExtension.manifest.content_security_policy = hashCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain("'sha256-abc123=='");
                    expect(csp).not.toContain("'sha384-def456=='");
                    expect(csp).not.toContain("'sha512-ghi789=='");
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should strip nonce directives from extension_pages as they are not allowed in MV3', async () => {
                const nonceCSP = "script-src 'self' 'nonce-random123'; object-src 'self';";
                baseExtension.manifest.content_security_policy = nonceCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        "'nonce-random123'"
                    );
                    expect(result.manifest.content_security_policy.extension_pages).toContain(
                        "script-src 'self'"
                    );
                }
            });

            it('should preserve wasm-unsafe-eval as it is allowed in MV3', async () => {
                const wasmCSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";
                baseExtension.manifest.content_security_policy = wasmCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).toContain(
                        "'wasm-unsafe-eval'"
                    );
                }
            });
        });

        describe('Unsafe directive removal', () => {
            it('should remove unsafe-inline from CSP', async () => {
                const unsafeCSP = "script-src 'self' 'unsafe-inline'; object-src 'self';";
                baseExtension.manifest.content_security_policy = unsafeCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'unsafe-inline'
                    );
                }
            });

            it('should remove unsafe-eval from CSP', async () => {
                const unsafeCSP = "script-src 'self' 'unsafe-eval'; object-src 'self';";
                baseExtension.manifest.content_security_policy = unsafeCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'unsafe-eval'
                    );
                }
            });

            it('should remove data: URLs from script-src', async () => {
                const dataCSP = "script-src 'self' data:; object-src 'self';";
                baseExtension.manifest.content_security_policy = dataCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'data:'
                    );
                }
            });

            it('should remove blob: URLs from script-src', async () => {
                const blobCSP = "script-src 'self' blob:; object-src 'self';";
                baseExtension.manifest.content_security_policy = blobCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'blob:'
                    );
                }
            });

            it('should remove non-localhost HTTP URLs', async () => {
                const httpCSP = "script-src 'self' http://example.com; object-src 'self';";
                baseExtension.manifest.content_security_policy = httpCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'http://example.com'
                    );
                }
            });

            it('should preserve localhost HTTP URLs', async () => {
                const localhostCSP = "script-src 'self' http://localhost:3000; object-src 'self';";
                baseExtension.manifest.content_security_policy = localhostCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).toContain(
                        'http://localhost:3000'
                    );
                }
            });
        });

        describe('MV3 object format handling', () => {
            it('should use default CSP when MV3 object format is provided (migration is from MV2 only)', async () => {
                baseExtension.manifest.content_security_policy = {
                    extension_pages: "script-src 'self' 'sha256-someHash=='; object-src 'self';",
                };

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    // Object format means it's already MV3, but since we're migrating FROM MV2,
                    // this should be treated as invalid and replaced with default
                    expect(result.manifest.content_security_policy.extension_pages).toBe(
                        "script-src 'self'; object-src 'self';"
                    );
                }
            });
        });

        describe('Fallback behavior', () => {
            it('should use safe default CSP when validation fails completely', async () => {
                baseExtension.manifest.content_security_policy = 'completely invalid csp syntax!!!';

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy).toHaveProperty(
                        'extension_pages'
                    );
                    expect(result.manifest.content_security_policy).toHaveProperty('sandbox');
                    // The trailing semicolon may or may not be present, both are valid
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).toMatch(/^script-src 'self'; object-src 'self';?$/);
                }
            });

            it('should remove HTTPS sources as remote scripts are not allowed in MV3', async () => {
                const remoteCSP = "script-src 'self' https://cdn.example.com; object-src 'self';";
                baseExtension.manifest.content_security_policy = remoteCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'https://cdn.example.com'
                    );
                    expect(result.manifest.content_security_policy.extension_pages).toContain(
                        "script-src 'self'"
                    );
                }
            });
        });

        describe('Complex CSP scenarios', () => {
            it('should handle multiple problematic directives in one CSP', async () => {
                const complexCSP =
                    "script-src 'self' 'unsafe-eval' 'unsafe-inline' 'sha256-abc123==' data: http://bad.com 'nonce-xyz'; style-src 'self' 'unsafe-inline'; object-src 'self';";
                baseExtension.manifest.content_security_policy = complexCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain('unsafe-eval');
                    expect(csp).not.toContain('unsafe-inline');
                    // Hashes and nonces are NOT allowed in extension_pages in MV3
                    expect(csp).not.toContain("'sha256-abc123=='");
                    expect(csp).not.toContain('data:');
                    expect(csp).not.toContain('http://bad.com');
                    expect(csp).not.toContain("'nonce-xyz'");
                    expect(csp).toContain("script-src 'self'");
                    expect(csp).toContain("object-src 'self'");
                }
            });

            it('should handle real-world CSP from Chrome Web Store extensions', async () => {
                const realWorldCSP =
                    "script-src 'self' 'wasm-unsafe-eval' 'sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE='; object-src 'self';";
                baseExtension.manifest.content_security_policy = realWorldCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    // Hash must be stripped; wasm-unsafe-eval is still valid
                    expect(csp).not.toContain("'sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE='");
                    expect(csp).toContain("'wasm-unsafe-eval'");
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should remove bare JavaScript file paths that cause Chrome MV3 errors', async () => {
                const filePathCSP =
                    "script-src 'self' remote_resources/f3d11240_ga.js; object-src 'self';";
                baseExtension.manifest.content_security_policy = filePathCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain('remote_resources/f3d11240_ga.js');
                    expect(csp).toContain("script-src 'self'");
                    expect(csp).toContain("object-src 'self'");
                }
            });

            it('should remove various bare file paths from script-src', async () => {
                const multipleFilePathsCSP =
                    "script-src 'self' content.js background.js libs/jquery.min.js vendor/analytics.js; object-src 'self';";
                baseExtension.manifest.content_security_policy = multipleFilePathsCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain('content.js');
                    expect(csp).not.toContain('background.js');
                    expect(csp).not.toContain('libs/jquery.min.js');
                    expect(csp).not.toContain('vendor/analytics.js');
                    expect(csp).toContain("script-src 'self'");
                }
            });
        });

        describe('Generic pattern detection', () => {
            it('should strip all SHA hash variants (256, 384, 512) from extension_pages', async () => {
                const multiHashCSP =
                    "script-src 'self' 'sha256-randomhash1==' 'sha384-anotherhash2==' 'sha512-thirdhash3=='; object-src 'self';";
                baseExtension.manifest.content_security_policy = multiHashCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toMatch(/'sha256-randomhash1=='/);
                    expect(csp).not.toMatch(/'sha384-anotherhash2=='/);
                    expect(csp).not.toMatch(/'sha512-thirdhash3=='/);
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should strip all nonce directives from extension_pages', async () => {
                const nonceCSP =
                    "script-src 'self' 'nonce-abc123' 'nonce-xyz789' 'nonce-random456'; object-src 'self';";
                baseExtension.manifest.content_security_policy = nonceCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain("'nonce-abc123'");
                    expect(csp).not.toContain("'nonce-xyz789'");
                    expect(csp).not.toContain("'nonce-random456'");
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should handle generic JavaScript file patterns in any directory structure', async () => {
                const complexFilePathsCSP =
                    "script-src 'self' app.js src/main.js lib/vendor/analytics.js assets/js/tracking.js components/ui/modal.js; object-src 'self';";
                baseExtension.manifest.content_security_policy = complexFilePathsCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain('app.js');
                    expect(csp).not.toContain('src/main.js');
                    expect(csp).not.toContain('lib/vendor/analytics.js');
                    expect(csp).not.toContain('assets/js/tracking.js');
                    expect(csp).not.toContain('components/ui/modal.js');
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should remove any non-localhost HTTP URLs while preserving localhost', async () => {
                const mixedHTTPCSP =
                    "script-src 'self' http://example.com/script.js http://api.service.com/data http://localhost:3000 http://cdn.provider.net/lib.js; object-src 'self';";
                baseExtension.manifest.content_security_policy = mixedHTTPCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain('http://example.com');
                    expect(csp).not.toContain('http://api.service.com');
                    expect(csp).not.toContain('http://cdn.provider.net');
                    expect(csp).toContain('http://localhost:3000');
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should handle any combination of unsafe directives', async () => {
                const unsafeComboCSP =
                    "script-src 'self' 'unsafe-eval' 'unsafe-inline' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'self';";
                baseExtension.manifest.content_security_policy = unsafeComboCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain('unsafe-eval');
                    expect(csp).not.toContain('unsafe-inline');
                    expect(csp).not.toContain('data:');
                    expect(csp).not.toContain('blob:');
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should validate CSP structure regardless of content', () => {
                const malformedCSPs = [
                    'completely invalid syntax',
                    'no-directive-here just-random-text',
                    ';;;;;;;',
                    'script- invalid directive',
                    '',
                    '   \t\n   ',
                ];

                malformedCSPs.forEach(async (malformedCSP) => {
                    baseExtension.manifest.content_security_policy = malformedCSP;
                    const result = await MigrateCSP.migrate(baseExtension);

                    expect(result).not.toBeInstanceOf(MigrationError);
                    if (!(result instanceof MigrationError)) {
                        expect(result.manifest.content_security_policy).toHaveProperty(
                            'extension_pages'
                        );
                        expect(result.manifest.content_security_policy).toHaveProperty('sandbox');
                        // The trailing semicolon may or may not be present, both are valid
                        const csp = result.manifest.content_security_policy.extension_pages;
                        expect(csp).toMatch(/^script-src 'self'; object-src 'self';?$/);
                    }
                });
            });

            it('should remove remote HTTPS sources, hashes, and invalid patterns', async () => {
                const mixedValidInvalidCSP =
                    "script-src 'self' https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js 'sha256-validhash==' badfile.js 'unsafe-eval' https://apis.google.com/js/platform.js data:; object-src 'self';";
                baseExtension.manifest.content_security_policy = mixedValidInvalidCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    // Remote scripts not allowed in MV3
                    expect(csp).not.toContain('https://cdn.jsdelivr.net');
                    expect(csp).not.toContain('https://apis.google.com');
                    // Hashes not allowed in extension_pages
                    expect(csp).not.toContain("'sha256-validhash=='");
                    // Invalid patterns removed
                    expect(csp).not.toContain('badfile.js');
                    expect(csp).not.toContain('unsafe-eval');
                    expect(csp).not.toContain('data:');
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should handle edge cases in file path detection', async () => {
                const edgeCaseCSP =
                    "script-src 'self' file.js path/to/file.js deep/nested/path/to/script.js single.js; object-src 'self';";
                baseExtension.manifest.content_security_policy = edgeCaseCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain('file.js');
                    expect(csp).not.toContain('path/to/file.js');
                    expect(csp).not.toContain('deep/nested/path/to/script.js');
                    expect(csp).not.toContain('single.js');
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should be extensible for future MV3 violations', async () => {
                const futureProblemCSP =
                    "script-src 'self' 'sha1-oldhash==' 'md5-evenworsehash=='; object-src 'self';";
                baseExtension.manifest.content_security_policy = futureProblemCSP;

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).toContain("script-src 'self'");
                    expect(csp).toContain("object-src 'self'");
                }
            });
        });

        describe('Hash and nonce stripping (MV3 extension_pages restriction)', () => {
            it('should strip sha256 hash from MV2 CSP so the migrated extension_pages is Chrome-installable', async () => {
                // Real-world MV2 CSP with an inline-script hash
                baseExtension.manifest.content_security_policy =
                    "script-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; object-src 'self';";

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    // Hash must be absent — Chrome rejects extension_pages CSPs with hashes
                    expect(csp).not.toContain("'sha256-");
                    // 'self' must still be present so the extension can load its own scripts
                    expect(csp).toContain("script-src 'self'");
                    expect(csp).toContain("object-src 'self'");
                }
            });

            it('should strip nonce from MV2 CSP so the migrated extension_pages is Chrome-installable', async () => {
                baseExtension.manifest.content_security_policy =
                    "script-src 'self' 'nonce-EDNnf03nceIOfn39fn3e9h3sdfa'; object-src 'self';";

                const result = await MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain("'nonce-");
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('validator should flag MV2 CSP with sha256 hash as non-compliant', () => {
                const mv2Csp =
                    "script-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; object-src 'self';";

                expect(cspValidator.isCSPStringCompliant(mv2Csp)).toBe(false);
            });

            it('validator should flag MV2 CSP with nonce as non-compliant', () => {
                const mv2Csp =
                    "script-src 'self' 'nonce-EDNnf03nceIOfn39fn3e9h3sdfa'; object-src 'self';";

                expect(cspValidator.isCSPStringCompliant(mv2Csp)).toBe(false);
            });

            it('validator should accept a clean MV3 CSP without hashes or nonces', () => {
                const mv3Csp = "script-src 'self'; object-src 'self';";

                expect(cspValidator.isCSPStringCompliant(mv3Csp)).toBe(true);
            });

            it('validator should accept wasm-unsafe-eval alongside self', () => {
                const wasmCsp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";

                expect(cspValidator.isCSPStringCompliant(wasmCsp)).toBe(true);
            });
        });

        describe('Error handling', () => {
            it('should return MigrationError when extension is null', async () => {
                const result = await MigrateCSP.migrate(null as any);

                expect(result).toBeInstanceOf(MigrationError);
            });

            it('should return MigrationError when manifest is corrupted', async () => {
                const corruptedExtension = {
                    ...baseExtension,
                    manifest: null as any,
                };

                const result = await MigrateCSP.migrate(corruptedExtension);

                expect(result).toBeInstanceOf(MigrationError);
            });
        });
    });
});
