import puppeteer, { Browser, Page } from 'puppeteer';
import { Extension } from '../migrator/types/extension';
import { execSync } from 'child_process';
import { logger } from '../migrator/utils/logger';

/**
 * Manages two Chrome instances for side-by-side extension comparison
 * One with MV2 extension, one with MV3 migrated extension
 */
export class DualChromeTester {
    private mv2Browser: Browser | undefined;
    private mv3Browser: Browser | undefined;
    public static shared = new DualChromeTester();

    private current_extension: Extension | null = null;

    constructor() {}

    /**
     * Fetches the path of the Chrome binary
     * @param latest Whether to use the latest Chrome version (for MV3) or Chrome 138 (for MV2)
     */
    private getChromePath(latest: boolean): string {
        if (process.env.IN_NIX_SHELL) {
            if (latest) {
                if (!process.env.CHROME_LATESTS) {
                    throw new Error(
                        'CHROME_LATESTS environment variable is not set. Please ensure your flake.nix exports CHROME_LATESTS.'
                    );
                }
                return `${process.env.CHROME_LATESTS}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`;
            } else {
                if (!process.env.CHROME_138) {
                    throw new Error(
                        'CHROME_138 environment variable is not set. Please ensure your flake.nix exports CHROME_138.'
                    );
                }
                return `${process.env.CHROME_138}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`;
            }
        } else {
            // TODO: Support non-Nix environments
            throw new Error('Not a nix shell! Not implemented');
        }
    }

    /**
     * Get common Chrome launch arguments
     */
    private getCommonArgs(): string[] {
        return [
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-hang-monitor',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-domain-reliability',
            '--disable-features=InterestFeedContentSuggestions',
            '--disable-features=Translate',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--enable-automation',
            '--password-store=basic',
            '--use-mock-keychain',
        ];
    }

    /**
     * Inject a colored border into all pages of a browser
     * @param browser Browser instance
     * @param color CSS color for the border
     */
    async injectColor(browser: Browser, color: string) {
        const injectIntoPage = async (page: Page) => {
            try {
                await page.evaluateOnNewDocument((color) => {
                    window.addEventListener('DOMContentLoaded', () => {
                        const style = document.createElement('style');
                        style.textContent = `
                            body {
                                border: 5px solid ${color} !important;
                                box-sizing: border-box !important;
                            }
                        `;
                        document.head.appendChild(style);
                    });
                }, color);
            } catch (err) {
                logger.debug(this.current_extension, `Failed to inject color into page: ${err}`);
            }
        };

        // Inject into all existing pages
        const pages = await browser.pages();
        for (const page of pages) {
            await injectIntoPage(page);
        }

        // Set up listener for new pages
        browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const page = await target.page();
                if (page) {
                    await injectIntoPage(page);
                }
            }
        });
    }

    /**
     * Launch both Chrome instances with MV2 and MV3 extensions
     * @param extension Extension object containing both MV2 and MV3 paths
     * @param maxRetries Maximum number of retry attempts
     */
    async initDualBrowsers(
        extension: Extension,
        maxRetries: number = 3,
        override_headless?: boolean
    ) {
        // Close any existing browsers first
        if (this.mv2Browser || this.mv3Browser) {
            logger.debug(extension, 'Closing existing browsers before launching new ones');
            await this.closeAll();
        }

        const ENV_LOG_LEVEL = process.env.LOG_LEVEL || 'info';

        if (extension == undefined) {
            logger.error(extension, `Error launching browsers, extension is undefined`);
            throw new Error('Extension is undefined');
        }

        this.current_extension = extension;

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            logger.debug(
                extension,
                `Launching dual browsers for ${extension.name} (${extension.id}) - Attempt ${attempt}/${maxRetries}`
            );

            try {
                // Add small delay between retries
                if (attempt > 1) {
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }

                const headless =
                    override_headless !== undefined
                        ? override_headless
                        : ENV_LOG_LEVEL.toLowerCase() == 'debug'
                          ? false
                          : (process.env.PUPPETEER_HEADLESS as boolean | undefined) || true;

                const commonOptions = {
                    headless,
                    pipe: true,
                    devtools: ENV_LOG_LEVEL.toLowerCase() == 'debug',
                    args: this.getCommonArgs(),
                };

                // Launch MV2 browser (Chrome 138)
                logger.debug(extension, 'Launching MV2 browser (Chrome 138)...');
                // Check if extension has MV3 path
                if (!extension.manifest_v3_path) {
                    throw new Error(`Extension ${extension.name} does not have a manifest_v3_path`);
                }

                // Ensure paths point to directories, not manifest.json files
                // (Some older database entries may have the full path to manifest.json)
                const mv2Path = extension.manifest_v2_path.endsWith('manifest.json')
                    ? extension.manifest_v2_path.replace(/\/manifest\.json$/, '')
                    : extension.manifest_v2_path;
                const mv3Path = extension.manifest_v3_path.endsWith('manifest.json')
                    ? extension.manifest_v3_path.replace(/\/manifest\.json$/, '')
                    : extension.manifest_v3_path;

                this.mv2Browser = await puppeteer.launch({
                    ...commonOptions,
                    executablePath: this.getChromePath(false), // Chrome 138
                    enableExtensions: [mv2Path],
                });

                // Inject blue border for MV2
                await this.injectColor(this.mv2Browser, 'blue');

                // Launch MV3 browser (Latest Chrome)
                logger.debug(extension, 'Launching MV3 browser (Latest Chrome)...');
                this.mv3Browser = await puppeteer.launch({
                    ...commonOptions,
                    executablePath: this.getChromePath(true), // Latest Chrome
                    enableExtensions: [mv3Path],
                });

                // Inject red border for MV3
                await this.injectColor(this.mv3Browser, 'red');

                logger.debug(
                    extension,
                    `Both browsers launched successfully for extension ${extension.name} on attempt ${attempt}`
                );
                return; // Success
            } catch (error) {
                lastError = error as Error;
                logger.warn(
                    extension,
                    `Attempt ${attempt}/${maxRetries} failed to launch browsers for extension ${extension.name}:`,
                    { error: error, attempt: attempt, max_retries: maxRetries }
                );

                // Clean up any partially initialized browsers
                await this.closeAll();

                // If this is the last attempt, we'll throw the error below
                if (attempt === maxRetries) {
                    break;
                }
            }
        }

        // All retries failed
        this.current_extension = null;
        logger.error(
            extension,
            `Failed to launch dual browsers for extension ${extension.name} after ${maxRetries} attempts`
        );
        throw new Error(
            `Dual browser launch failed after ${maxRetries} attempts. Last error: ${lastError?.message}`
        );
    }

    /**
     * Navigate both browsers to the same URL
     * @param url URL to navigate to
     */
    async navigateBoth(url: string) {
        if (!this.mv2Browser || !this.mv3Browser) {
            logger.warn(this.current_extension, 'Both browsers must be initialized');
            return;
        }

        const mv2Page = await this.mv2Browser.newPage();
        await mv2Page.setViewport({ width: 1280, height: 800 });
        await mv2Page.goto(url);

        const mv3Page = await this.mv3Browser.newPage();
        await mv3Page.setViewport({ width: 1280, height: 800 });
        await mv3Page.goto(url);
    }

    /**
     * Navigate MV2 browser to a URL
     */
    async navigateMV2(url: string) {
        if (!this.mv2Browser) {
            logger.warn(this.current_extension, 'MV2 browser must be initialized');
            return;
        }

        const page = await this.mv2Browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(url);
    }

    /**
     * Navigate MV3 browser to a URL
     */
    async navigateMV3(url: string) {
        if (!this.mv3Browser) {
            logger.warn(this.current_extension, 'MV3 browser must be initialized');
            return;
        }

        const page = await this.mv3Browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(url);
    }

    /**
     * Get the MV2 browser instance
     */
    getMV2Browser(): Browser | undefined {
        return this.mv2Browser;
    }

    /**
     * Get the MV3 browser instance
     */
    getMV3Browser(): Browser | undefined {
        return this.mv3Browser;
    }

    /**
     * Close both browsers
     */
    async closeAll() {
        const closePromises: Promise<void>[] = [];

        if (this.mv2Browser) {
            closePromises.push(
                (async () => {
                    try {
                        const pages = await this.mv2Browser!.pages();
                        await Promise.all(pages.map((page) => page.close().catch(() => {})));
                        await this.mv2Browser!.close();
                    } catch (error) {
                        logger.warn(null, 'Error closing MV2 browser:', { error: error });
                    } finally {
                        this.mv2Browser = undefined;
                    }
                })()
            );
        }

        if (this.mv3Browser) {
            closePromises.push(
                (async () => {
                    try {
                        const pages = await this.mv3Browser!.pages();
                        await Promise.all(pages.map((page) => page.close().catch(() => {})));
                        await this.mv3Browser!.close();
                    } catch (error) {
                        logger.warn(null, 'Error closing MV3 browser:', { error: error });
                    } finally {
                        this.mv3Browser = undefined;
                    }
                })()
            );
        }

        await Promise.all(closePromises);
        this.current_extension = null;
    }

    /**
     * Check if both browsers are initialized
     */
    areBothReady(): boolean {
        return this.mv2Browser !== undefined && this.mv3Browser !== undefined;
    }

    /**
     * Check if MV2 browser is ready
     */
    isMV2Ready(): boolean {
        return this.mv2Browser !== undefined;
    }

    /**
     * Check if MV3 browser is ready
     */
    isMV3Ready(): boolean {
        return this.mv3Browser !== undefined;
    }

    /**
     * Get installed extension IDs from chrome://extensions page
     * Returns { mv2ExtensionId, mv3ExtensionId }
     */
    async getExtensionIds(): Promise<{ mv2Id: string | null; mv3Id: string | null }> {
        const result = { mv2Id: null as string | null, mv3Id: null as string | null };

        try {
            // Get MV2 extension ID
            if (this.mv2Browser) {
                const page = await this.mv2Browser.newPage();
                await page.goto('chrome://extensions');
                await page.waitForSelector('extensions-manager', { timeout: 5000 });

                // Extract extension ID from the page
                const mv2Id = await page.evaluate(() => {
                    const manager = document.querySelector('extensions-manager');
                    if (!manager) return null;
                    const shadowRoot = manager.shadowRoot;
                    if (!shadowRoot) return null;
                    const itemsList = shadowRoot.querySelector('extensions-item-list');
                    if (!itemsList) return null;
                    const itemsRoot = itemsList.shadowRoot;
                    if (!itemsRoot) return null;
                    const items = itemsRoot.querySelectorAll('extensions-item');
                    if (items.length === 0) return null;
                    // Get the first extension's ID
                    const firstItem = items[0];
                    return firstItem.getAttribute('id') || null;
                });

                result.mv2Id = mv2Id;
                await page.close();
            }

            // Get MV3 extension ID
            if (this.mv3Browser) {
                const page = await this.mv3Browser.newPage();
                await page.goto('chrome://extensions');
                await page.waitForSelector('extensions-manager', { timeout: 5000 });

                const mv3Id = await page.evaluate(() => {
                    const manager = document.querySelector('extensions-manager');
                    if (!manager) return null;
                    const shadowRoot = manager.shadowRoot;
                    if (!shadowRoot) return null;
                    const itemsList = shadowRoot.querySelector('extensions-item-list');
                    if (!itemsList) return null;
                    const itemsRoot = itemsList.shadowRoot;
                    if (!itemsRoot) return null;
                    const items = itemsRoot.querySelectorAll('extensions-item');
                    if (items.length === 0) return null;
                    const firstItem = items[0];
                    return firstItem.getAttribute('id') || null;
                });

                result.mv3Id = mv3Id;
                await page.close();
            }
        } catch (error) {
            logger.warn(this.current_extension, 'Failed to extract extension IDs', { error });
        }

        return result;
    }

    /**
     * Open extension popup pages in both browsers
     * Reads manifest files to find popup HTML and navigates to chrome-extension://ID/popup.html
     */
    async openPopupPages(extension: Extension): Promise<void> {
        if (!this.mv2Browser || !this.mv3Browser) {
            logger.warn(extension, 'Both browsers must be initialized');
            return;
        }

        try {
            const fs = await import('fs');
            const path = await import('path');

            // Get extension directories
            const mv2Dir = extension.manifest_v2_path.endsWith('manifest.json')
                ? extension.manifest_v2_path.replace(/\/manifest\.json$/, '')
                : extension.manifest_v2_path;
            const mv3Dir = extension.manifest_v3_path!.endsWith('manifest.json')
                ? extension.manifest_v3_path!.replace(/\/manifest\.json$/, '')
                : extension.manifest_v3_path!;

            // Read manifests
            const mv2Manifest = JSON.parse(
                fs.readFileSync(path.join(mv2Dir, 'manifest.json'), 'utf8')
            );
            const mv3Manifest = JSON.parse(
                fs.readFileSync(path.join(mv3Dir, 'manifest.json'), 'utf8')
            );

            // Get extension IDs from Chrome
            const { mv2Id, mv3Id } = await this.getExtensionIds();

            if (!mv2Id || !mv3Id) {
                logger.warn(extension, 'Could not extract extension IDs from Chrome');
                return;
            }

            // Extract popup paths from manifests
            const mv2PopupPath =
                mv2Manifest.browser_action?.default_popup ||
                mv2Manifest.page_action?.default_popup ||
                mv2Manifest.action?.default_popup;

            const mv3PopupPath =
                mv3Manifest.action?.default_popup ||
                mv3Manifest.browser_action?.default_popup ||
                mv3Manifest.page_action?.default_popup;

            // Open popups
            if (mv2PopupPath && mv2Id) {
                const mv2PopupUrl = `chrome-extension://${mv2Id}/${mv2PopupPath.replace(/^\//, '')}`;
                logger.debug(extension, `Opening MV2 popup: ${mv2PopupUrl}`);
                await this.navigateMV2(mv2PopupUrl);
            } else if (mv2Manifest.options_page || mv2Manifest.options_ui?.page) {
                // Fallback to options page if no popup
                const optionsPath = mv2Manifest.options_page || mv2Manifest.options_ui?.page;
                const mv2OptionsUrl = `chrome-extension://${mv2Id}/${optionsPath.replace(/^\//, '')}`;
                logger.debug(extension, `Opening MV2 options page: ${mv2OptionsUrl}`);
                await this.navigateMV2(mv2OptionsUrl);
            }

            if (mv3PopupPath && mv3Id) {
                const mv3PopupUrl = `chrome-extension://${mv3Id}/${mv3PopupPath.replace(/^\//, '')}`;
                logger.debug(extension, `Opening MV3 popup: ${mv3PopupUrl}`);
                await this.navigateMV3(mv3PopupUrl);
            } else if (mv3Manifest.options_page || mv3Manifest.options_ui?.page) {
                // Fallback to options page if no popup
                const optionsPath = mv3Manifest.options_page || mv3Manifest.options_ui?.page;
                const mv3OptionsUrl = `chrome-extension://${mv3Id}/${optionsPath.replace(/^\//, '')}`;
                logger.debug(extension, `Opening MV3 options page: ${mv3OptionsUrl}`);
                await this.navigateMV3(mv3OptionsUrl);
            }

            logger.debug(extension, 'Popup pages opened successfully');
        } catch (error) {
            logger.warn(extension, 'Failed to open popup pages', { error });
        }
    }
}
