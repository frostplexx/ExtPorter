import { ExTestResult, TestResult, BrowserLog } from "../types/ex_test_result";
import { logger } from "../utils/logger";

export interface TestComparison {
    extensionId: string;
    extensionName: string;
    mv2Success: boolean;
    mv3Success: boolean;
    compatibilityIssues: CompatibilityIssue[];
    internetCallChanges: InternetCallChange[];
}

export interface CompatibilityIssue {
    type: 'error' | 'test_failure';
    testName?: string;
    mv2Error?: string;
    mv3Error?: string;
    description: string;
}

export interface InternetCallChange {
    type: 'request_added' | 'request_removed' | 'response_changed' | 'request_failed';
    url: string;
    mv2Status?: number;
    mv3Status?: number;
    description: string;
}

export class TestResultComparator {
    static compare(mv2Result: ExTestResult, mv3Result: ExTestResult): TestComparison {
        if (mv2Result.extensionId !== mv3Result.extensionId) {
            throw new Error("Cannot compare results from different extensions");
        }

        // TODO: Update this to handle chaning ids
        const comparison: TestComparison = {
            extensionId: mv2Result.extensionId,
            extensionName: mv2Result.extensionName,
            mv2Success: mv2Result.success,
            mv3Success: mv3Result.success,
            compatibilityIssues: [],
            internetCallChanges: []
        };

        // Compare overall errors
        this.compareErrors(mv2Result, mv3Result, comparison);

        // Compare individual test results
        this.compareTestResults(mv2Result, mv3Result, comparison);

        // Compare internet calls from browser logs
        this.compareInternetCalls(mv2Result, mv3Result, comparison);

        return comparison;
    }

    private static compareErrors(mv2Result: ExTestResult, mv3Result: ExTestResult, comparison: TestComparison) {
        const mv2Errors = new Set(mv2Result.errors);
        const mv3Errors = new Set(mv3Result.errors);

        // Find errors that are different between versions
        for (const mv2Error of mv2Errors) {
            if (!mv3Errors.has(mv2Error)) {
                comparison.compatibilityIssues.push({
                    type: 'error',
                    mv2Error,
                    description: `Error present in MV2 but not in MV3: ${mv2Error}`
                });
            }
        }

        for (const mv3Error of mv3Errors) {
            if (!mv2Errors.has(mv3Error)) {
                comparison.compatibilityIssues.push({
                    type: 'error',
                    mv3Error,
                    description: `Error present in MV3 but not in MV2: ${mv3Error}`
                });
            }
        }
    }

    private static compareTestResults(mv2Result: ExTestResult, mv3Result: ExTestResult, comparison: TestComparison) {
        const mv2Tests = new Map<string, TestResult>();
        const mv3Tests = new Map<string, TestResult>();

        // Create maps for easy lookup
        mv2Result.testsRun.forEach(test => mv2Tests.set(test.testName, test));
        mv3Result.testsRun.forEach(test => mv3Tests.set(test.testName, test));

        // Compare tests that exist in both versions
        for (const [testName, mv2Test] of mv2Tests) {
            const mv3Test = mv3Tests.get(testName);
            
            if (mv3Test) {
                // Both versions have this test, compare results
                if (mv2Test.success !== mv3Test.success) {
                    comparison.compatibilityIssues.push({
                        type: 'test_failure',
                        testName,
                        mv2Error: mv2Test.error,
                        mv3Error: mv3Test.error,
                        description: `Test "${testName}" had different outcomes: MV2=${mv2Test.success ? 'pass' : 'fail'}, MV3=${mv3Test.success ? 'pass' : 'fail'}`
                    });
                } else if (!mv2Test.success && !mv3Test.success && mv2Test.error !== mv3Test.error) {
                    // Both failed but with different errors
                    comparison.compatibilityIssues.push({
                        type: 'test_failure',
                        testName,
                        mv2Error: mv2Test.error,
                        mv3Error: mv3Test.error,
                        description: `Test "${testName}" failed in both versions but with different errors`
                    });
                }
            }
        }
    }

    private static compareInternetCalls(mv2Result: ExTestResult, mv3Result: ExTestResult, comparison: TestComparison) {
        // Collect all browser logs from all tests
        const mv2Logs = this.collectAllBrowserLogs(mv2Result);
        const mv3Logs = this.collectAllBrowserLogs(mv3Result);

        // Compare HTTP responses
        this.compareHttpResponses(mv2Logs, mv3Logs, comparison);

        // Compare failed requests
        this.compareFailedRequests(mv2Logs, mv3Logs, comparison);
    }

    private static collectAllBrowserLogs(result: ExTestResult): BrowserLog[] {
        return result.testsRun
            .map(test => test.logs)
            .filter(log => log !== undefined) as BrowserLog[];
    }

    private static compareHttpResponses(mv2Logs: BrowserLog[], mv3Logs: BrowserLog[], comparison: TestComparison) {
        const mv2Responses = new Map<string, number>();
        const mv3Responses = new Map<string, number>();

        // Collect all responses by URL
        mv2Logs.forEach(log => {
            log.responses.forEach(response => {
                mv2Responses.set(response.url, response.status);
            });
        });

        mv3Logs.forEach(log => {
            log.responses.forEach(response => {
                mv3Responses.set(response.url, response.status);
            });
        });

        // Find differences
        for (const [url, mv2Status] of mv2Responses) {
            if (!mv3Responses.has(url)) {
                comparison.internetCallChanges.push({
                    type: 'request_removed',
                    url,
                    mv2Status,
                    description: `HTTP request to ${url} present in MV2 but not in MV3`
                });
            } else {
                const mv3Status = mv3Responses.get(url)!;
                if (mv2Status !== mv3Status) {
                    comparison.internetCallChanges.push({
                        type: 'response_changed',
                        url,
                        mv2Status,
                        mv3Status,
                        description: `HTTP response status changed for ${url}: MV2=${mv2Status}, MV3=${mv3Status}`
                    });
                }
            }
        }

        for (const [url, mv3Status] of mv3Responses) {
            if (!mv2Responses.has(url)) {
                comparison.internetCallChanges.push({
                    type: 'request_added',
                    url,
                    mv3Status,
                    description: `HTTP request to ${url} present in MV3 but not in MV2`
                });
            }
        }
    }

    private static compareFailedRequests(mv2Logs: BrowserLog[], mv3Logs: BrowserLog[], comparison: TestComparison) {
        const mv2Failed = new Set<string>();
        const mv3Failed = new Set<string>();

        // Collect all failed requests by URL
        mv2Logs.forEach(log => {
            log.requestfailed.forEach(request => {
                mv2Failed.add(request.url);
            });
        });

        mv3Logs.forEach(log => {
            log.requestfailed.forEach(request => {
                mv3Failed.add(request.url);
            });
        });

        // Find differences in failed requests
        for (const url of mv2Failed) {
            if (!mv3Failed.has(url)) {
                comparison.internetCallChanges.push({
                    type: 'request_failed',
                    url,
                    description: `Request to ${url} failed in MV2 but succeeded in MV3`
                });
            }
        }

        for (const url of mv3Failed) {
            if (!mv2Failed.has(url)) {
                comparison.internetCallChanges.push({
                    type: 'request_failed',
                    url,
                    description: `Request to ${url} succeeded in MV2 but failed in MV3`
                });
            }
        }
    }

    static logComparison(comparison: TestComparison) {
        logger.info(null, `Comparison for extension: ${comparison.extensionName} (${comparison.extensionId})`);
        logger.info(null, `MV2 Success: ${comparison.mv2Success}, MV3 Success: ${comparison.mv3Success}`);

        // Log compatibility issues as errors
        if (comparison.compatibilityIssues.length > 0) {
            logger.error(null, `Found ${comparison.compatibilityIssues.length} compatibility issues:`, {
                extensionId: comparison.extensionId,
                issues: comparison.compatibilityIssues
            });

            
            comparison.compatibilityIssues.forEach(issue => {
                logger.error(null, `[COMPATIBILITY] ${issue.description}`, {
                    type: issue.type,
                    testName: issue.testName,
                    mv2Error: issue.mv2Error,
                    mv3Error: issue.mv3Error
                });
            });
        }

        // Log internet call changes as warnings
        if (comparison.internetCallChanges.length > 0) {
            logger.warn(null, `Found ${comparison.internetCallChanges.length} internet call changes:`, {
                extensionId: comparison.extensionId,
                changes: comparison.internetCallChanges
            });

            comparison.internetCallChanges.forEach(change => {
                logger.warn(null, `[INTERNET_CALL] ${change.description}`, {
                    type: change.type,
                    url: change.url,
                    mv2Status: change.mv2Status,
                    mv3Status: change.mv3Status
                });
            });
        }

        if (comparison.compatibilityIssues.length === 0 && comparison.internetCallChanges.length === 0) {
            logger.info(null, `Extension ${comparison.extensionName} has no compatibility issues or internet call changes`);
        }
    }
}
