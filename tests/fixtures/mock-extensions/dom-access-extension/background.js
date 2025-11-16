// Service worker that attempts to access DOM APIs
// These patterns should trigger offscreen document migration

console.log('Service worker starting...');

// DOM Access - should be moved to offscreen document
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed');
    
    // This will fail in a service worker - needs offscreen document
    try {
        const element = document.getElementById('test');
        console.log('Element found:', element);
    } catch (error) {
        console.error('DOM access failed (expected in service worker):', error);
    }
});

// LocalStorage access - should use offscreen document
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'saveData') {
        try {
            // This will fail in service worker
            window.localStorage.setItem('myData', message.data);
            sendResponse({ success: true });
        } catch (error) {
            console.error('localStorage access failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }
    
    if (message.action === 'getData') {
        try {
            // This will fail in service worker
            const data = window.localStorage.getItem('myData');
            sendResponse({ success: true, data });
        } catch (error) {
            console.error('localStorage access failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }
    
    return true; // Keep channel open for async response
});

// Canvas operations - should use offscreen document
// Example of code that SHOULD work in service worker (no DOM access)
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        console.log('Tab updated:', tab.url);
    }
});

console.log('Service worker setup complete');
