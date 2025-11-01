/**
 * Chrome API injection as executable code for fakeium sandbox
 * This generates JavaScript code that defines the chrome object in the sandbox
 */

/**
 * Generate MV2 Chrome API mock as JavaScript code
 */
export function generateMV2ChromeAPI(): string {
    return `
// Chrome API Mock - Manifest V2
(function() {
    // Track unmocked API accesses
    const unmockedAPIs = new Set();

    // Helper to create a proxy that warns about unmocked APIs
    function createWarnProxy(path, obj) {
        return new Proxy(obj, {
            get(target, prop) {
                if (prop in target) {
                    return target[prop];
                }
                // Ignore special properties
                if (typeof prop === 'symbol' || prop === 'toJSON' || prop === 'constructor') {
                    return undefined;
                }
                const fullPath = path + '.' + prop;
                if (!unmockedAPIs.has(fullPath)) {
                    unmockedAPIs.add(fullPath);
                    console.warn('[FAKEIUM] Unmocked API accessed: ' + fullPath);
                }
                return undefined;
            }
        });
    }

    const chromeAPI = {
        storage: {
            local: {
                get: function(keys, callback) {
                    if (callback) callback({});
                },
                set: function(items, callback) {
                    if (callback) callback();
                },
                remove: function(keys, callback) {
                    if (callback) callback();
                },
                clear: function(callback) {
                    if (callback) callback();
                }
            },
            sync: {
                get: function(keys, callback) {
                    if (callback) callback({});
                },
                set: function(items, callback) {
                    if (callback) callback();
                },
                remove: function(keys, callback) {
                    if (callback) callback();
                },
                clear: function(callback) {
                    if (callback) callback();
                }
            }
        },

        tabs: {
            query: function(queryInfo, callback) {
                if (callback) callback([]);
            },
            get: function(tabId, callback) {
                if (callback) callback({id: tabId, url: 'https://example.com'});
            },
            create: function(createProperties, callback) {
                if (callback) callback({id: 1});
            },
            update: function(tabId, updateProperties, callback) {
                if (callback) callback({id: tabId});
            },
            remove: function(tabIds, callback) {
                if (callback) callback();
            },
            sendMessage: function(tabId, message, options, callback) {
                if (typeof options === 'function') {
                    options({});
                } else if (callback) {
                    callback({});
                }
            },
            executeScript: function(tabId, details, callback) {
                if (callback) callback([]);
            },
            getAllInWindow: function(windowId, callback) {
                if (callback) callback([]);
            },
            getSelected: function(windowId, callback) {
                if (callback) callback({id: 1});
            },
            onActivated: {
                addListener: function(callback) {}
            },
            onUpdated: {
                addListener: function(callback) {}
            },
            onCreated: {
                addListener: function(callback) {}
            },
            onRemoved: {
                addListener: function(callback) {}
            }
        },

        runtime: {
            lastError: null,
            id: 'mock-extension-id',
            getURL: function(path) {
                return 'chrome-extension://mock-id/' + path;
            },
            getManifest: function() {
                return {
                    manifest_version: 2,
                    name: 'Mock Extension',
                    version: '1.0.0'
                };
            },
            sendMessage: function(extensionId, message, options, callback) {
                if (typeof extensionId === 'object') {
                    callback = message;
                    message = extensionId;
                }
                if (typeof options === 'function') {
                    options({});
                } else if (callback) {
                    callback({});
                }
            },
            connect: function(extensionId, connectInfo) {
                return {
                    onMessage: { addListener: function() {} },
                    onDisconnect: { addListener: function() {} },
                    postMessage: function() {}
                };
            },
            onMessage: {
                addListener: function(callback) {}
            },
            onConnect: {
                addListener: function(callback) {}
            },
            onInstalled: {
                addListener: function(callback) {}
            },
            onStartup: {
                addListener: function(callback) {}
            }
        },

        browserAction: {
            setTitle: function(details, callback) {
                if (callback) callback();
            },
            getTitle: function(details, callback) {
                if (callback) callback('');
            },
            setIcon: function(details, callback) {
                if (callback) callback();
            },
            setBadgeText: function(details, callback) {
                if (callback) callback();
            },
            getBadgeText: function(details, callback) {
                if (callback) callback('');
            },
            setBadgeBackgroundColor: function(details, callback) {
                if (callback) callback();
            },
            onClicked: {
                addListener: function(callback) {}
            }
        },

        extension: {
            getURL: function(path) {
                return 'chrome-extension://mock-id/' + path;
            },
            sendMessage: function(message, callback) {
                if (callback) callback({});
            },
            connect: function(connectInfo) {
                return {
                    onMessage: { addListener: function() {} },
                    onDisconnect: { addListener: function() {} },
                    postMessage: function() {}
                };
            },
            onMessage: {
                addListener: function(callback) {}
            },
            onConnect: {
                addListener: function(callback) {}
            }
        },

        pageAction: {
            show: function(tabId, callback) {
                if (callback) callback();
            },
            hide: function(tabId, callback) {
                if (callback) callback();
            },
            setTitle: function(details, callback) {
                if (callback) callback();
            },
            setIcon: function(details, callback) {
                if (callback) callback();
            },
            onClicked: {
                addListener: function(callback) {}
            }
        },

        webNavigation: {
            onBeforeNavigate: {
                addListener: function(callback) {}
            },
            onCompleted: {
                addListener: function(callback) {}
            }
        },

        windows: {
            get: function(windowId, getInfo, callback) {
                if (typeof getInfo === 'function') {
                    getInfo({id: windowId});
                } else if (callback) {
                    callback({id: windowId});
                }
            },
            getCurrent: function(getInfo, callback) {
                if (typeof getInfo === 'function') {
                    getInfo({id: 1});
                } else if (callback) {
                    callback({id: 1});
                }
            },
            create: function(createData, callback) {
                if (callback) callback({id: 1});
            }
        }
    };

    // Wrap top-level namespace in proxy to detect unmocked APIs
    const chromeWithProxy = createWarnProxy('chrome', chromeAPI);

    // Set both chrome and browser namespaces
    globalThis.chrome = chromeWithProxy;
    globalThis.browser = chromeWithProxy;

    // Store unmocked APIs globally for reporting
    globalThis.__fakeium_unmocked_apis_mv2 = unmockedAPIs;

    // Console mock
    globalThis.console = globalThis.console || {
        log: function() {},
        error: function() {},
        warn: function() {},
        info: function() {},
        debug: function() {}
    };
})();
`;
}

/**
 * Generate MV3 Chrome API mock as JavaScript code
 */
export function generateMV3ChromeAPI(): string {
    return `
// Chrome API Mock - Manifest V3
(function() {
    // Track unmocked API accesses
    const unmockedAPIs = new Set();

    // Helper to create a proxy that warns about unmocked APIs
    function createWarnProxy(path, obj) {
        return new Proxy(obj, {
            get(target, prop) {
                if (prop in target) {
                    return target[prop];
                }
                // Ignore special properties
                if (typeof prop === 'symbol' || prop === 'toJSON' || prop === 'constructor') {
                    return undefined;
                }
                const fullPath = path + '.' + prop;
                if (!unmockedAPIs.has(fullPath)) {
                    unmockedAPIs.add(fullPath);
                    console.warn('[FAKEIUM] Unmocked API accessed: ' + fullPath);
                }
                return undefined;
            }
        });
    }

    const chromeAPI = {
        storage: {
            local: {
                get: function(keys) {
                    return Promise.resolve({});
                },
                set: function(items) {
                    return Promise.resolve();
                },
                remove: function(keys) {
                    return Promise.resolve();
                },
                clear: function() {
                    return Promise.resolve();
                }
            },
            sync: {
                get: function(keys) {
                    return Promise.resolve({});
                },
                set: function(items) {
                    return Promise.resolve();
                },
                remove: function(keys) {
                    return Promise.resolve();
                },
                clear: function() {
                    return Promise.resolve();
                }
            }
        },

        tabs: {
            query: function(queryInfo) {
                return Promise.resolve([]);
            },
            get: function(tabId) {
                return Promise.resolve({id: tabId, url: 'https://example.com'});
            },
            create: function(createProperties) {
                return Promise.resolve({id: 1});
            },
            update: function(tabId, updateProperties) {
                return Promise.resolve({id: tabId});
            },
            remove: function(tabIds) {
                return Promise.resolve();
            },
            sendMessage: function(tabId, message, options) {
                return Promise.resolve({});
            },
            onActivated: {
                addListener: function(callback) {}
            },
            onUpdated: {
                addListener: function(callback) {}
            },
            onCreated: {
                addListener: function(callback) {}
            },
            onRemoved: {
                addListener: function(callback) {}
            }
        },

        runtime: {
            lastError: null,
            id: 'mock-extension-id',
            getURL: function(path) {
                return 'chrome-extension://mock-id/' + path;
            },
            getManifest: function() {
                return {
                    manifest_version: 3,
                    name: 'Mock Extension',
                    version: '1.0.0'
                };
            },
            sendMessage: function(extensionId, message, options) {
                if (typeof extensionId === 'object') {
                    message = extensionId;
                }
                return Promise.resolve({});
            },
            connect: function(extensionId, connectInfo) {
                return {
                    onMessage: { addListener: function() {} },
                    onDisconnect: { addListener: function() {} },
                    postMessage: function() {}
                };
            },
            onMessage: {
                addListener: function(callback) {}
            },
            onConnect: {
                addListener: function(callback) {}
            },
            onInstalled: {
                addListener: function(callback) {}
            },
            onStartup: {
                addListener: function(callback) {}
            }
        },

        action: {
            setTitle: function(details) {
                return Promise.resolve();
            },
            getTitle: function(details) {
                return Promise.resolve('');
            },
            setIcon: function(details) {
                return Promise.resolve();
            },
            setBadgeText: function(details) {
                return Promise.resolve();
            },
            getBadgeText: function(details) {
                return Promise.resolve('');
            },
            setBadgeBackgroundColor: function(details) {
                return Promise.resolve();
            },
            show: function(tabId) {
                return Promise.resolve();
            },
            hide: function(tabId) {
                return Promise.resolve();
            },
            onClicked: {
                addListener: function(callback) {}
            }
        },

        scripting: {
            executeScript: function(details) {
                return Promise.resolve([]);
            },
            insertCSS: function(details) {
                return Promise.resolve();
            },
            removeCSS: function(details) {
                return Promise.resolve();
            }
        },

        webNavigation: {
            onBeforeNavigate: {
                addListener: function(callback) {}
            },
            onCompleted: {
                addListener: function(callback) {}
            }
        },

        windows: {
            get: function(windowId, getInfo) {
                return Promise.resolve({id: windowId});
            },
            getCurrent: function(getInfo) {
                return Promise.resolve({id: 1});
            },
            create: function(createData) {
                return Promise.resolve({id: 1});
            }
        }
    };

    // Wrap top-level namespace in proxy to detect unmocked APIs
    const chromeWithProxy = createWarnProxy('chrome', chromeAPI);

    // Set both chrome and browser namespaces
    globalThis.chrome = chromeWithProxy;
    globalThis.browser = chromeWithProxy;

    // Store unmocked APIs globally for reporting
    globalThis.__fakeium_unmocked_apis_mv3 = unmockedAPIs;

    // Console mock
    globalThis.console = globalThis.console || {
        log: function() {},
        error: function() {},
        warn: function() {},
        info: function() {},
        debug: function() {}
    };
})();
`;
}
