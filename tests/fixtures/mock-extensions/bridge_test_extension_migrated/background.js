importScripts('ext_bridge.js');
// Service worker that uses callback APIs (should be bridged to promises)

// Global test results storage
const testResults = {};
let testsCompleted = false;

// Storage API test with callback
function testStorageAPI(onComplete) {
    chrome.storage.local.set({ testKey: 'testValue' }, function() {
        if (chrome.runtime.lastError) {
            testResults.storageSet = { success: false, error: chrome.runtime.lastError.message };
            if (onComplete) onComplete();
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
                if (onComplete) onComplete();
            });
        }
    });
}

// Tabs API test with callback
function testTabsAPI(onComplete) {
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
        if (onComplete) onComplete();
    });
}

// Message handling with callback response
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    console.log('Background received message:', request.type);

    if (request.type === 'GET_TEST_RESULTS') {
        console.log('Sending test results:', testResults);
        sendResponse({
            success: true,
            results: testResults,
            bridgeWorking: typeof testResults.storageSet !== 'undefined'
        });
        return true; // Async response
    }

    if (request.type === 'RUN_TESTS') {
        console.log('Running tests in background...');
        // Clear previous results
        Object.keys(testResults).forEach(key => delete testResults[key]);
        testsCompleted = false;

        // Run tests with completion tracking
        let completedCount = 0;
        const onTestComplete = () => {
            completedCount++;
            if (completedCount === 2) {
                testsCompleted = true;
                sendResponse({
                    success: true,
                    message: 'Tests completed',
                    results: testResults
                });
            }
        };

        testStorageAPI(onTestComplete);
        testTabsAPI(onTestComplete);

        return true; // Async response
    }
});

// Initialize tests when service worker starts
let initCompletedCount = 0;
const onInitComplete = () => {
    initCompletedCount++;
    if (initCompletedCount === 2) {
        testsCompleted = true;
    }
};

testStorageAPI(onInitComplete);
testTabsAPI(onInitComplete);

// Export for testing
if (typeof globalThis !== 'undefined') {
    globalThis.bridgeTestResults = testResults;
}