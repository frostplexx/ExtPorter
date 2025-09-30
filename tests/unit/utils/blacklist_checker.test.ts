import { BlacklistChecker } from '../../../migrator/utils/blacklist_checker';

describe('BlacklistChecker', () => {
    let blacklistChecker: BlacklistChecker;

    beforeEach(() => {
        blacklistChecker = BlacklistChecker.getInstance();
        blacklistChecker.clearRuntimePatterns();
    });

    describe('filename-based blacklisting', () => {
        it('should blacklist minified files', () => {
            const result = blacklistChecker.isFileBlacklisted('app.min.js');
            expect(result.isBlacklisted).toBe(true);
            expect(result.reason).toContain('Minified JavaScript files');
        });

        it('should blacklist webpack bundle files', () => {
            const testCases = [
                'main.bundle.js',
                'app-bundle.js',
                'webpack.runtime.js',
                'chunk.12345.js',
                'vendor.chunk.js',
                'app.a1b2c3d4.js',
                'main.f7e8d9c2.js'
            ];

            testCases.forEach(filename => {
                const result = blacklistChecker.isFileBlacklisted(filename);
                expect(result.isBlacklisted).toBe(true);
                expect(result.reason).toMatch(/bundle|webpack|chunk|hashed/i);
            });
        });

        it('should blacklist library files', () => {
            const libraryFiles = [
                'jquery.min.js',
                'lodash.js',
                'react.development.js',
                'vue.runtime.js'
            ];

            libraryFiles.forEach(filename => {
                const result = blacklistChecker.isFileBlacklisted(filename);
                expect(result.isBlacklisted).toBe(true);
            });
        });

        it('should not blacklist regular JavaScript files', () => {
            const regularFiles = [
                'background.js',
                'content.js',
                'popup.js',
                'options.js',
                'utils.js'
            ];

            regularFiles.forEach(filename => {
                const result = blacklistChecker.isFileBlacklisted(filename);
                expect(result.isBlacklisted).toBe(false);
            });
        });
    });

    describe('content-based webpack detection', () => {
        it('should detect webpack bundles by __webpack_require__ signature', () => {
            const webpackContent = `
                function(e, t, n) {
                    "use strict";
                    var r = __webpack_require__(123);
                    __webpack_require__.d(t, "default", function() { return r; });
                }
            `;

            const result = blacklistChecker.isFileBlacklisted('unknown.js', webpackContent);
            expect(result.isBlacklisted).toBe(true);
            expect(result.reason).toContain('webpack bundle signatures');
        });

        it('should detect webpack bundles by webpackChunk signature', () => {
            const webpackContent = `
                (self["webpackChunk"] = self["webpackChunk"] || []).push([[123], {
                    456: function(e, t, n) {
                        // module content
                    }
                }]);
            `;

            const result = blacklistChecker.isFileBlacklisted('unknown.js', webpackContent);
            expect(result.isBlacklisted).toBe(true);
            expect(result.reason).toContain('webpack bundle signatures');
        });

        it('should detect webpack bundles by module pattern signatures', () => {
            const webpackContent = `
                __webpack_require__.d(exports, "default", function() { return Component; });
                (123, function(e, t, n) {
                    "use strict";
                    var r = n(456);
                });
            `;

            const result = blacklistChecker.isFileBlacklisted('unknown.js', webpackContent);
            expect(result.isBlacklisted).toBe(true);
            expect(result.reason).toContain('webpack bundle signatures');
        });

        it('should detect minified webpack patterns', () => {
            const minifiedWebpackContent = `
                )&&(this||self)["webpackChunk"].push([[123],{456:function(e,t,n){"use strict";
                var r=n(789);Object.defineProperty(t,"__esModule",{value:!0})
            `;

            const result = blacklistChecker.isFileBlacklisted('unknown.js', minifiedWebpackContent);
            expect(result.isBlacklisted).toBe(true);
            expect(result.reason).toContain('webpack bundle signatures');
        });

        it('should not detect webpack in regular code with chrome APIs', () => {
            const regularContent = `
                chrome.browserAction.onClicked.addListener(function(tab) {
                    chrome.tabs.executeScript(tab.id, {
                        file: 'content.js'
                    });
                });
            `;

            const result = blacklistChecker.isFileBlacklisted('background.js', regularContent);
            expect(result.isBlacklisted).toBe(false);
        });

        it('should require multiple signatures to avoid false positives', () => {
            // Single signature should not trigger detection
            const singleSignatureContent = `
                var __webpack_require__ = function() { /* some custom implementation */ };
                // This is just a variable name, not a real webpack bundle
            `;

            const result = blacklistChecker.isFileBlacklisted('custom.js', singleSignatureContent);
            expect(result.isBlacklisted).toBe(false);
        });

        it('should detect webpack with multiple signatures', () => {
            const multipleSignaturesContent = `
                var __webpack_require__ = function(moduleId) {
                    return __webpack_module_cache__[moduleId];
                };
                __webpack_require__.d = function(exports, definition) {
                    Object.defineProperty(exports, "__esModule", { value: true });
                };
            `;

            const result = blacklistChecker.isFileBlacklisted('bundle.js', multipleSignaturesContent);
            expect(result.isBlacklisted).toBe(true);
            expect(result.reason).toContain('webpack bundle signatures');
        });
    });

    describe('performance optimization', () => {
        it('should only check first 10KB of content for webpack signatures', () => {
            // Create content where webpack signatures appear after 10KB
            const padding = 'a'.repeat(10500); // More than 10KB
            const webpackContent = padding + `
                __webpack_require__("module");
                webpackChunk.push([123]);
            `;

            // Should not detect webpack since signatures are beyond 10KB limit
            const result = blacklistChecker.isFileBlacklisted('large.js', webpackContent);
            expect(result.isBlacklisted).toBe(false);
        });

        it('should detect webpack signatures within first 10KB', () => {
            const webpackContent = `
                __webpack_require__("module");
                webpackChunk.push([123]);
            ` + 'a'.repeat(10000); // Add padding after signatures

            const result = blacklistChecker.isFileBlacklisted('large.js', webpackContent);
            expect(result.isBlacklisted).toBe(true);
        });
    });

    describe('runtime pattern management', () => {
        it('should add runtime patterns', () => {
            blacklistChecker.addRuntimePattern('test.*\\.js$', 'Test pattern', false);

            const result = blacklistChecker.isFileBlacklisted('test-file.js');
            expect(result.isBlacklisted).toBe(true);
            expect(result.reason).toBe('Test pattern');
        });

        it('should clear runtime patterns', () => {
            blacklistChecker.addRuntimePattern('test.*\\.js$', 'Test pattern', false);

            // Verify pattern was added
            let result = blacklistChecker.isFileBlacklisted('test-file.js');
            expect(result.isBlacklisted).toBe(true);

            // Clear and verify pattern was removed
            blacklistChecker.clearRuntimePatterns();
            result = blacklistChecker.isFileBlacklisted('test-file.js');
            expect(result.isBlacklisted).toBe(false);
        });
    });

    describe('statistics and configuration', () => {
        it('should return blacklist statistics', () => {
            const stats = blacklistChecker.getBlacklistStats();
            expect(stats.totalPatterns).toBeGreaterThan(0);
            expect(stats.settings).toBeDefined();
            expect(typeof stats.settings.log_blacklisted_files).toBe('boolean');
            expect(typeof stats.settings.count_blacklisted_in_stats).toBe('boolean');
        });
    });

    describe('real-world webpack examples', () => {
        it('should detect Create React App webpack bundle', () => {
            const craWebpackContent = `
                /******/ (function(modules) {
                /******/    var installedModules = {};
                /******/    function __webpack_require__(moduleId) {
                /******/        if(installedModules[moduleId]) {
                /******/            return installedModules[moduleId].exports;
                /******/        }
                /******/        var module = installedModules[moduleId] = {
                /******/            i: moduleId,
                /******/            l: false,
                /******/            exports: {}
                /******/        };
                /******/        modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
            `;

            const result = blacklistChecker.isFileBlacklisted('static/js/main.chunk.js', craWebpackContent);
            expect(result.isBlacklisted).toBe(true);
        });

        it('should detect modern webpack 5 bundle', () => {
            const webpack5Content = `
                /******/ (() => {
                /******/    "use strict";
                /******/    var __webpack_modules__ = ({
                /******/        123: (module, __webpack_exports__, __webpack_require__) => {
                /******/            __webpack_require__.d(__webpack_exports__, {
                /******/                "default": () => Component
                /******/            });
                /******/        }
                /******/    });
            `;

            const result = blacklistChecker.isFileBlacklisted('app.bundle.js', webpack5Content);
            expect(result.isBlacklisted).toBe(true);
        });

        it('should detect Chrome extension webpack bundle with APIs', () => {
            const extensionWebpackContent = `
                __webpack_require__.d(__webpack_exports__, "chrome", function() { return chrome; });
                (123, function(e, t, n) {
                    const chrome = window.chrome;
                    chrome.browserAction.onClicked.addListener(function(tab) {
                        // This chrome API call is buried in webpack bundle
                    });
                });
            `;

            const result = blacklistChecker.isFileBlacklisted('background-compiled.js', extensionWebpackContent);
            expect(result.isBlacklisted).toBe(true);
            expect(result.reason).toContain('webpack bundle signatures');
        });
    });
});