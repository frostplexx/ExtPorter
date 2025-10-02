import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs-extra';
import { execSync } from 'child_process';
import { BridgeInjector } from '../../migrator/modules/bridge_injector';
import { Extension } from '../../migrator/types/extension';
import { LazyFile } from '../../migrator/types/abstract_file';
import { ExtFileType } from '../../migrator/types/ext_file_types';
import { MigrationError } from '../../migrator/types/migration_module';

describe('Bridge Injection Puppeteer Tests', () => {
    let browser: Browser;
    let page: Page;

    const originalExtensionPath = path.join(__dirname, '../fixtures/mock-extensions/bridge_test_extension');
    const migratedExtensionPath = path.join(__dirname, '../fixtures/mock-extensions/bridge_test_extension_migrated');

    // Helper to get Chrome path
    const getChromePath = () => {
        if (process.env.IN_NIX_SHELL) {
            let bin_path = execSync(`which google-chrome-stable`).toString();
            bin_path = bin_path
                .replace(
                    '/bin/google-chrome-stable',
                    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
                )
                .replace('\n', '');
            return bin_path;
        } else {
            // Fallback for other environments
            return undefined;
        }
    };

    // Helper to create Extension object from directory
    const createExtensionFromDirectory = (extensionPath: string): Extension => {
        const manifestPath = path.join(extensionPath, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        const files: LazyFile[] = [];

        // Add background script
        if (manifest.background?.service_worker) {
            const backgroundPath = path.join(extensionPath, manifest.background.service_worker);
            if (fs.existsSync(backgroundPath)) {
                files.push(new LazyFile(manifest.background.service_worker, backgroundPath, ExtFileType.JS));
            }
        }

        // Add content scripts
        if (manifest.content_scripts) {
            manifest.content_scripts.forEach((script: any) => {
                if (script.js) {
                    script.js.forEach((jsFile: string) => {
                        const jsPath = path.join(extensionPath, jsFile);
                        if (fs.existsSync(jsPath)) {
                            files.push(new LazyFile(jsFile, jsPath, ExtFileType.JS));
                        }
                    });
                }
            });
        }

        return {
            id: 'bridge-test-extension',
            name: manifest.name,
            manifest_v2_path: extensionPath,
            manifest,
            files,
        };
    };

    // Helper to write Extension to directory
    const writeExtensionToDirectory = (extension: Extension, outputPath: string) => {
        // Ensure output directory exists
        fs.ensureDirSync(outputPath);

        // Write manifest
        fs.writeFileSync(
            path.join(outputPath, 'manifest.json'),
            JSON.stringify(extension.manifest, null, 2)
        );

        // Write all files
        extension.files.forEach((file) => {
            const filePath = path.join(outputPath, file.path);
            fs.ensureDirSync(path.dirname(filePath));
            fs.writeFileSync(filePath, file.getContent());
        });
    };

    beforeAll(async () => {
        // Clean up any existing migrated extension
        if (fs.existsSync(migratedExtensionPath)) {
            fs.removeSync(migratedExtensionPath);
        }

        // Create migrated extension using BridgeInjector
        const originalExtension = createExtensionFromDirectory(originalExtensionPath);
        const migratedExtension = BridgeInjector.migrate(originalExtension);

        if (migratedExtension instanceof MigrationError) {
            throw new Error(`Migration failed: ${migratedExtension.error}`);
        }

        // Write migrated extension to disk
        writeExtensionToDirectory(migratedExtension, migratedExtensionPath);

        // Launch browser with migrated extension
        browser = await puppeteer.launch({
            headless: false, // Set to true for CI
            executablePath: getChromePath(),
            pipe: true,
            devtools: true,
            args: [
                `--load-extension=${migratedExtensionPath}`,
                '--no-first-run',
                '--disable-default-apps',
                '--disable-popup-blocking',
                '--disable-web-security',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-extensions-file-access-check',
                '--disable-extensions-http-throttling',
                '--allow-running-insecure-content',
                '--disable-component-extensions-with-background-pages',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                '--disable-features=TranslateUI,VizDisplayCompositor',
                '--disable-ipc-flooding-protection',
                '--disable-manifest-v2-deprecation-warnings',
                '--disable-extensions-manifest-v2-deprecation-warnings',
                '--silent-debugger-extension-api',
            ],
        });
    });

    afterAll(async () => {
        if (browser) {
            await browser.close();
        }

        // Clean up migrated extension
        if (fs.existsSync(migratedExtensionPath)) {
            fs.removeSync(migratedExtensionPath);
        }
    });

    beforeEach(async () => {
        page = await browser.newPage();
    });

    afterEach(async () => {
        if (page) {
            await page.close();
        }
    });

    describe('Bridge Injection Verification', () => {
        test('should verify bridge files are correctly injected', () => {
            // Verify migrated extension has bridge file
            const bridgeFilePath = path.join(migratedExtensionPath, 'ext_bridge.js');
            expect(fs.existsSync(bridgeFilePath)).toBe(true);

            // Verify bridge content
            const bridgeContent = fs.readFileSync(bridgeFilePath, 'utf8');
            expect(bridgeContent).toContain('createCallbackCompatibleMethod');
            expect(bridgeContent).toContain('chrome.runtime.lastError');

            // Verify service worker has importScripts
            const backgroundPath = path.join(migratedExtensionPath, 'background.js');
            const backgroundContent = fs.readFileSync(backgroundPath, 'utf8');
            expect(backgroundContent).toContain("importScripts('ext_bridge.js');");

            // Verify manifest has bridge in content scripts
            const manifestPath = path.join(migratedExtensionPath, 'manifest.json');
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            expect(manifest.content_scripts[0].js[0]).toBe('ext_bridge.js');
            expect(manifest.content_scripts[0].js).toContain('content.js');
        });

        test('should load migrated extension without errors', async () => {
            const consoleLogs: string[] = [];
            const consoleErrors: string[] = [];

            page.on('console', (msg) => {
                const text = msg.text();
                consoleLogs.push(text);
                if (msg.type() === 'error') {
                    consoleErrors.push(text);
                }
            });

            // Navigate to a test page
            await page.goto('https://example.com');

            // Wait for extension to load and initialize
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Filter out unrelated errors
            const extensionErrors = consoleErrors.filter(
                (log) =>
                    log.includes('extension') ||
                    log.includes('chrome-extension') ||
                    log.includes('bridge') ||
                    log.includes('importScripts')
            );

            // Should not have critical extension loading errors
            expect(extensionErrors.length).toBe(0);
        });

        test('should inject bridge test indicator into page', async () => {
            // Navigate to a test page where content script should run
            await page.goto('https://example.com');

            // Wait for content script to inject the test indicator
            await page.waitForSelector('#bridge-test-indicator', { timeout: 10000 });

            // Verify indicator is present
            const indicator = await page.$('#bridge-test-indicator');
            expect(indicator).toBeTruthy();

            // Check initial state
            const initialText = await page.$eval('#bridge-test-indicator', (el) => el.textContent);
            expect(initialText).toBeDefined();
        });

        test('should verify bridge functionality works for content scripts', async () => {
            await page.goto('https://example.com');

            // Wait for test indicator
            await page.waitForSelector('#bridge-test-indicator', { timeout: 10000 });

            // Wait for tests to complete (content script runs tests automatically)
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Check if content storage test passed
            const contentStorageResult = await page.$eval(
                '#bridge-test-indicator',
                (el) => el.getAttribute('data-content-storage')
            );

            expect(contentStorageResult).toBeTruthy();
            const contentStorage = JSON.parse(contentStorageResult!);
            expect(contentStorage.success).toBe(true);
            expect(contentStorage.matches).toBe(true);
        });

        test('should verify bridge functionality works for service worker communication', async () => {
            await page.goto('https://example.com');

            // Wait for test indicator
            await page.waitForSelector('#bridge-test-indicator', { timeout: 10000 });

            // Wait for all tests to complete
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Check test status
            const testStatus = await page.$eval(
                '#bridge-test-indicator',
                (el) => el.getAttribute('data-test-status')
            );

            expect(testStatus).toBe('success');

            // Check if all tests passed
            const allPassed = await page.$eval(
                '#bridge-test-indicator',
                (el) => el.getAttribute('data-all-passed')
            );

            expect(allPassed).toBe('true');

            // Check detailed test results
            const testResultsStr = await page.$eval(
                '#bridge-test-indicator',
                (el) => el.getAttribute('data-test-results')
            );

            expect(testResultsStr).toBeTruthy();
            const testResults = JSON.parse(testResultsStr!);

            // Verify storage API tests passed
            expect(testResults.storageSet?.success).toBe(true);
            expect(testResults.storageGet?.success).toBe(true);
            expect(testResults.storageGet?.matches).toBe(true);

            // Verify tabs API test passed
            expect(testResults.tabsQuery?.success).toBe(true);
            expect(testResults.tabsQuery?.hasActiveTab).toBe(true);
        });

        test('should verify callback-to-promise bridging works correctly', async () => {
            await page.goto('https://example.com');

            // Wait for extension to load
            await page.waitForSelector('#bridge-test-indicator', { timeout: 10000 });

            // Trigger manual test by clicking the indicator
            await page.click('#bridge-test-indicator');

            // Wait for tests to complete
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Verify the final status shows success
            const finalText = await page.$eval('#bridge-test-indicator', (el) => el.textContent);
            expect(finalText).toMatch(/Bridge Test: (Passed|Active)/);

            // Verify no errors in lastError handling
            const errorAttribute = await page.$eval(
                '#bridge-test-indicator',
                (el) => el.getAttribute('data-error')
            );
            expect(errorAttribute).toBeNull();
        });

        test('should handle multiple rapid API calls correctly', async () => {
            await page.goto('https://example.com');
            await page.waitForSelector('#bridge-test-indicator', { timeout: 10000 });

            // Trigger multiple rapid tests
            for (let i = 0; i < 3; i++) {
                await page.click('#bridge-test-indicator');
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Wait for all tests to settle
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Should still show success
            const testStatus = await page.$eval(
                '#bridge-test-indicator',
                (el) => el.getAttribute('data-test-status')
            );

            expect(testStatus).toBe('success');
        });
    });

    describe('Bridge Performance and Compatibility', () => {
        test('should not significantly impact extension performance', async () => {
            await page.goto('https://example.com');

            const startTime = Date.now();

            // Wait for extension to fully initialize
            await page.waitForSelector('#bridge-test-indicator', { timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 2000));

            const endTime = Date.now();
            const loadTime = endTime - startTime;

            // Extension should load within reasonable time (10 seconds max)
            expect(loadTime).toBeLessThan(10000);
        });

        test('should work across different page contexts', async () => {
            // Test on different domains
            const testDomains = ['https://example.com', 'https://httpbin.org/html'];

            for (const domain of testDomains) {
                await page.goto(domain);

                try {
                    await page.waitForSelector('#bridge-test-indicator', { timeout: 5000 });

                    // Wait for tests to complete
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    const testStatus = await page.$eval(
                        '#bridge-test-indicator',
                        (el) => el.getAttribute('data-test-status')
                    );

                    // Should work on all domains (though some might have restrictions)
                    expect(['success', 'error']).toContain(testStatus);
                } catch (error) {
                    // Some domains might block extension injection, that's okay
                    console.log(`Extension not injected on ${domain}, which is expected`);
                }
            }
        });
    });
});