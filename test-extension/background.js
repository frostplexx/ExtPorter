console.log('[Background] Message Passing Test Extension loaded');

// Store active ports for testing
const activePorts = new Map();

// ============================================================================
// ONE-TIME MESSAGE HANDLING
// ============================================================================

/**
 * Listen for one-time messages from content scripts and popup
 * Tests: sendResponse callback, async responses, chrome.runtime.lastError
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message:', message, 'from:', sender.tab ? 'content script' : 'popup');

    switch (message.type) {
        case 'PING':
            // Synchronous response
            sendResponse({ success: true, reply: 'PONG from background', timestamp: Date.now() });
            return false; // No async response needed

        case 'GET_DATA':
            // Simulate async operation (e.g., API call)
            setTimeout(() => {
                sendResponse({
                    success: true,
                    data: { count: 42, items: ['alpha', 'beta', 'gamma'] },
                    timestamp: Date.now()
                });
            }, 500);
            return true; // Keep channel open for async response

        case 'ECHO':
            // Echo back the payload
            sendResponse({ success: true, echo: message.payload });
            return false;

        case 'ERROR_TEST':
            // Test error handling
            sendResponse({ success: false, error: 'Simulated error for testing' });
            return false;

        case 'QUERY_TAB':
            // Test tabs.sendMessage with callback
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (chrome.runtime.lastError) {
                    console.error('[Background] Error querying tabs:', chrome.runtime.lastError);
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }

                if (tabs.length === 0) {
                    sendResponse({ success: false, error: 'No active tab found' });
                    return;
                }

                // Send message to content script
                chrome.tabs.sendMessage(tabs[0].id, { type: 'PING_FROM_BACKGROUND' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] Error sending to tab:', chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    sendResponse({ success: true, contentResponse: response });
                });
            });
            return true; // Keep channel open for async response

        default:
            sendResponse({ success: false, error: 'Unknown message type' });
            return false;
    }
});

// ============================================================================
// LONG-LIVED CONNECTIONS (PORTS)
// ============================================================================

/**
 * Handle long-lived connections from content scripts and popup
 * Tests: port.postMessage, port.onMessage, port.disconnect
 */
chrome.runtime.onConnect.addListener((port) => {
    console.log('[Background] New connection established:', port.name);

    // Store the port
    activePorts.set(port.name, port);

    // Listen for messages on this port
    port.onMessage.addListener((message) => {
        console.log('[Background] Port message received on', port.name, ':', message);

        switch (message.type) {
            case 'STREAM_DATA':
                // Simulate streaming data back
                let count = 0;
                const interval = setInterval(() => {
                    if (count >= 5) {
                        clearInterval(interval);
                        port.postMessage({ type: 'STREAM_END', totalSent: count });
                        return;
                    }
                    port.postMessage({
                        type: 'STREAM_CHUNK',
                        chunk: count++,
                        data: `Data chunk ${count}`,
                        timestamp: Date.now()
                    });
                }, 200);
                break;

            case 'PORT_PING':
                // Echo back with additional info
                port.postMessage({
                    type: 'PORT_PONG',
                    originalMessage: message,
                    timestamp: Date.now()
                });
                break;

            case 'BROADCAST_REQUEST':
                // Broadcast to all other ports
                activePorts.forEach((otherPort, name) => {
                    if (name !== port.name) {
                        otherPort.postMessage({
                            type: 'BROADCAST',
                            from: port.name,
                            message: message.payload
                        });
                    }
                });
                port.postMessage({ type: 'BROADCAST_SENT', count: activePorts.size - 1 });
                break;

            default:
                port.postMessage({ type: 'ERROR', error: 'Unknown port message type' });
        }
    });

    // Handle port disconnect
    port.onDisconnect.addListener(() => {
        console.log('[Background] Port disconnected:', port.name);
        activePorts.delete(port.name);

        if (chrome.runtime.lastError) {
            console.error('[Background] Disconnect error:', chrome.runtime.lastError);
        }
    });

    // Send welcome message
    port.postMessage({
        type: 'CONNECTED',
        portName: port.name,
        timestamp: Date.now()
    });
});

// ============================================================================
// TABS API WITH CALLBACKS
// ============================================================================

/**
 * Test sending messages to tabs with callbacks
 */
function sendMessageToActiveTab(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
            console.error('[Background] Query error:', chrome.runtime.lastError);
            callback({ success: false, error: chrome.runtime.lastError.message });
            return;
        }

        if (tabs.length === 0) {
            callback({ success: false, error: 'No active tab' });
            return;
        }

        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[Background] Send error:', chrome.runtime.lastError);
                callback({ success: false, error: chrome.runtime.lastError.message });
                return;
            }
            callback({ success: true, response });
        });
    });
}

// ============================================================================
// STARTUP
// ============================================================================

console.log('[Background] All message handlers registered');
console.log('[Background] Supported message types:', [
    'PING', 'GET_DATA', 'ECHO', 'ERROR_TEST', 'QUERY_TAB'
]);
console.log('[Background] Supported port message types:', [
    'STREAM_DATA', 'PORT_PING', 'BROADCAST_REQUEST'
]);
