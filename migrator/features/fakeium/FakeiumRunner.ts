/**
 * FakeiumRunner - Orchestrates extension execution in fakeium sandbox
 */

import { Fakeium } from 'fakeium';
import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { generateMV2ChromeAPI, generateMV3ChromeAPI } from './chrome-api-injection';
import {
    ApiCall,
    ExtensionBehavior,
    FakeiumRunOptions,
    FakeiumRunResult
} from './types';

export class FakeiumRunner {
    /**
     * Run an extension in fakeium sandbox and capture its behavior
     */
    static async runExtension(
        extension: Extension,
        manifestVersion: 2 | 3,
        options: FakeiumRunOptions = {}
    ): Promise<FakeiumRunResult> {
        const startTime = Date.now();
        const errors: string[] = [];

        try {
            // Create fakeium instance
            const fakeium = new Fakeium({
                sourceType: options.sourceType || 'script',
                origin: options.origin || 'chrome-extension://mock-extension-id',
                timeout: options.timeout || 30000,
                maxMemory: options.maxMemory || 512
            });

            // Inject Chrome API mock as code
            const chromeAPICode = manifestVersion === 2 ? generateMV2ChromeAPI() : generateMV3ChromeAPI();

            if (options.verbose) {
                console.log(`Injecting Chrome API mock for MV${manifestVersion}...`);
            }

            try {
                await fakeium.run('chrome-api-mock.js', chromeAPICode);
                if (options.verbose) {
                    console.log('  ✓ Chrome API mock injected');
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                errors.push(`Chrome API injection failed: ${errorMsg}`);
                if (options.verbose) {
                    console.error('  ✗ Chrome API injection failed:', error);
                }
            }

            // Execute extension files
            const executionErrors = await this.executeExtensionFiles(fakeium, extension, options.verbose);
            errors.push(...executionErrors);

            // Capture the report
            const report = fakeium.getReport();
            const rawEvents = report.getAll();

            if (options.verbose) {
                console.log(`  Total events captured: ${rawEvents.length}`);
                if (rawEvents.length > 0) {
                    console.log(`  Sample events:`, rawEvents.slice(0, 10).map(e => ({type: e.type, path: e.path})));

                    // Show all chrome/browser-related events
                    const chromeEvents = rawEvents.filter(e => e.path && (e.path.includes('chrome') || e.path.includes('browser')));
                    console.log(`  Chrome/Browser API events: ${chromeEvents.length}`);
                    if (chromeEvents.length > 0) {
                        console.log(`  API events:`, chromeEvents.slice(0, 15).map(e => ({type: e.type, path: e.path})));
                    }
                }
            }

            // Extract API calls
            const apiCalls = this.extractApiCalls(rawEvents);

            if (options.verbose) {
                console.log(`  Chrome API calls extracted: ${apiCalls.length}`);
                if (apiCalls.length === 0 && rawEvents.length > 0) {
                    console.log(`  WARNING: Events captured but no Chrome API calls found`);
                    console.log(`  All event paths:`, rawEvents.map(e => e.path).filter(p => p));
                }
                if (errors.length > 0) {
                    console.log(`  Execution errors: ${errors.length}`);
                    errors.forEach(err => console.log(`    - ${err}`));
                }

                // Check for unmocked API warnings in console output
                const unmockedWarnings = rawEvents.filter((e: any) => {
                    if (e.type !== 'CallEvent' || e.path !== 'console.warn') return false;
                    const firstArg = e.arguments?.[0]?.literal;
                    return typeof firstArg === 'string' && firstArg.includes('[FAKEIUM] Unmocked API');
                });
                if (unmockedWarnings.length > 0) {
                    console.log(`\n  ⚠️  UNMOCKED APIs detected (${unmockedWarnings.length}):`);
                    unmockedWarnings.slice(0, 10).forEach((w: any) => {
                        const msg = w.arguments?.[0]?.literal;
                        if (typeof msg === 'string') {
                            console.log(`    - ${msg.replace('[FAKEIUM] Unmocked API accessed: ', '')}`);
                        }
                    });
                    if (unmockedWarnings.length > 10) {
                        console.log(`    ... and ${unmockedWarnings.length - 10} more`);
                    }
                    console.log(`\n  Add these APIs to migrator/features/fakeium/chrome-api-injection.ts`);
                }
            }

            const duration = Date.now() - startTime;

            const behavior: ExtensionBehavior = {
                manifestVersion,
                extensionId: extension.id,
                extensionName: extension.name,
                apiCalls,
                errors,
                duration
            };

            // Dispose the fakeium instance to free memory
            try {
                if (fakeium && typeof (fakeium as any).dispose === 'function') {
                    (fakeium as any).dispose();
                }
            } catch (disposeError) {
                // Silently fail disposal - not critical
            }

            return {
                behavior,
                rawEvents,
                success: true
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push(errorMessage);

            const duration = Date.now() - startTime;

            return {
                behavior: {
                    manifestVersion,
                    extensionId: extension.id,
                    extensionName: extension.name,
                    apiCalls: [],
                    errors,
                    duration
                },
                rawEvents: [],
                success: false
            };
        }
    }

    /**
     * Execute all relevant extension files in fakeium
     */
    private static async executeExtensionFiles(
        fakeium: Fakeium,
        extension: Extension,
        verbose?: boolean
    ): Promise<string[]> {
        const executionErrors: string[] = [];

        // Get JavaScript files to execute
        const jsFiles = extension.files.filter(
            file => file.filetype === ExtFileType.JS && !file.path.includes('ext_bridge.js')
        );

        if (verbose) {
            console.log(`Executing ${jsFiles.length} JavaScript files from ${extension.name}`);
        }

        // Execute each file
        for (const file of jsFiles) {
            try {
                const content = file.getContent();
                const filename = file.path;

                if (verbose) {
                    console.log(`  - Executing ${filename} (${content.length} bytes)`);
                }

                // Run the file in fakeium
                await fakeium.run(filename, content);

                if (verbose) {
                    console.log(`    ✓ Executed successfully`);
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                executionErrors.push(`${file.path}: ${errorMsg}`);
                if (verbose) {
                    console.error(`  ✗ Error executing ${file.path}:`, error);
                }
                // Continue with other files even if one fails
            }
        }

        return executionErrors;
    }

    /**
     * Extract API calls from fakeium report events
     */
    private static extractApiCalls(events: any[]): ApiCall[] {
        const apiCalls: ApiCall[] = [];

        for (const event of events) {
            // Filter for Chrome/Browser API calls (both namespaces are equivalent)
            if (event.path && (event.path.startsWith('chrome.') || event.path.startsWith('browser.'))) {
                // Normalize browser.* to chrome.* for consistent comparison
                const normalizedPath = event.path.startsWith('browser.')
                    ? event.path.replace('browser.', 'chrome.')
                    : event.path;

                const apiCall: ApiCall = {
                    path: normalizedPath,
                    type: event.type,
                    location: event.location
                };

                if (event.type === 'CallEvent') {
                    apiCall.arguments = event.arguments?.map((arg: any) => {
                        // Convert fakeium's reference/literal format to actual values
                        if (arg.literal !== undefined) {
                            return arg.literal;
                        } else if (arg.ref !== undefined) {
                            return `<ref:${arg.ref}>`;
                        }
                        return arg;
                    });
                    apiCall.returns = event.returns;
                    apiCall.isConstructor = event.isConstructor;
                }

                apiCalls.push(apiCall);
            }
        }

        return apiCalls;
    }

    /**
     * Helper to get background script behavior specifically
     */
    static async runBackgroundScript(
        extension: Extension,
        manifestVersion: 2 | 3,
        options: FakeiumRunOptions = {}
    ): Promise<FakeiumRunResult> {
        // Filter to only background scripts
        const backgroundFiles = extension.files.filter(file => {
            const path = file.path.toLowerCase();
            return path.includes('background') && file.filetype === ExtFileType.JS;
        });

        if (backgroundFiles.length === 0) {
            return {
                behavior: {
                    manifestVersion,
                    extensionId: extension.id,
                    extensionName: extension.name,
                    apiCalls: [],
                    errors: ['No background script found'],
                    duration: 0
                },
                rawEvents: [],
                success: false
            };
        }

        // Create a temporary extension with only background files
        const backgroundExtension: Extension = {
            ...extension,
            files: backgroundFiles
        };

        return this.runExtension(backgroundExtension, manifestVersion, options);
    }

    /**
     * Helper to get content script behavior specifically
     */
    static async runContentScripts(
        extension: Extension,
        manifestVersion: 2 | 3,
        options: FakeiumRunOptions = {}
    ): Promise<FakeiumRunResult> {
        // Filter to only content scripts
        const contentScripts = extension.manifest.content_scripts || [];
        const contentScriptPaths = contentScripts.flatMap((cs: any) => cs.js || []);

        const contentFiles = extension.files.filter(file =>
            contentScriptPaths.includes(file.path) && file.filetype === ExtFileType.JS
        );

        if (contentFiles.length === 0) {
            return {
                behavior: {
                    manifestVersion,
                    extensionId: extension.id,
                    extensionName: extension.name,
                    apiCalls: [],
                    errors: ['No content scripts found'],
                    duration: 0
                },
                rawEvents: [],
                success: false
            };
        }

        // Create a temporary extension with only content script files
        const contentExtension: Extension = {
            ...extension,
            files: contentFiles
        };

        return this.runExtension(contentExtension, manifestVersion, options);
    }
}
