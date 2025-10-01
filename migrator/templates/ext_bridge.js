
(function() {
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
  function createCallbackCompatibleMethod(originalMethod) {
    return function(...args) {
      const lastArg = args[args.length - 1];

      if (typeof lastArg === 'function') {
        const callback = args.pop();

        // Helper to set chrome.runtime.lastError and call callback
        const callbackWithError = (error, result) => {
          if (!chrome.runtime) chrome.runtime = {};

          if (error) {
            chrome.runtime.lastError = { message: error.message || 'Unknown error' };
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
          const result = originalMethod.apply(this, args);

          if (result && typeof result.then === 'function') {
            // Promise: bridge to callback
            result.then(data => callbackWithError(null, data))
                  .catch(error => callbackWithError(error));
          } else {
            // Synchronous: call callback directly
            callbackWithError(null, result);
          }
        } catch (error) {
          callbackWithError(error);
        }
      } else {
        // No callback: pass through unchanged
        return originalMethod.apply(this, args);
      }
    };
  }

  // Recursively wrap chrome API object
  function wrapChromeAPI(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    const wrapped = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'function') {
        // Wrap methods that might need callback compatibility
        wrapped[key] = createCallbackCompatibleMethod(value);
      } else if (typeof value === 'object' && value !== null && key !== 'runtime') {
        // Recursively wrap nested objects (skip runtime to avoid infinite recursion)
        wrapped[key] = wrapChromeAPI(value);
      } else {
        // Copy primitives and other values as-is
        wrapped[key] = value;
      }
    }

    return wrapped;
  }

  // Create wrapped chrome object
  const wrappedChrome = wrapChromeAPI(originalChrome);

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
        .then(result => cb(null, result))
        .catch(err => cb(err));
    };
  }

  // Export for testing if in test environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createCallbackCompatibleMethod,
      wrapChromeAPI,
      callbackify
    };
  }
})();
