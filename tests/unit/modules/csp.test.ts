import { describe, it, expect, beforeEach } from '@jest/globals';
import { MigrateCSP } from '../../../migrator/modules/csp';
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
        it('should add default CSP when no CSP is present', () => {
            const result = MigrateCSP.migrate(baseExtension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                expect(result.manifest.content_security_policy).toEqual({
                    extension_pages: "script-src 'self'; object-src 'self';",
                });
            }
        });

        describe('MV2 string format to MV3 object format', () => {
            it('should convert MV2 CSP string to MV3 object format', () => {
                baseExtension.manifest.content_security_policy =
                    "script-src 'self'; object-src 'self';";

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy).toEqual({
                        extension_pages: "script-src 'self'; object-src 'self';",
                    });
                }
            });

            it('should validate and sanitize insecure MV2 CSP', () => {
                baseExtension.manifest.content_security_policy =
                    "script-src 'self' 'unsafe-eval'; object-src 'self';";

                const result = MigrateCSP.migrate(baseExtension);

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

        describe('Hash directive sanitization', () => {
            it('should remove the specific insecure SHA256 hash that causes Chrome errors', () => {
                const insecureCSP =
                    "script-src 'self' 'sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE='; object-src 'self';";
                baseExtension.manifest.content_security_policy = insecureCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE='
                    );
                    expect(result.manifest.content_security_policy.extension_pages).toContain(
                        "script-src 'self'"
                    );
                }
            });

            it('should remove all SHA-based hashes from CSP', () => {
                const hashCSP =
                    "script-src 'self' 'sha256-abc123==' 'sha384-def456==' 'sha512-ghi789=='; object-src 'self';";
                baseExtension.manifest.content_security_policy = hashCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toMatch(/'sha[0-9]+-[A-Za-z0-9+/]+=*'/);
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should remove nonce directives', () => {
                const nonceCSP = "script-src 'self' 'nonce-random123'; object-src 'self';";
                baseExtension.manifest.content_security_policy = nonceCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toMatch(
                        /'nonce-[^']+'/
                    );
                }
            });
        });

        describe('Unsafe directive removal', () => {
            it('should remove unsafe-inline from CSP', () => {
                const unsafeCSP = "script-src 'self' 'unsafe-inline'; object-src 'self';";
                baseExtension.manifest.content_security_policy = unsafeCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'unsafe-inline'
                    );
                }
            });

            it('should remove unsafe-eval from CSP', () => {
                const unsafeCSP = "script-src 'self' 'unsafe-eval'; object-src 'self';";
                baseExtension.manifest.content_security_policy = unsafeCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'unsafe-eval'
                    );
                }
            });

            it('should remove data: URLs from script-src', () => {
                const dataCSP = "script-src 'self' data:; object-src 'self';";
                baseExtension.manifest.content_security_policy = dataCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'data:'
                    );
                }
            });

            it('should remove blob: URLs from script-src', () => {
                const blobCSP = "script-src 'self' blob:; object-src 'self';";
                baseExtension.manifest.content_security_policy = blobCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'blob:'
                    );
                }
            });

            it('should remove non-localhost HTTP URLs', () => {
                const httpCSP = "script-src 'self' http://example.com; object-src 'self';";
                baseExtension.manifest.content_security_policy = httpCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'http://example.com'
                    );
                }
            });

            it('should preserve localhost HTTP URLs', () => {
                const localhostCSP = "script-src 'self' http://localhost:3000; object-src 'self';";
                baseExtension.manifest.content_security_policy = localhostCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).toContain(
                        'http://localhost:3000'
                    );
                }
            });
        });

        describe('MV3 object format validation', () => {
            it('should validate existing MV3 format extension_pages CSP', () => {
                baseExtension.manifest.content_security_policy = {
                    extension_pages: "script-src 'self' 'sha256-badHash=='; object-src 'self';",
                };

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).not.toContain(
                        'sha256-badHash=='
                    );
                }
            });

            it('should add missing extension_pages to existing MV3 format', () => {
                baseExtension.manifest.content_security_policy = {
                    sandbox: 'allow-scripts',
                };

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).toBe(
                        "script-src 'self'; object-src 'self';"
                    );
                    expect(result.manifest.content_security_policy.sandbox).toBe('allow-scripts');
                }
            });
        });

        describe('Fallback behavior', () => {
            it('should use safe default CSP when validation fails completely', () => {
                baseExtension.manifest.content_security_policy = 'completely invalid csp syntax!!!';

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy).toEqual({
                        extension_pages: "script-src 'self'; object-src 'self';",
                    });
                }
            });

            it('should preserve valid HTTPS sources', () => {
                const validCSP = "script-src 'self' https://cdn.example.com; object-src 'self';";
                baseExtension.manifest.content_security_policy = validCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    expect(result.manifest.content_security_policy.extension_pages).toContain(
                        'https://cdn.example.com'
                    );
                }
            });
        });

        describe('Complex CSP scenarios', () => {
            it('should handle multiple problematic directives in one CSP', () => {
                const complexCSP =
                    "script-src 'self' 'unsafe-eval' 'unsafe-inline' 'sha256-abc123==' data: http://bad.com 'nonce-xyz'; style-src 'self' 'unsafe-inline'; object-src 'self';";
                baseExtension.manifest.content_security_policy = complexCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain('unsafe-eval');
                    expect(csp).not.toContain('unsafe-inline');
                    expect(csp).not.toContain('sha256-abc123==');
                    expect(csp).not.toContain('data:');
                    expect(csp).not.toContain('http://bad.com');
                    expect(csp).not.toContain('nonce-xyz');
                    expect(csp).toContain("script-src 'self'");
                    expect(csp).toContain("object-src 'self'");
                }
            });

            it('should handle real-world problematic CSP from Chrome Web Store extensions', () => {
                const realWorldCSP =
                    "script-src 'self' 'wasm-unsafe-eval' 'sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE='; object-src 'self';";
                baseExtension.manifest.content_security_policy = realWorldCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain(
                        'sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE='
                    );
                    expect(csp).toContain('wasm-unsafe-eval');
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should remove bare JavaScript file paths that cause Chrome MV3 errors', () => {
                const filePathCSP =
                    "script-src 'self' remote_resources/f3d11240_ga.js; object-src 'self';";
                baseExtension.manifest.content_security_policy = filePathCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toContain('remote_resources/f3d11240_ga.js');
                    expect(csp).toContain("script-src 'self'");
                    expect(csp).toContain("object-src 'self'");
                }
            });

            it('should remove various bare file paths from script-src', () => {
                const multipleFilePathsCSP =
                    "script-src 'self' content.js background.js libs/jquery.min.js vendor/analytics.js; object-src 'self';";
                baseExtension.manifest.content_security_policy = multipleFilePathsCSP;

                const result = MigrateCSP.migrate(baseExtension);

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

        describe('Generic pattern detection and removal', () => {
            it('should remove any SHA hash variant (256, 384, 512)', () => {
                const multiHashCSP =
                    "script-src 'self' 'sha256-randomhash1==' 'sha384-anotherhash2==' 'sha512-thirdhash3=='; object-src 'self';";
                baseExtension.manifest.content_security_policy = multiHashCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toMatch(/'sha256-[^']+'/);
                    expect(csp).not.toMatch(/'sha384-[^']+'/);
                    expect(csp).not.toMatch(/'sha512-[^']+'/);
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should remove any nonce directive regardless of value', () => {
                const nonceCSP =
                    "script-src 'self' 'nonce-abc123' 'nonce-xyz789' 'nonce-random456'; object-src 'self';";
                baseExtension.manifest.content_security_policy = nonceCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).not.toMatch(/'nonce-[^']+'/);
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should handle generic JavaScript file patterns in any directory structure', () => {
                const complexFilePathsCSP =
                    "script-src 'self' app.js src/main.js lib/vendor/analytics.js assets/js/tracking.js components/ui/modal.js; object-src 'self';";
                baseExtension.manifest.content_security_policy = complexFilePathsCSP;

                const result = MigrateCSP.migrate(baseExtension);

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

            it('should remove any non-localhost HTTP URLs while preserving localhost', () => {
                const mixedHTTPCSP =
                    "script-src 'self' http://example.com/script.js http://api.service.com/data http://localhost:3000 http://cdn.provider.net/lib.js; object-src 'self';";
                baseExtension.manifest.content_security_policy = mixedHTTPCSP;

                const result = MigrateCSP.migrate(baseExtension);

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

            it('should handle any combination of unsafe directives', () => {
                const unsafeComboCSP =
                    "script-src 'self' 'unsafe-eval' 'unsafe-inline' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'self';";
                baseExtension.manifest.content_security_policy = unsafeComboCSP;

                const result = MigrateCSP.migrate(baseExtension);

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

                malformedCSPs.forEach((malformedCSP) => {
                    baseExtension.manifest.content_security_policy = malformedCSP;
                    const result = MigrateCSP.migrate(baseExtension);

                    expect(result).not.toBeInstanceOf(MigrationError);
                    if (!(result instanceof MigrationError)) {
                        expect(result.manifest.content_security_policy).toEqual({
                            extension_pages: "script-src 'self'; object-src 'self';",
                        });
                    }
                });
            });

            it('should preserve valid HTTPS sources while removing invalid patterns', () => {
                const mixedValidInvalidCSP =
                    "script-src 'self' https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js 'sha256-invalid==' badfile.js 'unsafe-eval' https://apis.google.com/js/platform.js data:; object-src 'self';";
                baseExtension.manifest.content_security_policy = mixedValidInvalidCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).toContain(
                        'https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js'
                    );
                    expect(csp).toContain('https://apis.google.com/js/platform.js');
                    expect(csp).not.toContain('sha256-invalid==');
                    expect(csp).not.toContain('badfile.js');
                    expect(csp).not.toContain('unsafe-eval');
                    expect(csp).not.toContain('data:');
                    expect(csp).toContain("script-src 'self'");
                }
            });

            it('should handle edge cases in file path detection', () => {
                const edgeCaseCSP =
                    "script-src 'self' file.js path/to/file.js deep/nested/path/to/script.js single.js; object-src 'self';";
                baseExtension.manifest.content_security_policy = edgeCaseCSP;

                const result = MigrateCSP.migrate(baseExtension);

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

            it('should be extensible for future MV3 violations', () => {
                const futureProblemCSP =
                    "script-src 'self' 'sha1-oldhash==' 'md5-evenworsehash=='; object-src 'self';";
                baseExtension.manifest.content_security_policy = futureProblemCSP;

                const result = MigrateCSP.migrate(baseExtension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    const csp = result.manifest.content_security_policy.extension_pages;
                    expect(csp).toContain("script-src 'self'");
                    expect(csp).toContain("object-src 'self'");
                }
            });
        });

        describe('Error handling', () => {
            it('should return MigrationError when extension is null', () => {
                const result = MigrateCSP.migrate(null as any);

                expect(result).toBeInstanceOf(MigrationError);
            });

            it('should return MigrationError when manifest is corrupted', () => {
                const corruptedExtension = {
                    ...baseExtension,
                    manifest: null as any,
                };

                const result = MigrateCSP.migrate(corruptedExtension);

                expect(result).toBeInstanceOf(MigrationError);
            });
        });
    });
});
