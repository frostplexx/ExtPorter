importScripts('ext_bridge.js');
// Service worker that uses callback APIs (should be bridged to promises)

// Global test results storage
const testResults = {};

// Storage API test with callback
function testStorageAPI() {
    chrome.storage.local.set({ testKey: 'testValue' }, function() {
        if (chrome.runtime.lastError) {
            testResults.storageSet = { success: false, error: chrome.runtime.lastError.message };
        } else {
            testResults.storageSet = { success: true };

            // Test get with callback
            chrome.storage.local.get(['testKey'], function(result) {
                if (chrome.runtime.lastError) {
                    testResults.storageGet = { success: false, error: chrome.runtime.lastError.message };
                } else {
                    testResults.storageGet = {
                        success: true,
                        value: result.testKey,
                        matches: result.testKey === 'testValue'
                    };
                }
            });
        }
    });
}

// Tabs API test with callback
function testTabsAPI() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (chrome.runtime.lastError) {
            testResults.tabsQuery = { success: false, error: chrome.runtime.lastError.message };
        } else {
            testResults.tabsQuery = {
                success: true,
                tabCount: tabs.length,
                hasActiveTab: tabs.length > 0 && tabs[0].active
            };
        }
    });
}

// Message handling with callback response
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.type === 'GET_TEST_RESULTS') {
        sendResponse({
            success: true,
            results: testResults,
            bridgeWorking: typeof testResults.storageSet !== 'undefined'
        });
        return true; // Async response
    }

    if (request.type === 'RUN_TESTS') {
        // Clear previous results
        Object.keys(testResults).forEach(key => delete testResults[key]);

        // Run tests
        testStorageAPI();
        testTabsAPI();

        // Send response after a delay to allow tests to complete
        setTimeout(() => {
            sendResponse({
                success: true,
                message: 'Tests started',
                results: testResults
            });
        }, 500);

        return true; // Async response
    }
});

// Initialize tests when service worker starts
testStorageAPI();
testTabsAPI();

// Export for testing
if (typeof globalThis !== 'undefined') {
    globalThis.bridgeTestResults = testResults;
}