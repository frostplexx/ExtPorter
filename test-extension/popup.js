// ============================================================================
// POPUP SCRIPT FOR MESSAGE PASSING TESTS
// ============================================================================

const logElement = document.getElementById('log');
const portStatusElement = document.getElementById('portStatus');
let popupPort = null;

// ============================================================================
// LOGGING
// ============================================================================

function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;

    const time = document.createElement('span');
    time.className = 'log-timestamp';
    time.textContent = `[${timestamp}] `;

    const content = document.createElement('span');
    content.textContent = message;

    entry.appendChild(time);
    entry.appendChild(content);
    logElement.appendChild(entry);
    logElement.scrollTop = logElement.scrollHeight;
}

function logSuccess(message) {
    log('✓ ' + message, 'success');
}

function logError(message) {
    log('✗ ' + message, 'error');
}

function logInfo(message) {
    log('ℹ ' + message, 'info');
}

// ============================================================================
// ONE-TIME MESSAGES
// ============================================================================

// PING Background
document.getElementById('btnPing').addEventListener('click', () => {
    logInfo('Sending PING to background...');
    chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) {
            logError('PING failed: ' + chrome.runtime.lastError.message);
            return;
        }
        logSuccess('PING response: ' + JSON.stringify(response));
    });
});

// Get Data (Async)
document.getElementById('btnGetData').addEventListener('click', () => {
    logInfo('Requesting data (async response)...');
    chrome.runtime.sendMessage({ type: 'GET_DATA' }, (response) => {
        if (chrome.runtime.lastError) {
            logError('GET_DATA failed: ' + chrome.runtime.lastError.message);
            return;
        }
        logSuccess('GET_DATA response: ' + JSON.stringify(response.data));
    });
});

// Echo Message
document.getElementById('btnEcho').addEventListener('click', () => {
    const payload = { message: 'Hello from popup', timestamp: Date.now() };
    logInfo('Sending ECHO with payload...');
    chrome.runtime.sendMessage({ type: 'ECHO', payload }, (response) => {
        if (chrome.runtime.lastError) {
            logError('ECHO failed: ' + chrome.runtime.lastError.message);
            return;
        }
        logSuccess('ECHO response: ' + JSON.stringify(response.echo));
    });
});

// Test Error
document.getElementById('btnError').addEventListener('click', () => {
    logInfo('Testing error handling...');
    chrome.runtime.sendMessage({ type: 'ERROR_TEST' }, (response) => {
        if (chrome.runtime.lastError) {
            logError('Unexpected lastError: ' + chrome.runtime.lastError.message);
            return;
        }
        if (response.success) {
            logError('Expected error but got success!');
        } else {
            logSuccess('Error handled correctly: ' + response.error);
        }
    });
});

// PING Content Script
document.getElementById('btnPingContent').addEventListener('click', () => {
    logInfo('Sending PING to content script...');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
            logError('Query tabs failed: ' + chrome.runtime.lastError.message);
            return;
        }

        if (tabs.length === 0) {
            logError('No active tab found');
            return;
        }

        chrome.tabs.sendMessage(tabs[0].id, { type: 'PING_FROM_POPUP' }, (response) => {
            if (chrome.runtime.lastError) {
                logError('Content PING failed: ' + chrome.runtime.lastError.message);
                return;
            }
            logSuccess('Content script response: ' + JSON.stringify(response));
        });
    });
});

// Query Tab via Background
document.getElementById('btnQueryTab').addEventListener('click', () => {
    logInfo('Requesting background to query tab...');
    chrome.runtime.sendMessage({ type: 'QUERY_TAB' }, (response) => {
        if (chrome.runtime.lastError) {
            logError('QUERY_TAB failed: ' + chrome.runtime.lastError.message);
            return;
        }
        if (response.success) {
            logSuccess('QUERY_TAB response: ' + JSON.stringify(response.contentResponse));
        } else {
            logError('QUERY_TAB error: ' + response.error);
        }
    });
});

// ============================================================================
// LONG-LIVED CONNECTIONS (PORTS)
// ============================================================================

function updatePortStatus(connected) {
    if (connected) {
        portStatusElement.textContent = 'Port: Connected';
        portStatusElement.className = 'status connected';
    } else {
        portStatusElement.textContent = 'Port: Disconnected';
        portStatusElement.className = 'status disconnected';
    }
}

// Connect Port
document.getElementById('btnConnect').addEventListener('click', () => {
    if (popupPort) {
        logInfo('Port already connected');
        return;
    }

    logInfo('Connecting port to background...');
    popupPort = chrome.runtime.connect({ name: 'popup-port-' + Math.random().toString(36).substr(2, 9) });

    // Listen for messages
    popupPort.onMessage.addListener((message) => {
        logInfo('Port message received: ' + JSON.stringify(message));

        switch (message.type) {
            case 'CONNECTED':
                logSuccess('Port connected: ' + message.portName);
                updatePortStatus(true);
                break;
            case 'PORT_PONG':
                logSuccess('PORT_PONG received');
                break;
            case 'STREAM_CHUNK':
                logInfo(`Stream chunk ${message.chunk}: ${message.data}`);
                break;
            case 'STREAM_END':
                logSuccess('Stream complete, received ' + message.totalSent + ' chunks');
                break;
            case 'BROADCAST_SENT':
                logSuccess('Broadcast sent to ' + message.count + ' ports');
                break;
            default:
                logInfo('Port message: ' + message.type);
        }
    });

    // Handle disconnect
    popupPort.onDisconnect.addListener(() => {
        logInfo('Port disconnected');
        updatePortStatus(false);
        popupPort = null;

        if (chrome.runtime.lastError) {
            logError('Disconnect error: ' + chrome.runtime.lastError.message);
        }
    });
});

// Disconnect Port
document.getElementById('btnDisconnect').addEventListener('click', () => {
    if (!popupPort) {
        logError('No port to disconnect');
        return;
    }

    logInfo('Disconnecting port...');
    popupPort.disconnect();
    popupPort = null;
    updatePortStatus(false);
});

// Port PING
document.getElementById('btnPortPing').addEventListener('click', () => {
    if (!popupPort) {
        logError('Port not connected. Click "Connect Port" first.');
        return;
    }

    logInfo('Sending PORT_PING...');
    popupPort.postMessage({ type: 'PORT_PING', timestamp: Date.now() });
});

// Stream Data
document.getElementById('btnStream').addEventListener('click', () => {
    if (!popupPort) {
        logError('Port not connected. Click "Connect Port" first.');
        return;
    }

    logInfo('Requesting streaming data...');
    popupPort.postMessage({ type: 'STREAM_DATA' });
});

// Broadcast
document.getElementById('btnBroadcast').addEventListener('click', () => {
    if (!popupPort) {
        logError('Port not connected. Click "Connect Port" first.');
        return;
    }

    logInfo('Broadcasting message to all ports...');
    popupPort.postMessage({
        type: 'BROADCAST_REQUEST',
        payload: 'Hello from popup at ' + new Date().toLocaleTimeString()
    });
});

// ============================================================================
// UTILITY
// ============================================================================

// Clear Log
document.getElementById('btnClear').addEventListener('click', () => {
    logElement.innerHTML = '';
    logSuccess('Log cleared');
});

// ============================================================================
// INITIALIZATION
// ============================================================================

logSuccess('Popup loaded - ready to test message passing APIs');
logInfo('Try the buttons above to test different messaging patterns');
