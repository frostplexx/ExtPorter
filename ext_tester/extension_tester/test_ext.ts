// import { Browser } from "puppeteer";
// import { BrowserLog, ExTestResult, TestResult } from "../../types/ex_test_result";
// import { ChromeTester } from "./chrome_tester";
//
// export async function testExtension(extension: Extension, browser: Browser): Promise<ExTestResult> {
//     const startTime = performance.now();
//     const testsRun: TestResult[] = [];
//     const errors: string[] = [];
//
//     try {
//         logger.info(extension, `Starting tests for extension: ${extension.name} (${extension.id})`);
//
//         // Run new tab test
//         const newTabResult = await testNewTab(extension, browser);
//         if (newTabResult) testsRun.push(newTabResult);
//
//         // Run popup test
//         const popupResult = await testPopUpFunctionality(extension, browser);
//         if (popupResult) testsRun.push(popupResult);
//
//         const endTime = performance.now();
//         const duration = endTime - startTime;
//
//         // Check if all tests passed
//         const success = testsRun.every(test => test.success) && errors.length === 0;
//
//         return {
//             success,
//             extensionId: extension.id,
//             extensionName: extension.name,
//             testsRun,
//             errors,
//             duration
//         };
//
//     } catch (error) {
//         const endTime = performance.now();
//         const duration = endTime - startTime;
//         const errorMessage = error instanceof Error ? error.message : String(error);
//
//         logger.error(extension, `Error testing extension ${extension.name}:`, { error: errorMessage });
//
//         return {
//             success: false,
//             extensionId: extension.id,
//             extensionName: extension.name,
//             testsRun,
//             errors: [errorMessage],
//             duration
//         };
//     }
// }
//
//
// /**
//  * Tests an extension for new tab functionality
//  * @param{Extension} extension to be tested
//  * @param{Browser} browser instance
//  * @return TestResult if its a new tab extension, else null
//  */
// async function testNewTab(extension: Extension, browser: Browser): Promise<TestResult | null> {
//     if (extension.manifest["chrome_url_overrides"] != undefined && extension.manifest["chrome_url_overrides"]["newtab"] != null) {
//         const startTime = performance.now();
//         let page;
//
//         try {
//             logger.debug(extension, `Testing new tab functionality for ${extension.name}`);
//
//             // Create a new page to test the new tab override
//             page = await browser.newPage();
//
//             // Set up continuous log collection before navigation
//             ChromeTester.shared.setupLogCollection(page);
//
//             // Navigate to chrome://newtab to trigger the extension's new tab page
//             await page.goto('chrome://newtab/', { waitUntil: 'networkidle2', timeout: 10000 });
//
//
//             // Check if the page title or content indicates the extension loaded
//             const title = await page.title();
//             const url = page.url();
//
//             const endTime = performance.now();
//             const duration = endTime - startTime;
//
//             // Consider test successful if we can navigate and get a response
//             const success = url !== 'chrome://newtab/' && title !== 'New Tab';
//
//             logger.debug(extension, `New tab test result for ${extension.name}: ${success ? 'PASS' : 'FAIL'}`);
//             let logs = await ChromeTester.shared.collectBrowserLogs(page);
//
//             logger.debug(extension, "Browser logs collected:");
//             logger.debug(extension, JSON.stringify(logs, null, 2));
//
//             return {
//                 testName: 'new_tab_override',
//                 success,
//                 duration,
//                 logs,
//                 details: {
//                     title,
//                     url,
//                     newTabPage: extension.manifest["chrome_url_overrides"]["newtab"]
//                 }
//             };
//
//         } catch (error) {
//             const endTime = performance.now();
//             const duration = endTime - startTime;
//             const errorMessage = error instanceof Error ? error.message : String(error);
//
//             logger.error(extension, `New tab test failed for ${extension.name}:`, { error: errorMessage });
//
//             let logs = page != undefined ? await ChromeTester.shared.collectBrowserLogs(page!) : {} as BrowserLog
//
//             return {
//                 testName: 'new_tab_override',
//                 success: false,
//                 logs: logs,
//                 error: errorMessage,
//                 duration,
//                 details: { newTabPage: extension.manifest["chrome_url_overrides"]["newtab"] }
//             };
//         } finally {
//             if (page) {
//                 await page.close();
//             }
//         }
//     } else {
//         logger.debug(extension, `${extension.name} does not override new tab`);
//         return null;
//     }
// }
//
//
// async function testPopUpFunctionality(extension: Extension, browser: Browser): Promise<TestResult | null> {
//     // Check both browser_action (Manifest V2) and action (Manifest V3) for popup
//     const browserAction = extension.manifest["browser_action"];
//     const action = extension.manifest["action"];
//     const popupPath = browserAction?.["default_popup"] || action?.["default_popup"];
//
//     if (popupPath) {
//         const startTime = performance.now();
//         let page;
//
//         try {
//             logger.debug(extension, `Testing popup functionality for ${extension.name}`);
//
//             page = await browser.newPage();
//
//             // Set up continuous log collection before navigation
//             ChromeTester.shared.setupLogCollection(page);
//
//             // Navigate to the popup page directly
//             const popupUrl = `chrome-extension://${extension.id}/${popupPath}`;
//             await page.goto(popupUrl, { waitUntil: 'networkidle2', timeout: 10000 });
//
//             // Check if the popup loaded successfully
//             const title = await page.title();
//             const content = await page.content();
//             const url = page.url();
//
//             // Note: Interactive element testing (clicking buttons, links, etc.) is currently
//             // disabled due to issues with hanging/blocking behavior in automated tests.
//             // Future improvements could add timeout-based interaction testing.
//
//
//             const endTime = performance.now();
//             const duration = endTime - startTime;
//
//             // Consider test successful if page loaded and contains content
//             const success = url.includes(extension.id) && content.length > 100;
//
//             logger.debug(extension, `Popup test result for ${extension.name}: ${success ? 'PASS' : 'FAIL'}`);
//
//             return {
//                 testName: 'popup_functionality',
//                 success,
//                 duration,
//                 logs: await ChromeTester.shared.collectBrowserLogs(page),
//                 details: {
//                     title,
//                     url,
//                     popupPath,
//                     contentLength: content.length,
//                     // successfulClicks
//                 }
//             };
//
//         } catch (error) {
//             const endTime = performance.now();
//             const duration = endTime - startTime;
//             const errorMessage = error instanceof Error ? error.message : String(error);
//
//             logger.error(extension, `Popup test failed for ${extension.name}:`, { error: errorMessage });
//
//             return {
//                 testName: 'popup_functionality',
//                 logs: page != undefined ? await ChromeTester.shared.collectBrowserLogs(page) : {} as BrowserLog,
//                 success: false,
//                 error: errorMessage,
//                 duration,
//                 details: { popupPath }
//             };
//         } finally {
//             if (page) {
//                 await page.close();
//             }
//         }
//     } else {
//         logger.debug(extension, `${extension.name} does not have a popup`);
//         return null;
//     }
// }
