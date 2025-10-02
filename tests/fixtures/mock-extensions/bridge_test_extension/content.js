// Content script that uses callback APIs and communicates with background

// Create a test indicator on the page
function createTestIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'bridge-test-indicator';
    indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #007cba;
        color: white;
        padding: 10px;
        border-radius: 5px;
        z-index: 10000;
        font-family: Arial, sans-serif;
        font-size: 12px;
        cursor: pointer;
    `;
    indicator.textContent = 'Bridge Test Loading...';
    document.body.appendChild(indicator);
    return indicator;
}

// Test messaging with background script
function testBackgroundCommunication(indicator) {
    chrome.runtime.sendMessage(
        { type: 'RUN_TESTS' },
        function(response) {
            if (chrome.runtime.lastError) {
                indicator.textContent = 'Bridge Test: Error';
                indicator.style.background = '#d32f2f';
                indicator.setAttribute('data-test-status', 'error');
                indicator.setAttribute('data-error', chrome.runtime.lastError.message);
            } else if (response && response.success) {
                indicator.textContent = 'Bridge Test: Active';
                indicator.style.background = '#388e3c';
                indicator.setAttribute('data-test-status', 'success');

                // Get final results after delay
                setTimeout(() => {
                    chrome.runtime.sendMessage(
                        { type: 'GET_TEST_RESULTS' },
                        function(finalResponse) {
                            if (finalResponse && finalResponse.results) {
                                const results = finalResponse.results;
                                const allPassed =
                                    results.storageSet?.success &&
                                    results.storageGet?.success &&
                                    results.storageGet?.matches &&
                                    results.tabsQuery?.success;

                                indicator.setAttribute('data-test-results', JSON.stringify(results));
                                indicator.setAttribute('data-all-passed', allPassed ? 'true' : 'false');

                                if (allPassed) {
                                    indicator.textContent = 'Bridge Test: Passed';
                                    indicator.style.background = '#2e7d32';
                                } else {
                                    indicator.textContent = 'Bridge Test: Failed';
                                    indicator.style.background = '#d32f2f';
                                }
                            }
                        }
                    );
                }, 1000);
            } else {
                indicator.textContent = 'Bridge Test: No Response';
                indicator.style.background = '#f57c00';
                indicator.setAttribute('data-test-status', 'no-response');
            }
        }
    );
}

// Storage test in content script
function testContentStorage(callback) {
    chrome.storage.local.set({ contentTest: 'contentValue' }, function() {
        if (chrome.runtime.lastError) {
            callback({ success: false, error: chrome.runtime.lastError.message });
        } else {
            chrome.storage.local.get(['contentTest'], function(result) {
                if (chrome.runtime.lastError) {
                    callback({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    callback({
                        success: true,
                        value: result.contentTest,
                        matches: result.contentTest === 'contentValue'
                    });
                }
            });
        }
    });
}

// Initialize when page loads
function initialize() {
    const indicator = createTestIndicator();

    // Test content script storage first
    testContentStorage(function(contentResult) {
        indicator.setAttribute('data-content-storage', JSON.stringify(contentResult));

        // Then test background communication
        testBackgroundCommunication(indicator);
    });

    // Add click handler for manual testing
    indicator.addEventListener('click', function() {
        testBackgroundCommunication(indicator);
    });
}

// Wait for page to load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}