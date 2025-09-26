// Popup Test Extension - Content script
console.log('🌐 Content script loaded for Popup Test Extension');

// Content script state
const contentState = {
    isInjected: true,
    startTime: Date.now(),
    interactions: 0,
    elementsModified: 0
};

// Initialize content script
function initializeContentScript() {
    console.log('🚀 Initializing content script...');

    // Add test data attributes to the page
    document.documentElement.setAttribute('data-popup-test-extension', 'true');
    document.documentElement.setAttribute('data-injection-time', contentState.startTime.toString());

    // Create floating indicator
    createFloatingIndicator();

    // Set up page observers
    setupPageObservers();

    // Listen for messages from background/popup
    setupMessageListeners();

    // Notify background of successful injection
    chrome.runtime.sendMessage({
        action: 'updateActivity',
        source: 'content-script',
        url: window.location.href
    });

    console.log('✅ Content script initialization complete');
}

function createFloatingIndicator() {
    // Check if indicator already exists
    if (document.getElementById('popup-test-indicator')) {
        return;
    }

    const indicator = document.createElement('div');
    indicator.id = 'popup-test-indicator';
    indicator.innerHTML = `
        <div id="indicator-content">
            <div>🔧 Test Extension</div>
            <div id="indicator-status">Active</div>
        </div>
    `;

    indicator.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        background: rgba(102, 126, 234, 0.9);
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        z-index: 9999;
        font-family: sans-serif;
        font-size: 12px;
        font-weight: 500;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        backdrop-filter: blur(10px);
        cursor: pointer;
        transition: all 0.3s ease;
        user-select: none;
    `;

    // Add hover effects
    indicator.addEventListener('mouseenter', () => {
        indicator.style.transform = 'scale(1.05)';
        indicator.style.background = 'rgba(102, 126, 234, 1)';
    });

    indicator.addEventListener('mouseleave', () => {
        indicator.style.transform = 'scale(1)';
        indicator.style.background = 'rgba(102, 126, 234, 0.9)';
    });

    // Click to show extension info
    indicator.addEventListener('click', () => {
        showExtensionInfo();
        contentState.interactions++;
    });

    document.body.appendChild(indicator);
    contentState.elementsModified++;

    console.log('🏷️ Floating indicator created');
}

function showExtensionInfo() {
    // Remove existing info if present
    const existingInfo = document.getElementById('extension-info-modal');
    if (existingInfo) {
        existingInfo.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'extension-info-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 10001;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const infoBox = document.createElement('div');
    infoBox.style.cssText = `
        background: white;
        padding: 25px;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        max-width: 400px;
        text-align: center;
    `;

    infoBox.innerHTML = `
        <h3 style="margin: 0 0 15px 0; color: #333;">🔧 Popup Test Extension</h3>
        <div style="text-align: left; margin: 15px 0;">
            <p><strong>Status:</strong> Active</p>
            <p><strong>Injected:</strong> ${new Date(contentState.startTime).toLocaleTimeString()}</p>
            <p><strong>Page URL:</strong> ${window.location.hostname}</p>
            <p><strong>Interactions:</strong> ${contentState.interactions}</p>
            <p><strong>Elements Modified:</strong> ${contentState.elementsModified}</p>
        </div>
        <button id="close-info" style="
            background: #667eea;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin: 5px;
        ">Close</button>
        <button id="test-highlight" style="
            background: #4ecdc4;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin: 5px;
        ">Test Highlight</button>
    `;

    modal.appendChild(infoBox);
    document.body.appendChild(modal);

    // Close button
    infoBox.querySelector('#close-info').addEventListener('click', () => {
        modal.remove();
    });

    // Test highlight button
    infoBox.querySelector('#test-highlight').addEventListener('click', () => {
        performTestHighlight();
        modal.remove();
    });

    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });

    contentState.elementsModified++;
}

function performTestHighlight() {
    console.log('🎨 Performing test highlight');

    const elements = document.querySelectorAll('h1, h2, h3, button, a');
    let highlightCount = 0;

    elements.forEach((element, index) => {
        if (index < 20) { // Limit to first 20 elements
            element.style.outline = '2px solid #ff6b6b';
            element.style.outlineOffset = '2px';
            highlightCount++;
        }
    });

    // Remove highlights after 3 seconds
    setTimeout(() => {
        elements.forEach((element, index) => {
            if (index < 20) {
                element.style.outline = '';
                element.style.outlineOffset = '';
            }
        });
    }, 3000);

    // Update indicator
    updateIndicatorStatus(`Highlighted ${highlightCount} elements`);

    contentState.elementsModified += highlightCount;
}

function updateIndicatorStatus(message) {
    const statusElement = document.getElementById('indicator-status');
    if (statusElement) {
        statusElement.textContent = message;

        // Reset to "Active" after 2 seconds
        setTimeout(() => {
            statusElement.textContent = 'Active';
        }, 2000);
    }
}

function setupPageObservers() {
    // Observe DOM changes
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Filter out our own modifications
                const externalChanges = Array.from(mutation.addedNodes).filter(node => {
                    return node.nodeType === Node.ELEMENT_NODE &&
                           !node.id?.startsWith('popup-test') &&
                           !node.id?.startsWith('extension-info') &&
                           !node.id?.startsWith('indicator');
                });

                if (externalChanges.length > 0) {
                    console.log('🔄 DOM changes detected:', externalChanges.length, 'new elements');
                }
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Observe scroll events
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            updateIndicatorStatus(`Scrolled to ${Math.round(window.scrollY)}px`);
        }, 100);
    });

    console.log('👁️ Page observers set up');
}

function setupMessageListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('📨 Content script received message:', request);

        switch (request.action) {
            case 'getContentState':
                sendResponse({
                    success: true,
                    state: {
                        ...contentState,
                        url: window.location.href,
                        title: document.title
                    }
                });
                break;

            case 'performContentTest':
                performContentTest(request.testType, sendResponse);
                return true; // Keep message channel open
                break;

            case 'highlightElements':
                performTestHighlight();
                sendResponse({ success: true, action: 'highlight_complete' });
                break;

            case 'updateIndicator':
                updateIndicatorStatus(request.message || 'Updated');
                sendResponse({ success: true });
                break;

            default:
                console.log('❓ Unknown content script action:', request.action);
                sendResponse({ success: false, error: 'Unknown action' });
        }
    });

    console.log('📡 Message listeners set up');
}

function performContentTest(testType, sendResponse) {
    console.log('🧪 Performing content test:', testType);

    switch (testType) {
        case 'element-count':
            const elementCount = document.querySelectorAll('*').length;
            sendResponse({
                success: true,
                result: { elementCount, testType }
            });
            break;

        case 'page-info':
            sendResponse({
                success: true,
                result: {
                    url: window.location.href,
                    title: document.title,
                    elementCount: document.querySelectorAll('*').length,
                    links: document.querySelectorAll('a').length,
                    images: document.querySelectorAll('img').length,
                    testType
                }
            });
            break;

        case 'inject-test-element':
            const testElement = document.createElement('div');
            testElement.id = 'content-test-element';
            testElement.textContent = '✅ Content Test Element';
            testElement.style.cssText = `
                position: fixed;
                bottom: 10px;
                right: 10px;
                background: #48bb78;
                color: white;
                padding: 8px 12px;
                border-radius: 4px;
                z-index: 9998;
                font-family: sans-serif;
                font-size: 12px;
            `;

            document.body.appendChild(testElement);
            contentState.elementsModified++;

            // Remove after 5 seconds
            setTimeout(() => {
                if (testElement.parentNode) {
                    testElement.parentNode.removeChild(testElement);
                }
            }, 5000);

            sendResponse({
                success: true,
                result: { elementId: 'content-test-element', testType }
            });
            break;

        default:
            sendResponse({
                success: false,
                error: 'Unknown test type',
                testType
            });
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
    initializeContentScript();
}

// Export for testing
window.contentTestExtension = {
    state: () => contentState,
    updateStatus: updateIndicatorStatus,
    performTest: performContentTest,
    highlightElements: performTestHighlight
};

console.log('✅ Content script setup complete');