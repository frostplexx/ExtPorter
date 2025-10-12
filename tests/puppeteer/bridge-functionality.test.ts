import puppeteer, { Browser, Page } from 'puppeteer';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('Bridge Functionality Test', () => {
    let browser: Browser;
    let page: Page;

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
            return undefined;
        }
    };

    beforeAll(async () => {
        browser = await puppeteer.launch({
            headless: false,
            executablePath: getChromePath(),
            pipe: true,
            args: [
                '--no-first-run',
                '--disable-default-apps',
                '--disable-web-security',
                '--no-sandbox',
                '--disable-setuid-sandbox',
            ],
        });
    });

    afterAll(async () => {
        if (browser) {
            await browser.close();
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

    test('should verify bridge template functionality', async () => {
        // Read the actual bridge template
        const bridgeTemplatePath = path.join(__dirname, '../../migrator/templates/ext_bridge.js');
        const bridgeContent = fs.readFileSync(bridgeTemplatePath, 'utf8');

        // Navigate to a blank page first
        await page.goto('data:text/html,<html><body><h1>Bridge Test</h1></body></html>');

        // Inject everything in a single evaluate call to ensure chrome API is available when bridge runs
        const testResult = await page.evaluate((bridgeCode) => {
            // Mock Chrome storage API with callback support
            const storageData: any = {};

            const mockChrome = {
                storage: {
                    local: {
                        set: function(data: any) {
                            // MV3 APIs return promises
                            return Promise.resolve().then(() => {
                                Object.assign(storageData, data);
                            });
                        },
                        get: function(keys: string[]) {
                            // MV3 APIs return promises
                            return Promise.resolve().then(() => {
                                const result: any = {};
                                keys.forEach(key => {
                                    if (storageData[key] !== undefined) {
                                        result[key] = storageData[key];
                                    }
                                });
                                return result;
                            });
                        }
                    }
                },
                runtime: {
                    lastError: undefined
                }
            };

            (window as any).chrome = mockChrome;

            // Inject the bridge by executing it
            eval(bridgeCode);

            // Test that the bridge correctly handles callback APIs
            return new Promise((resolve) => {
                // Test callback-style API
                (window as any).chrome.storage.local.set({ testKey: 'testValue' }, function() {
                    if ((window as any).chrome.runtime.lastError) {
                        resolve({ success: false, error: (window as any).chrome.runtime.lastError.message });
                    } else {
                        // Test get with callback
                        (window as any).chrome.storage.local.get(['testKey'], function(result: any) {
                            if ((window as any).chrome.runtime.lastError) {
                                resolve({ success: false, error: (window as any).chrome.runtime.lastError.message });
                            } else {
                                // Check if result is defined
                                if (!result) {
                                    resolve({ success: false, error: 'Result is undefined' });
                                } else if (result.testKey === undefined) {
                                    resolve({ success: false, error: `Cannot read properties of undefined (reading 'testKey')` });
                                } else {
                                    resolve({
                                        success: true,
                                        value: result.testKey,
                                        matches: result.testKey === 'testValue'
                                    });
                                }
                            }
                        });
                    }
                });
            });
        }, bridgeContent);

        expect(testResult).toEqual({
            success: true,
            value: 'testValue',
            matches: true
        });
    });

    test('should verify bridge prevents double loading', async () => {
        await page.goto('data:text/html,<html><body><h1>Bridge Test</h1></body></html>');

        const bridgeTemplatePath = path.join(__dirname, '../../migrator/templates/ext_bridge.js');
        const bridgeContent = fs.readFileSync(bridgeTemplatePath, 'utf8');

        // Inject bridge twice
        await page.evaluate(bridgeContent);
        await page.evaluate(bridgeContent);

        // Check that the bridge loaded flag is set
        const bridgeLoaded = await page.evaluate(() => {
            return (window as any)._chromeExtBridgeLoaded;
        });

        expect(bridgeLoaded).toBe(true);
    });

    test('should verify bridge file contains required functionality', () => {
        const bridgeTemplatePath = path.join(__dirname, '../../migrator/templates/ext_bridge.js');
        const bridgeContent = fs.readFileSync(bridgeTemplatePath, 'utf8');

        // Verify essential bridge components
        expect(bridgeContent).toContain('_chromeExtBridgeLoaded');
        expect(bridgeContent).toContain('createCallbackCompatibleMethod');
        expect(bridgeContent).toContain('chrome.runtime.lastError');
        expect(bridgeContent).toContain('typeof result.then === \'function\'');
        expect(bridgeContent).toContain('typeof lastArg === \'function\'');

        // Verify it wraps the original chrome object
        expect(bridgeContent).toContain('const originalChrome = self.chrome');

        // Verify error handling
        expect(bridgeContent).toContain('callbackWithError');
    });
});
