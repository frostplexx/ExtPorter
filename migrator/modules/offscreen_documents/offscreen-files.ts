import { AbstractFile, createNewFile } from '../../types/abstract_file';
import { ExtFileType } from '../../types/ext_file_types';

/**
 * Creates offscreen document files (HTML and JS) for MV3 extensions.
 * These files handle DOM operations that cannot be performed in service workers.
 */
export class OffscreenFileCreator {
    public static readonly OFFSCREEN_HTML_FILENAME = 'offscreen.html';
    public static readonly OFFSCREEN_JS_FILENAME = 'offscreen.js';

    /**
     * Creates the offscreen HTML file.
     */
    public static createOffscreenHTML(): AbstractFile {
        const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Offscreen Document</title>
</head>
<body>
    <script src="${OffscreenFileCreator.OFFSCREEN_JS_FILENAME}"></script>
</body>
</html>`;

        return createNewFile(
            OffscreenFileCreator.OFFSCREEN_HTML_FILENAME,
            htmlContent,
            ExtFileType.HTML
        );
    }

    /**
     * Creates the offscreen JavaScript file with comprehensive DOM operation handlers.
     */
    public static createOffscreenJS(): AbstractFile {
        const jsContent = `// Offscreen document script for DOM operations
// This script handles DOM operations that cannot be performed in the service worker

/**
 * Message handler for offscreen document operations
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') {
        return;
    }

    // Handle different types of DOM operations
    switch (message.type) {
        case 'DOM_OPERATION':
            handleDOMOperation(message.operation, message.data)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // Keep message channel open for async response

        case 'CANVAS_OPERATION':
            handleCanvasOperation(message.data)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'AUDIO_OPERATION':
            handleAudioOperation(message.data)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'CLIPBOARD_WRITE':
            handleClipboardWrite(message.data)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'CLIPBOARD_READ':
            handleClipboardRead()
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'LOCALSTORAGE_GET':
            handleLocalStorageGet(message.data)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'LOCALSTORAGE_SET':
            handleLocalStorageSet(message.data)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'LOCALSTORAGE_REMOVE':
            handleLocalStorageRemove(message.data)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'LOCALSTORAGE_CLEAR':
            handleLocalStorageClear()
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        default:
            sendResponse({ success: false, error: 'Unknown operation type' });
    }
});

/**
 * Handle generic DOM operations
 */
async function handleDOMOperation(operation, data) {
    switch (operation) {
        case 'createElement':
            const element = document.createElement(data.tagName);
            if (data.attributes) {
                for (const [key, value] of Object.entries(data.attributes)) {
                    element.setAttribute(key, value);
                }
            }
            if (data.innerHTML) {
                element.innerHTML = data.innerHTML;
            }
            return { elementId: element.id || 'created' };

        case 'querySelector':
            const selectedElement = document.querySelector(data.selector);
            return {
                found: !!selectedElement,
                textContent: selectedElement?.textContent,
                innerHTML: selectedElement?.innerHTML
            };

        default:
            throw new Error(\`Unknown DOM operation: \${operation}\`);
    }
}

/**
 * Handle canvas operations
 */
async function handleCanvasOperation(data) {
    const canvas = document.createElement('canvas');
    canvas.width = data.width || 300;
    canvas.height = data.height || 150;
    
    const ctx = canvas.getContext('2d');
    
    // Execute canvas operations
    if (data.operations && Array.isArray(data.operations)) {
        for (const op of data.operations) {
            if (typeof ctx[op.method] === 'function') {
                ctx[op.method](...(op.args || []));
            } else if (op.property) {
                ctx[op.property] = op.value;
            }
        }
    }
    
    // Return canvas data as URL
    return {
        dataUrl: canvas.toDataURL(data.format || 'image/png')
    };
}

/**
 * Handle audio operations
 */
async function handleAudioOperation(data) {
    if (data.action === 'play') {
        const audio = new Audio(data.src);
        await audio.play();
        return { success: true };
    } else if (data.action === 'stop') {
        // Implementation depends on how audio references are stored
        return { success: true };
    }
    throw new Error(\`Unknown audio operation: \${data.action}\`);
}

/**
 * Handle clipboard write operations
 */
async function handleClipboardWrite(data) {
    const { text } = data;
    
    // Create temporary textarea for clipboard access
    const textEl = document.createElement('textarea');
    textEl.value = text;
    document.body.appendChild(textEl);
    textEl.select();
    document.execCommand('copy');
    document.body.removeChild(textEl);

    return { success: true };
}

/**
 * Handle clipboard read operations
 */
async function handleClipboardRead() {
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        return { success: true, text };
    }

    // Fallback to older method
    const textEl = document.createElement('textarea');
    document.body.appendChild(textEl);
    textEl.select();
    document.execCommand('paste');
    const text = textEl.value;
    document.body.removeChild(textEl);

    return { success: true, text };
}

/**
 * Handle localStorage.getItem()
 */
async function handleLocalStorageGet(data) {
    const { key } = data;
    const value = localStorage.getItem(key);
    return { value };
}

/**
 * Handle localStorage.setItem()
 */
async function handleLocalStorageSet(data) {
    const { key, value } = data;
    localStorage.setItem(key, value);
    return { success: true };
}

/**
 * Handle localStorage.removeItem()
 */
async function handleLocalStorageRemove(data) {
    const { key } = data;
    localStorage.removeItem(key);
    return { success: true };
}

/**
 * Handle localStorage.clear()
 */
async function handleLocalStorageClear() {
    localStorage.clear();
    return { success: true };
}

console.log('Offscreen document loaded and ready');
`;

        return createNewFile(
            OffscreenFileCreator.OFFSCREEN_JS_FILENAME,
            jsContent,
            ExtFileType.JS
        );
    }
}
