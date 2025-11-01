// Background script with context menu onclick (MV2 style)

console.log('Background script loaded');

// Create context menu with onclick - should be migrated
chrome.contextMenus.create({
    title: 'Save Link',
    type: 'normal',
    contexts: ['link', 'page'],
    onclick: function(info, _tab) {
        console.log('Save Link clicked', info.linkUrl);
        saveLink(info);
    }
});

// Create another context menu with onclick and explicit id
chrome.contextMenus.create({
    id: 'copy-text',
    title: 'Copy Text',
    contexts: ['selection'],
    onclick: handleCopyText
});

// Create context menu without onclick - should not be modified
chrome.contextMenus.create({
    id: 'simple-menu',
    title: 'Simple Menu',
    contexts: ['page']
});

// Handler functions
function saveLink(info) {
    console.log('Saving link:', info.linkUrl);
    chrome.storage.local.set({
        savedLink: info.linkUrl,
        timestamp: Date.now()
    });
}

function handleCopyText(info, tab) {
    console.log('Copying text from tab:', tab.id);
    const selectedText = info.selectionText;
    
    // Copy to clipboard logic here
    console.log('Selected text:', selectedText);
}

// Other background logic
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed');
});
