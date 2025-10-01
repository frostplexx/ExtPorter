// Popup Test Extension - Background script
console.log('🚀 Background script loaded for Popup Test Extension');

// Extension state
const extensionState = {
    isActive: true,
    tabStates: new Map(),
    injectionCount: 0,
    lastActivity: Date.now(),
};

// Initialize extension
chrome.runtime.onInstalled.addListener((details) => {
    console.log('📦 Extension installed:', details);

    // Set default settings
    chrome.storage.sync.set({
        counter: 0,
        settings: {
            autoInject: false,
            debugMode: false,
            notifications: true,
        },
    });

    // Create context menu for testing
    chrome.contextMenus.create({
        id: 'popup-test-inject',
        title: 'Inject Test Content',
        contexts: ['page'],
    });

    console.log('✅ Extension initialization complete');
});

// Handle browser action clicks (for testing without popup)
chrome.browserAction.onClicked.addListener((tab) => {
    console.log('🔘 Browser action clicked for tab:', tab.id);

    // Inject test content when icon is clicked
    chrome.tabs.executeScript(
        tab.id,
        {
            code: `
            console.log('🎯 Background script injection test');

            const testElement = document.createElement('div');
            testElement.textContent = '🔧 Background Script Test - ' + new Date().toLocaleTimeString();
            testElement.style.cssText = \`
                position: fixed;
                top: 50px;
                right: 20px;
                background: #667eea;
                color: white;
                padding: 10px 15px;
                border-radius: 6px;
                z-index: 10000;
                font-family: sans-serif;
                font-size: 14px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            \`;
            document.body.appendChild(testElement);

            setTimeout(() => {
                if (testElement.parentNode) {
                    testElement.parentNode.removeChild(testElement);
                }
            }, 3000);

            'BACKGROUND_INJECTION_SUCCESS';
        `,
        },
        (result) => {
            if (chrome.runtime.lastError) {
                console.error('❌ Background injection failed:', chrome.runtime.lastError);
            } else {
                console.log('✅ Background injection successful:', result);
                extensionState.injectionCount++;
            }
        }
    );
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    console.log('📋 Context menu clicked:', info.menuItemId);

    if (info.menuItemId === 'popup-test-inject' && tab) {
        // Inject content via context menu
        chrome.tabs.executeScript(tab.id, {
            code: `
                console.log('📋 Context menu injection test');

                const contextElement = document.createElement('div');
                contextElement.textContent = '📋 Context Menu Test - ' + new Date().toLocaleTimeString();
                contextElement.style.cssText = \`
                    position: fixed;
                    bottom: 20px;
                    left: 20px;
                    background: #4ecdc4;
                    color: white;
                    padding: 10px 15px;
                    border-radius: 6px;
                    z-index: 10000;
                    font-family: sans-serif;
                    font-size: 14px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                \`;
                document.body.appendChild(contextElement);

                setTimeout(() => {
                    if (contextElement.parentNode) {
                        contextElement.parentNode.removeChild(contextElement);
                    }
                }, 4000);

                'CONTEXT_INJECTION_SUCCESS';
            `,
        });
    }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📨 Message received:', request, 'from:', sender);

    switch (request.action) {
        case 'getExtensionState':
            sendResponse({
                success: true,
                state: {
                    isActive: extensionState.isActive,
                    injectionCount: extensionState.injectionCount,
                    lastActivity: extensionState.lastActivity,
                    tabCount: extensionState.tabStates.size,
                },
            });
            break;

        case 'updateActivity':
            extensionState.lastActivity = Date.now();
            sendResponse({ success: true });
            break;

        case 'testBackgroundResponse':
            console.log('🧪 Test message from:', sender.tab ? `tab ${sender.tab.id}` : 'popup');
            sendResponse({
                success: true,
                message: 'Background script responding',
                timestamp: Date.now(),
            });
            break;

        case 'performTabAction':
            if (sender.tab) {
                handleTabAction(request.tabAction, sender.tab, sendResponse);
                return true; // Keep message channel open for async response
            }
            break;

        default:
            console.log('❓ Unknown message action:', request.action);
            sendResponse({ success: false, error: 'Unknown action' });
    }
});

// Handle tab actions
function handleTabAction(action, tab, sendResponse) {
    console.log('🔄 Performing tab action:', action, 'on tab:', tab.id);

    switch (action) {
        case 'highlight':
            chrome.tabs.executeScript(
                tab.id,
                {
                    code: `
                    document.querySelectorAll('*').forEach((el, index) => {
                        if (index < 10) { // Limit to first 10 elements
                            el.style.outline = '2px solid #ff6b6b';
                        }
                    });
                    'HIGHLIGHT_COMPLETE';
                `,
                },
                (result) => {
                    sendResponse({ success: true, result });
                }
            );
            break;

        case 'scroll':
            chrome.tabs.executeScript(
                tab.id,
                {
                    code: `
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    'SCROLL_COMPLETE';
                `,
                },
                (result) => {
                    sendResponse({ success: true, result });
                }
            );
            break;

        default:
            sendResponse({ success: false, error: 'Unknown tab action' });
    }
}

// Track tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        console.log('📄 Tab updated:', tabId, tab.url);

        // Update tab state
        extensionState.tabStates.set(tabId, {
            url: tab.url,
            lastUpdate: Date.now(),
        });

        // Auto-inject if enabled
        chrome.storage.sync.get(['settings'], (result) => {
            if (result.settings && result.settings.autoInject) {
                console.log('🔄 Auto-injecting content script');

                chrome.tabs.executeScript(tabId, {
                    code: `
                        console.log('🔄 Auto-injected content script');

                        const autoElement = document.createElement('div');
                        autoElement.textContent = '🔄 Auto-Injected - ' + new Date().toLocaleTimeString();
                        autoElement.style.cssText = \`
                            position: fixed;
                            top: 80px;
                            right: 20px;
                            background: #96ceb4;
                            color: white;
                            padding: 8px 12px;
                            border-radius: 4px;
                            z-index: 10000;
                            font-family: sans-serif;
                            font-size: 12px;
                            opacity: 0.8;
                        \`;
                        document.body.appendChild(autoElement);

                        setTimeout(() => {
                            if (autoElement.parentNode) {
                                autoElement.parentNode.removeChild(autoElement);
                            }
                        }, 2000);

                        'AUTO_INJECTION_SUCCESS';
                    `,
                });
            }
        });
    }
});

// Clean up closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
    console.log('🗑️ Tab removed:', tabId);
    extensionState.tabStates.delete(tabId);
});

// Periodic state update
setInterval(() => {
    extensionState.lastActivity = Date.now();

    // Clean up old tab states (older than 1 hour)
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [tabId, state] of extensionState.tabStates.entries()) {
        if (state.lastUpdate < cutoff) {
            extensionState.tabStates.delete(tabId);
        }
    }
}, 30000); // Every 30 seconds

// Export for testing
if (typeof globalThis !== 'undefined') {
    globalThis.backgroundTestExtension = {
        state: () => extensionState,
        getTabStates: () => Array.from(extensionState.tabStates.entries()),
        performTest: (testName) => {
            console.log('🧪 Running background test:', testName);
            return { testName, timestamp: Date.now(), success: true };
        },
    };
}

console.log('✅ Background script setup complete');
