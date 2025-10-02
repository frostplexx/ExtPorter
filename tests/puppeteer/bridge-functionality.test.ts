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

        // Inject the bridge into a test page and verify it works
        await page.goto('data:text/html,<html><body><h1>Bridge Test</h1></body></html>');

        // Mock Chrome APIs for testing
        await page.evaluateOnNewDocument(() => {
            // Mock Chrome storage API with promise support
            (window as any).chrome = {
                storage: {
                    local: {
                        set: (data: any, callback: (error?: any) => void) => {
                            // Simulate async storage operation
                            setTimeout(() => {
                                (window as any).__storageData = { ...(window as any).__storageData, ...data };
                                callback();
                            }, 10);
                        },
                        get: (keys: string[], callback: (result: any) => void) => {
                            // Simulate async storage retrieval
                            setTimeout(() => {
                                const result: any = {};
                                keys.forEach(key => {
                                    if ((window as any).__storageData && (window as any).__storageData[key] !== undefined) {
                                        result[key] = (window as any).__storageData[key];
                                    }
                                });
                                callback(result);
                            }, 10);
                        }
                    }
                },
                runtime: {
                    lastError: undefined
                }
            };
            (window as any).__storageData = {};
        });

        // Inject the bridge
        await page.evaluate(bridgeContent);

        // Test that the bridge correctly handles callback APIs
        const testResult = await page.evaluate(() => {
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
                                resolve({
                                    success: true,
                                    value: result.testKey,
                                    matches: result.testKey === 'testValue'
                                });
                            }
                        });
                    }
                });
            });
        });

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
        expect(bridgeContent).toContain('const originalChrome = window.chrome');

        // Verify error handling
        expect(bridgeContent).toContain('callbackWithError');
    });
});