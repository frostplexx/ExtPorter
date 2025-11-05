// Background script with window.open calls (MV2 style)

console.log('Background script loaded');

// window.open on installation - should be migrated
chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason === 'install') {
        // This works in MV2 background page but not in MV3 service worker
        window.open('https://example.com/welcome');
    }
});

// window.open with variable
function openWelcomePage() {
    const url = 'https://example.com/help';
    window.open(url);
}

// window.open with template literal
chrome.browserAction.onClicked.addListener(function() {
    const userId = '12345';
    window.open(`https://example.com/user/${userId}`);
});

// window.open with additional parameters (target, features)
function openInNewWindow() {
    window.open('https://example.com/dashboard', '_blank', 'width=800,height=600');
}

console.log('Background script setup complete');
