/* global chrome, module */
(function () {
    'use strict';

    // Skip if bridge is already loaded to prevent double-wrapping
    if (window._chromeExtBridgeLoaded) {
        return;
    }
    window._chromeExtBridgeLoaded = true;

    // Store original chrome object
    const originalChrome = window.chrome;

    // Skip if chrome is not available (shouldn't happen in extensions)
    if (!originalChrome || typeof originalChrome !== 'object') {
        return;
    }

    // Generic method wrapper that handles both callbacks and promises
    function createCallbackCompatibleMethod(originalMethod, originalContext) {
        return function (...args) {
            const lastArg = args[args.length - 1];

            if (typeof lastArg === 'function') {
                const callback = args.pop();

                // Helper to set chrome.runtime.lastError and call callback
                const callbackWithError = (error, result) => {
                    if (!chrome.runtime) chrome.runtime = {};

                    if (error) {
                        chrome.runtime.lastError = {
                            message: error.message || 'Unknown error',
                        };
                        callback(undefined);
                    } else {
                        delete chrome.runtime.lastError;
                        callback(result);
                    }

                    // Clean up lastError asynchronously
                    if (error) {
                        setTimeout(() => delete chrome.runtime.lastError, 0);
                    }
                };

                try {
                    let callbackCalled = false;

                    // Wrap the callback to handle lastError and prevent double calls
                    const wrappedCallback = function(result) {
                        if (!callbackCalled) {
                            callbackCalled = true;
                            callbackWithError(undefined, result);
                        }
                    };

                    // Replace the callback with our wrapped version
                    args.push(wrappedCallback);

                    // Use the original context to preserve 'this' binding
                    const result = originalMethod.apply(originalContext, args);

                    // If the method returns a promise (MV3 style), bridge it
                    if (result && typeof result.then === 'function') {
                        result
                            .then((data) => {
                                if (!callbackCalled) {
                                    callbackCalled = true;
                                    callbackWithError(null, data);
                                }
                            })
                            .catch((error) => {
                                if (!callbackCalled) {
                                    callbackCalled = true;
                                    callbackWithError(error);
                                }
                            });
                    }
                    // Otherwise, the original method will call our wrapped callback
                } catch (error) {
                    callbackWithError(error);
                }
            } else {
                // No callback: pass through unchanged (return for promise chain)
                return originalMethod.apply(originalContext, args);
            }
        };
    }

    // Recursively wrap chrome API object
    function wrapChromeAPI(obj, originalObj) {
        if (!obj || typeof obj !== 'object') return obj;

        // Use originalObj if provided, otherwise use obj
        const contextObj = originalObj || obj;
        const wrapped = {};

        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'function') {
                // Blacklist of methods that should not be wrapped
                // These methods either:
                // 1. Work with user-provided functions (event listeners)
                // 2. Have complex dual callback/promise behavior in MV3 (messaging)
                // 3. Are passed as parameters to user functions (sendResponse)
                const blacklist = [
                    // Event listeners - must work directly with user functions
                    'addListener', 'removeListener', 'hasListener', 'hasListeners',
                    // Messaging APIs - have special MV3 behavior where they accept callbacks
                    // AND return promises simultaneously
                    'sendMessage', 'sendNativeMessage',
                    // Connection APIs - similar dual callback/promise behavior
                    'connect', 'connectNative',
                    // Port APIs - work with port objects that have their own lifecycle
                    'postMessage', 'disconnect',
                    // Response function - passed as parameter to message listeners
                    'sendResponse'
                ];

                if (blacklist.includes(key)) {
                    wrapped[key] = value.bind(contextObj);
                } else {
                    // Wrap methods that need callback-to-promise compatibility
                    wrapped[key] = createCallbackCompatibleMethod(value, contextObj);
                }
            } else if (typeof value === 'object' && value !== null && key !== 'runtime') {
                // Recursively wrap nested objects (skip runtime to avoid infinite recursion)
                wrapped[key] = wrapChromeAPI(value, value);
            } else {
                // Copy primitives and other values as-is
                wrapped[key] = value;
            }
        }

        return wrapped;
    }

    // Create wrapped chrome object, passing originalChrome as the context
    const wrappedChrome = wrapChromeAPI(originalChrome, originalChrome);

    // Ensure runtime object exists for lastError handling
    if (!wrappedChrome.runtime) {
        wrappedChrome.runtime = {};
    }

    // Replace chrome object with wrapped version
    window.chrome = wrappedChrome;

    // Legacy callbackify function for backward compatibility
    function callbackify(fn) {
        return (...args) => {
            // assume the last arg is the callback
            const cb = args.pop();

            fn(...args)
                .then((result) => cb(null, result))
                .catch((err) => cb(err));
        };
    }

    // Export for testing if in test environment
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            createCallbackCompatibleMethod,
            wrapChromeAPI,
            callbackify,
        };
    }
})();
