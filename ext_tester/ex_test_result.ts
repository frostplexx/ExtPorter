import { ConsoleMessage, HTTPRequest, HTTPResponse } from 'puppeteer';

export interface ExTestResult {
    success: boolean;
    extensionId: string;
    extensionName: string;
    testsRun: TestResult[];
    errors: string[];
    duration: number;
}

export interface TestResult {
    testName: string;
    success: boolean;
    error?: string;
    duration: number;
    details?: any;
    logs: BrowserLog;
}

export interface BrowserLog {
    console: SerializedConsoleMessage[];
    pageerrors: string[];
    responses: SerializedHTTPResponse[];
    requestfailed: SerializedHTTPRequest[];
    timestamp: string;
}

export interface SerializedConsoleMessage {
    type: string;
    text: string;
    timestamp: string;
}

export interface SerializedHTTPResponse {
    url: string;
    status: number;
    statusText: string;
    timestamp: string;
}

export interface SerializedHTTPRequest {
    url: string;
    method: string;
    errorText?: string;
    timestamp: string;
}
