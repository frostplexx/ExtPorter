/* global chrome, module */
/**
 * Chrome Extension Bridge - MV2 to MV3 Compatibility Layer
 *
 * This bridge enables MV2 callback-style Chrome APIs to work in MV3 by converting
 * promises to callbacks and handling chrome.runtime.lastError properly.
 */
(function () {
    'use strict';

    // Skip if bridge is already loaded to prevent double-wrapping
    if (self._chromeExtBridgeLoaded) {
        return;
    }
    self._chromeExtBridgeLoaded = true;

    // Logging configuration
    const BRIDGE_DEBUG = true; // Set to false to disable logging
    const bridgeLog = (...args) => {
        if (BRIDGE_DEBUG) {
            console.log('[ext_bridge]', ...args);
        }
    };

    bridgeLog('🌉 Chrome Extension Bridge loaded');

    // Store original chrome object
    const originalChrome = self.chrome;

    // Skip if chrome is not available (shouldn't happen in extensions)
    if (!originalChrome || typeof originalChrome !== 'object') {
        bridgeLog('⚠️ Chrome object not available, bridge disabled');
        return;
    }

    // Generic method wrapper that converts callbacks to promises
    function createCallbackCompatibleMethod(originalMethod, originalContext, methodPath) {
        return function (...args) {
            const lastArg = args[args.length - 1];

            // If user provides a callback, handle it
            if (typeof lastArg === 'function') {
                const callback = args.pop();

                bridgeLog(`🔄 Wrapping callback for ${methodPath || 'unknown method'}`);

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
                    // Call the original method without callback
                    const result = originalMethod.apply(originalContext, args);

                    // Always expect a promise and bridge it to callback
                    if (result && typeof result.then === 'function') {
                        bridgeLog(
                            `⚡ Bridging promise to callback for ${methodPath || 'unknown method'}`
                        );
                        result
                            .then((data) => {
                                bridgeLog(
                                    `✓ Promise resolved for ${methodPath || 'unknown method'}`
                                );
                                callbackWithError(null, data);
                            })
                            .catch((error) => {
                                bridgeLog(
                                    `✗ Promise rejected for ${methodPath || 'unknown method'}:`,
                                    error.message
                                );
                                callbackWithError(error);
                            });
                    } else {
                        // Shouldn't happen in MV3, but handle gracefully
                        bridgeLog(
                            `⚠️ No promise returned for ${methodPath || 'unknown method'}, calling callback with result`
                        );
                        callbackWithError(null, result);
                    }
                } catch (error) {
                    callbackWithError(error);
                }
            } else {
                // No callback: return promise directly
                bridgeLog(`→ Promise mode for ${methodPath || 'unknown method'}`);
                return originalMethod.apply(originalContext, args);
            }
        };
    }

    // Recursively wrap chrome API object
    function wrapChromeAPI(obj, originalObj, path = 'chrome') {
        if (!obj || typeof obj !== 'object') return obj;

        // Use originalObj if provided, otherwise use obj
        const contextObj = originalObj || obj;
        const wrapped = {};
        let wrappedCount = 0;

        for (const [key, value] of Object.entries(obj)) {
            const currentPath = `${path}.${key}`;

            if (typeof value === 'function') {
                // Blacklist of methods that should not be wrapped
                // These methods either:
                // 1. Work with user-provided functions (event listeners)
                // 2. Have complex dual callback/promise behavior in MV3 (messaging)
                // 3. Are passed as parameters to user functions (sendResponse)
                const blacklist = [
                    // Event listeners still use callbacks
                    'addListener',
                    'removeListener',
                    'hasListener',
                    'hasListeners',
                    // // Messaging APIs - have special MV3 behavior where they accept callbacks
                    // // AND return promises simultaneously
                    // 'sendMessage', 'sendNativeMessage',
                    // // Connection APIs - similar dual callback/promise behavior
                    // 'connect', 'connectNative',
                    // // Port APIs - work with port objects that have their own lifecycle
                    // 'postMessage', 'disconnect',
                    // // Response function - passed as parameter to message listeners
                    // 'sendResponse'
                ];

                if (blacklist.includes(key)) {
                    wrapped[key] = value.bind(contextObj);
                } else {
                    // Wrap methods that need callback-to-promise compatibility
                    wrapped[key] = createCallbackCompatibleMethod(value, contextObj, currentPath);
                    wrappedCount++;
                }
            } else if (typeof value === 'object' && value !== null && key !== 'runtime') {
                // Recursively wrap nested objects (skip runtime to avoid infinite recursion)
                wrapped[key] = wrapChromeAPI(value, value, currentPath);
            } else {
                // Copy primitives and other values as-is
                wrapped[key] = value;
            }
        }

        if (wrappedCount > 0 && path === 'chrome') {
            bridgeLog(`✅ Wrapped ${wrappedCount} chrome API methods`);
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
    self.chrome = wrappedChrome;

    bridgeLog('🎯 Bridge initialized and chrome object replaced');

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
