// Background script with non-callback Chrome APIs

// Direct URL generation (synchronous)
const popupUrl = chrome.runtime.getURL('popup.html');
console.log('Popup URL:', popupUrl);

// Extension ID access
console.log('Extension ID:', chrome.runtime.id);

// Browser action without callback
chrome.browserAction.setBadgeText({ text: '!' });
chrome.browserAction.setTitle({ title: 'No Callback Extension' });

// Tab events (not callback-based)
chrome.tabs.onCreated.addListener(function (tab) {
    console.log('New tab created:', tab.id);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete') {
        console.log('Tab completed loading:', tab.url);
    }
});

// Runtime events
chrome.runtime.onInstalled.addListener(function (details) {
    console.log('Extension installed:', details.reason);
});

// Non-callback API usage
function updateBadge() {
    chrome.browserAction.setBadgeBackgroundColor({ color: '#FF0000' });
    chrome.browserAction.setBadgeText({ text: 'NEW' });
}

// Set up context menu (no callback version)
chrome.contextMenus.create({
    id: 'test-menu',
    title: 'Test Menu Item',
    contexts: ['page'],
});

updateBadge();
