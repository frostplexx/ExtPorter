console.log('[Content] Message Passing Test Extension content script loaded');

// ============================================================================
// ONE-TIME MESSAGE HANDLING
// ============================================================================

/**
 * Listen for messages from background and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Content] Received message:', message, 'from:', sender.tab ? 'another tab' : 'extension');

    switch (message.type) {
        case 'PING_FROM_BACKGROUND':
            sendResponse({ success: true, reply: 'PONG from content script', url: window.location.href });
            return false;

        case 'GET_PAGE_INFO':
            sendResponse({
                success: true,
                info: {
                    title: document.title,
                    url: window.location.href,
                    timestamp: Date.now()
                }
            });
            return false;

        case 'PING_FROM_POPUP':
            sendResponse({ success: true, reply: 'Content script received popup message' });
            return false;

        default:
            sendResponse({ success: false, error: 'Unknown message type in content script' });
            return false;
    }
});

// ============================================================================
// SEND MESSAGES TO BACKGROUND (TEST ON PAGE LOAD)
// ============================================================================

/**
 * Test sending message to background on page load
 */
function testSendToBackground() {
    console.log('[Content] Testing sendMessage to background...');

    // Test 1: Simple PING
    chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('[Content] PING error:', chrome.runtime.lastError);
            return;
        }
        console.log('[Content] PING response:', response);
    });

    // Test 2: ECHO with payload
    chrome.runtime.sendMessage({
        type: 'ECHO',
        payload: { message: 'Hello from content script', page: window.location.href }
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('[Content] ECHO error:', chrome.runtime.lastError);
            return;
        }
        console.log('[Content] ECHO response:', response);
    });
}

// Run tests after a short delay to ensure background is ready
setTimeout(testSendToBackground, 1000);

// ============================================================================
// LONG-LIVED CONNECTIONS (PORTS)
// ============================================================================

let contentPort = null;

/**
 * Establish a long-lived connection to background
 */
function connectToBackground() {
    console.log('[Content] Establishing port connection to background...');

    contentPort = chrome.runtime.connect({ name: 'content-port-' + Math.random().toString(36).substr(2, 9) });

    // Listen for messages on the port
    contentPort.onMessage.addListener((message) => {
        console.log('[Content] Port message received:', message);

        switch (message.type) {
            case 'CONNECTED':
                console.log('[Content] Port connection confirmed:', message.portName);
                // Test port messaging
                testPortMessaging();
                break;

            case 'PORT_PONG':
                console.log('[Content] PORT_PONG received:', message);
                break;

            case 'STREAM_CHUNK':
                console.log('[Content] Stream chunk received:', message.chunk, message.data);
                break;

            case 'STREAM_END':
                console.log('[Content] Stream ended, total chunks:', message.totalSent);
                break;

            case 'BROADCAST':
                console.log('[Content] Broadcast from', message.from, ':', message.message);
                break;

            default:
                console.log('[Content] Unknown port message:', message);
        }
    });

    // Handle disconnection
    contentPort.onDisconnect.addListener(() => {
        console.log('[Content] Port disconnected');
        if (chrome.runtime.lastError) {
            console.error('[Content] Disconnect error:', chrome.runtime.lastError);
        }
        contentPort = null;
    });

    return contentPort;
}

/**
 * Test various port messaging patterns
 */
function testPortMessaging() {
    if (!contentPort) {
        console.error('[Content] No active port connection');
        return;
    }

    // Test 1: Simple PORT_PING
    console.log('[Content] Sending PORT_PING...');
    contentPort.postMessage({ type: 'PORT_PING', timestamp: Date.now() });

    // Test 2: Request streaming data
    setTimeout(() => {
        console.log('[Content] Requesting streaming data...');
        contentPort.postMessage({ type: 'STREAM_DATA' });
    }, 1000);
}

// Establish port connection after a delay
setTimeout(() => {
    connectToBackground();
}, 1500);

// ============================================================================
// PAGE INTERACTION
// ============================================================================

/**
 * Add visual indicator that content script is loaded
 */
function addVisualIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'message-test-indicator';
    indicator.style.cssText = `
        position: fixed;
        bottom: 10px;
        right: 10px;
        background: #4CAF50;
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 12px;
        z-index: 999999;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    `;
    indicator.textContent = 'Message Test Extension Active';
    document.body.appendChild(indicator);

    // Remove after 3 seconds
    setTimeout(() => {
        indicator.remove();
    }, 3000);
}

// Add indicator when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addVisualIndicator);
} else {
    addVisualIndicator();
}

// ============================================================================
// EXPORT FOR TESTING
// ============================================================================

// Expose functions to window for manual testing from console
window.testMessagePassing = {
    sendPing: () => {
        chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
            console.log('PING response:', response);
        });
    },
    sendEcho: (payload) => {
        chrome.runtime.sendMessage({ type: 'ECHO', payload }, (response) => {
            console.log('ECHO response:', response);
        });
    },
    getData: () => {
        chrome.runtime.sendMessage({ type: 'GET_DATA' }, (response) => {
            console.log('GET_DATA response:', response);
        });
    },
    connectPort: () => {
        return connectToBackground();
    },
    disconnectPort: () => {
        if (contentPort) {
            contentPort.disconnect();
        }
    }
};

console.log('[Content] Test functions available: window.testMessagePassing');
