import puppeteer, { Browser, Page } from "puppeteer";
import { Extension } from "../migrator/types/extension";
import { execSync } from "child_process";
import { logger } from "../migrator/utils/logger";

/**
 * Singelton that contains all the functions for interacting with chrome through puppeteer
 */
export class ChromeTester {
    private browser: Browser | undefined
    public static shared = new ChromeTester()

    private current_extension: Extension | null = null
    // private currentLogs: BrowserLog = {
    //     console: [],
    //     pageerrors: [],
    //     responses: [],
    //     requestfailed: [],
    //     timestamp: ""
    // }

    constructor() { }

    // fetches the path of the chrome binary
    private getChromePath(): string {
        if (process.env.IN_NIX_SHELL) {
            let bin_path = execSync(`which google-chrome-stable`).toString();
            bin_path = bin_path.replace("/bin/google-chrome-stable", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome").replace("\n", "")
            logger.debug(null, bin_path);
            return bin_path
        } else {
            // TODO
            return ""
        }
    }


    async navigateTo(url: string){
        if (!this.browser) { return }
            // Create a new page to test the new tab override
            const page = await this.browser.newPage();
            // Navigate to chrome://newtab to trigger the extension's new tab page
            await page.goto(url);

    }


    /**
     * Injects a broder with a given color into every page
     * @param{color} color string (css color)
     */
    async injectColor(color: string) {
        if (!this.browser) { return }

        // Helper function to inject into a single page
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

        // 1. Inject into all existing pages
        const pages = await this.browser.pages();
        for (const page of pages) {
            await injectIntoPage(page);
        }

        // 2. Set up listener for any new pages/tabs that open
        this.browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const page = await target.page();
                if (page) {
                    await injectIntoPage(page);
                }
            }
        });
    }

    /**
    * Launch the browser with a given extension with retry mechanism
    * @param{External} extension that should be loaded
    * @param{number} maxRetries maximum number of retry attempts
    */
    async initBrowser(extension: Extension, maxRetries: number = 3, override_headless?: boolean) {
        // Close any existing browser first to prevent conflicts
        if (this.browser) {
            logger.debug(extension, "Closing existing browser before launching new one");
            await this.closeBrowser();
        }

        const ENV_LOG_LEVEL = process.env.LOG_LEVEL || 'info';

        if (extension == undefined) {
            logger.error(extension, `Error launching browser, extension is undefined`);
            throw new Error("Extension is undefined");
        }

        this.current_extension = extension;

        // Reset logs for new extension test
        // this.resetLogs();

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            logger.debug(extension, `Launching extension ${extension.name} (${extension.id}) - Attempt ${attempt}/${maxRetries}`);

            try {
                // Add small delay between retries
                if (attempt > 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                this.browser = await puppeteer.launch({
                    headless: override_headless ? false : ENV_LOG_LEVEL.toLowerCase() == "debug" ? false : true,
                    pipe: true,
                    devtools: true,
                    executablePath: this.getChromePath(),
                    enableExtensions: [this.current_extension.manifest_v2_path],
                    args: [
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
                        `--window-name=Testing: ${extension.name} (${extension.manifest?.manifest_version || 'Unknown'})`
                    ]
                });

                logger.debug(extension, `Browser launched successfully for extension ${extension.name} on attempt ${attempt}`);
                return; // Success, exit retry loop
            } catch (error) {
                lastError = error as Error;
                logger.warn(extension, `Attempt ${attempt}/${maxRetries} failed to launch browser for extension ${extension.name}:`, { error: error, attempt: attempt, max_retries: maxRetries });

                // Clean up any partially initialized browser
                if (this.browser) {
                    try {
                        await this.browser.close();
                    } catch (closeError) {
                        logger.debug(extension, "Error closing failed browser instance:", { error: closeError });
                    }
                    this.browser = undefined;
                }

                // If this is the last attempt, we'll throw the error below
                if (attempt === maxRetries) {
                    break;
                }
            }
        }

        // All retries failed
        this.current_extension = null;
        logger.error(extension, `Failed to launch browser for extension ${extension.name} after ${maxRetries} attempts`);
        throw new Error(`Browser launch failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
    }


    // async testExtension(): Promise<ExTestResult> {
    //     if (this.browser && this.current_extension) {
    //
    //         try {
    //             const result = await testExtension(this.current_extension, this.browser);
    //
    //             logger.info(this.current_extension, `Extension tests completed for: ${this.current_extension.name}`, {
    //                 success: result.success,
    //                 testsRun: result.testsRun.length,
    //                 duration: result.duration
    //             });
    //
    //             return result;
    //         } catch (error) {
    //             const errorMessage = error instanceof Error ? error.message : String(error);
    //             logger.error(this.current_extension, `Error running tests for: ${this.current_extension.name}`, { error: errorMessage });
    //
    //             return {
    //                 success: false,
    //                 extensionId: this.current_extension.id,
    //                 extensionName: this.current_extension.name,
    //                 testsRun: [],
    //                 errors: [errorMessage],
    //                 duration: 0
    //             };
    //         }
    //     } else {
    //         const errorMessage = "Browser or extension not initialized";
    //         logger.error(this.current_extension, errorMessage);
    //
    //         return {
    //             success: false,
    //             extensionId: this.current_extension?.id || "unknown",
    //             extensionName: this.current_extension?.name || "unknown",
    //             testsRun: [],
    //             errors: [errorMessage],
    //             duration: 0
    //         };
    //     }
    // }


    /**
     * Closes the browser and tears down the context
     */
    async closeBrowser() {
        if (this.browser) {
            try {

                // Close all pages first to clean up gracefully
                const pages = await this.browser.pages();
                await Promise.all(pages.map(page => page.close().catch(() => { })));

                await this.browser.close();
            } catch (error) {
                logger.warn(null, "Error closing browser:", { error: error });
            } finally {
                this.browser = undefined;
                this.current_extension = null;
            }
        }
    }


    /**
     * Resets the current log collection
     */
    // resetLogs(): void {
    //     this.currentLogs = {
    //         console: [],
    //         pageerrors: [],
    //         responses: [],
    //         requestfailed: [],
    //         timestamp: new Date().toISOString()
    //     };
    // }

    /**
     * Initializes continuous log collection for a page
     * @param{Page} page you want to collect logs for
     */
    // setupLogCollection(page: Page): void {
    //     logger.debug(this.current_extension, `Setting up log collection for page: ${page.url()}`, { page: page.url() });
    //
    //     page
    //         .on('console', message => {
    //             const logMessage = `${message.type().toUpperCase()}: ${message.text()}`;
    //             logger.debug(this.current_extension, `[BROWSER CONSOLE] ${logMessage}`);
    //
    //             const serializedMessage: SerializedConsoleMessage = {
    //                 type: message.type(),
    //                 text: message.text(),
    //                 timestamp: new Date().toISOString()
    //             };
    //             this.currentLogs.console.push(serializedMessage);
    //         })
    //         .on('pageerror', ({ message }) => {
    //             logger.debug(this.current_extension, `[PAGE ERROR] ${message}`);
    //             this.currentLogs.pageerrors.push(message);
    //         })
    //         .on('response', response => {
    //             logger.debug(this.current_extension, `[RESPONSE] ${response.status()} ${response.url()}`);
    //
    //             const serializedResponse: SerializedHTTPResponse = {
    //                 url: response.url(),
    //                 status: response.status(),
    //                 statusText: response.statusText(),
    //                 timestamp: new Date().toISOString()
    //             };
    //             this.currentLogs.responses.push(serializedResponse);
    //         })
    //         .on('requestfailed', request => {
    //             const errorText = request.failure()?.errorText || 'Unknown error';
    //             logger.debug(this.current_extension, `[REQUEST FAILED] ${errorText} - ${request.url()}`);
    //
    //             const serializedRequest: SerializedHTTPRequest = {
    //                 url: request.url(),
    //                 method: request.method(),
    //                 errorText: errorText,
    //                 timestamp: new Date().toISOString()
    //             };
    //             this.currentLogs.requestfailed.push(serializedRequest);
    //         })
    //         .on('load', () => {
    //             logger.debug(this.current_extension, `[PAGE LOADED] ${page.url()}`);
    //         })
    //         .on('domcontentloaded', () => {
    //             logger.debug(this.current_extension, `[DOM LOADED] ${page.url()}`);
    //         });
    // }

    /**
     * Returns all collected logs since setupLogCollection was called
     * @returns{BrowserLog} all collected browser logs
     */
    // getCollectedLogs(): BrowserLog {
    //     return {
    //         ...this.currentLogs,
    //         timestamp: this.currentLogs.timestamp || new Date().toISOString()
    //     };
    // }
    //
    /**
     * Legacy method for backward compatibility - now uses continuous collection
     * @param{Page} page you want the logs for
     * @returns{Promise<BrowserLog>} browser logs
     */
    // async collectBrowserLogs(page: Page): Promise<BrowserLog> {
    //     return this.getCollectedLogs();
    // }


}
