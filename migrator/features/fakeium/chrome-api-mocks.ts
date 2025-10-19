/**
 * Chrome Extension API mocks for fakeium
 * Provides mock implementations for both MV2 and MV3 APIs
 */

import { Fakeium } from 'fakeium';

/**
 * Mock storage for simulating chrome.storage APIs
 */
class MockStorage {
    private data: Map<string, any> = new Map();

    sync = {
        get: (keys: string | string[] | null, callback?: (items: any) => void) => {
            const result: any = {};
            if (keys === null || keys === undefined) {
                this.data.forEach((value, key) => {
                    result[key] = value;
                });
            } else if (typeof keys === 'string') {
                result[keys] = this.data.get(keys);
            } else if (Array.isArray(keys)) {
                keys.forEach(key => {
                    result[key] = this.data.get(key);
                });
            }
            if (callback) callback(result);
            return Promise.resolve(result);
        },
        set: (items: { [key: string]: any }, callback?: () => void) => {
            Object.entries(items).forEach(([key, value]) => {
                this.data.set(key, value);
            });
            if (callback) callback();
            return Promise.resolve();
        },
        remove: (keys: string | string[], callback?: () => void) => {
            const keyArray = Array.isArray(keys) ? keys : [keys];
            keyArray.forEach(key => this.data.delete(key));
            if (callback) callback();
            return Promise.resolve();
        },
        clear: (callback?: () => void) => {
            this.data.clear();
            if (callback) callback();
            return Promise.resolve();
        }
    };

    local = { ...this.sync };
}

/**
 * Mock event listeners
 */
class MockEvent {
    private listeners: Function[] = [];

    addListener(callback: Function) {
        this.listeners.push(callback);
    }

    removeListener(callback: Function) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    hasListener(callback: Function): boolean {
        return this.listeners.includes(callback);
    }

    // Internal method to trigger the event (for testing)
    _trigger(...args: any[]) {
        this.listeners.forEach(listener => {
            try {
                listener(...args);
            } catch (e) {
                console.error('Error in event listener:', e);
            }
        });
    }
}

/**
 * Mock tabs for simulating chrome.tabs API
 */
class MockTabs {
    private mockTabId = 1;
    private tabs: any[] = [
        { id: 1, url: 'https://example.com', active: true, windowId: 1 }
    ];

    query(queryInfo: any, callback?: (tabs: any[]) => void) {
        let result = [...this.tabs];

        if (queryInfo.active !== undefined) {
            result = result.filter(tab => tab.active === queryInfo.active);
        }
        if (queryInfo.windowId !== undefined) {
            result = result.filter(tab => tab.windowId === queryInfo.windowId);
        }
        if (queryInfo.currentWindow) {
            result = result.filter(tab => tab.windowId === 1);
        }

        if (callback) callback(result);
        return Promise.resolve(result);
    }

    get(tabId: number, callback?: (tab: any) => void) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (callback) callback(tab);
        return Promise.resolve(tab);
    }

    sendMessage(tabId: number, message: any, options?: any, responseCallback?: (response: any) => void) {
        // Simulate message sending
        if (responseCallback) {
            responseCallback({ received: true, tabId, message });
        }
        return Promise.resolve({ received: true, tabId, message });
    }

    create(createProperties: any, callback?: (tab: any) => void) {
        const newTab = {
            id: ++this.mockTabId,
            url: createProperties.url || 'about:blank',
            active: createProperties.active !== false,
            windowId: createProperties.windowId || 1
        };
        this.tabs.push(newTab);
        if (callback) callback(newTab);
        return Promise.resolve(newTab);
    }

    onActivated = new MockEvent();
    onCreated = new MockEvent();
    onUpdated = new MockEvent();
}

/**
 * Setup Chrome Extension API mocks for Manifest V2
 */
export function setupMV2Mocks(fakeium: Fakeium): void {
    const storage = new MockStorage();
    const tabs = new MockTabs();

    // chrome.extension.* (MV2 APIs)
    fakeium.hook('chrome.extension.getURL', (path: string) => {
        return `chrome-extension://mock-extension-id/${path}`;
    });

    fakeium.hook('chrome.extension.connect', (extensionId?: string, connectInfo?: any) => {
        return { name: connectInfo?.name || 'port', disconnect: () => {}, postMessage: () => {} };
    });

    fakeium.hook('chrome.extension.sendMessage', (extensionId: any, message: any, options?: any, responseCallback?: Function) => {
        // Handle overloaded parameters
        let actualExtensionId = null;
        let actualMessage = extensionId;
        let actualCallback = message;

        if (typeof message !== 'function') {
            actualExtensionId = extensionId;
            actualMessage = message;
            actualCallback = options || responseCallback;
        }

        if (typeof actualCallback === 'function') {
            actualCallback({ received: true, message: actualMessage });
        }
        return Promise.resolve({ received: true, message: actualMessage });
    });

    fakeium.hook('chrome.extension.onMessage', new MockEvent());
    fakeium.hook('chrome.extension.onConnect', new MockEvent());

    // chrome.browserAction.* (MV2)
    fakeium.hook('chrome.browserAction.setTitle', (details: any, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.browserAction.setBadgeText', (details: any, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.browserAction.setBadgeBackgroundColor', (details: any, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.browserAction.onClicked', new MockEvent());

    // chrome.pageAction.* (MV2)
    fakeium.hook('chrome.pageAction.show', (tabId: number, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.pageAction.hide', (tabId: number, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.pageAction.setTitle', (details: any, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.pageAction.onClicked', new MockEvent());

    // chrome.tabs.* (MV2 methods)
    fakeium.hook('chrome.tabs.query', tabs.query.bind(tabs));
    fakeium.hook('chrome.tabs.get', tabs.get.bind(tabs));
    fakeium.hook('chrome.tabs.create', tabs.create.bind(tabs));
    fakeium.hook('chrome.tabs.sendMessage', tabs.sendMessage.bind(tabs));

    // MV2-specific deprecated methods
    fakeium.hook('chrome.tabs.getAllInWindow', (windowId: number | null, callback: (tabs: any[]) => void) => {
        tabs.query({ windowId: windowId === null ? 1 : windowId }, callback);
    });

    fakeium.hook('chrome.tabs.getSelected', (windowId: number | null, callback: (tab: any) => void) => {
        tabs.query({ active: true, windowId: windowId === null ? 1 : windowId }, (result) => {
            callback(result[0]);
        });
    });

    fakeium.hook('chrome.tabs.executeScript', (tabId: any, details: any, callback?: Function) => {
        const result = [{ success: true, tabId, details }];
        if (callback) callback(result);
        return Promise.resolve(result);
    });

    // MV2 events
    fakeium.hook('chrome.tabs.onActiveChanged', new MockEvent()); // Deprecated in MV3
    fakeium.hook('chrome.tabs.onActivated', tabs.onActivated);
    fakeium.hook('chrome.tabs.onCreated', tabs.onCreated);
    fakeium.hook('chrome.tabs.onUpdated', tabs.onUpdated);

    // chrome.storage
    fakeium.hook('chrome.storage.sync.get', storage.sync.get.bind(storage.sync));
    fakeium.hook('chrome.storage.sync.set', storage.sync.set.bind(storage.sync));
    fakeium.hook('chrome.storage.sync.remove', storage.sync.remove.bind(storage.sync));
    fakeium.hook('chrome.storage.sync.clear', storage.sync.clear.bind(storage.sync));
    fakeium.hook('chrome.storage.local.get', storage.local.get.bind(storage.local));
    fakeium.hook('chrome.storage.local.set', storage.local.set.bind(storage.local));
    fakeium.hook('chrome.storage.local.remove', storage.local.remove.bind(storage.local));
    fakeium.hook('chrome.storage.local.clear', storage.local.clear.bind(storage.local));

    // chrome.runtime (also exists in MV2)
    fakeium.hook('chrome.runtime.sendMessage', (extensionId: any, message: any, options?: any, responseCallback?: Function) => {
        let actualMessage = extensionId;
        let actualCallback = message;

        if (typeof message !== 'function') {
            actualMessage = message;
            actualCallback = options || responseCallback;
        }

        if (typeof actualCallback === 'function') {
            actualCallback({ received: true, message: actualMessage });
        }
        return Promise.resolve({ received: true, message: actualMessage });
    });

    fakeium.hook('chrome.runtime.getURL', (path: string) => {
        return `chrome-extension://mock-extension-id/${path}`;
    });

    fakeium.hook('chrome.runtime.onMessage', new MockEvent());
    fakeium.hook('chrome.runtime.onConnect', new MockEvent());

    // Common APIs
    fakeium.hook('console.log', (...args: any[]) => {
        // Silent in sandbox, just capture the call
    });

    fakeium.hook('console.error', (...args: any[]) => {
        // Silent in sandbox, just capture the call
    });

    fakeium.hook('console.warn', (...args: any[]) => {
        // Silent in sandbox, just capture the call
    });
}

/**
 * Setup Chrome Extension API mocks for Manifest V3
 */
export function setupMV3Mocks(fakeium: Fakeium): void {
    const storage = new MockStorage();
    const tabs = new MockTabs();

    // chrome.action.* (MV3 - replaces browserAction and pageAction)
    fakeium.hook('chrome.action.setTitle', (details: any, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.action.setBadgeText', (details: any, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.action.setBadgeBackgroundColor', (details: any, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.action.show', (tabId: number, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.action.hide', (tabId: number, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    fakeium.hook('chrome.action.onClicked', new MockEvent());

    // chrome.tabs.* (MV3 - removed deprecated methods)
    fakeium.hook('chrome.tabs.query', tabs.query.bind(tabs));
    fakeium.hook('chrome.tabs.get', tabs.get.bind(tabs));
    fakeium.hook('chrome.tabs.create', tabs.create.bind(tabs));
    fakeium.hook('chrome.tabs.sendMessage', tabs.sendMessage.bind(tabs));

    // MV3 events (no onActiveChanged)
    fakeium.hook('chrome.tabs.onActivated', tabs.onActivated);
    fakeium.hook('chrome.tabs.onCreated', tabs.onCreated);
    fakeium.hook('chrome.tabs.onUpdated', tabs.onUpdated);

    // chrome.scripting.* (MV3 - replaces tabs.executeScript)
    fakeium.hook('chrome.scripting.executeScript', (injection: any, callback?: Function) => {
        const result = [{ success: true, injection }];
        if (callback) callback(result);
        return Promise.resolve(result);
    });

    fakeium.hook('chrome.scripting.insertCSS', (injection: any, callback?: Function) => {
        if (callback) callback();
        return Promise.resolve();
    });

    // chrome.storage (same in MV2 and MV3)
    fakeium.hook('chrome.storage.sync.get', storage.sync.get.bind(storage.sync));
    fakeium.hook('chrome.storage.sync.set', storage.sync.set.bind(storage.sync));
    fakeium.hook('chrome.storage.sync.remove', storage.sync.remove.bind(storage.sync));
    fakeium.hook('chrome.storage.sync.clear', storage.sync.clear.bind(storage.sync));
    fakeium.hook('chrome.storage.local.get', storage.local.get.bind(storage.local));
    fakeium.hook('chrome.storage.local.set', storage.local.set.bind(storage.local));
    fakeium.hook('chrome.storage.local.remove', storage.local.remove.bind(storage.local));
    fakeium.hook('chrome.storage.local.clear', storage.local.clear.bind(storage.local));

    // chrome.runtime.* (MV3)
    fakeium.hook('chrome.runtime.sendMessage', (extensionId: any, message: any, options?: any, responseCallback?: Function) => {
        let actualMessage = extensionId;
        let actualCallback = message;

        if (typeof message !== 'function') {
            actualMessage = message;
            actualCallback = options || responseCallback;
        }

        if (typeof actualCallback === 'function') {
            actualCallback({ received: true, message: actualMessage });
        }
        return Promise.resolve({ received: true, message: actualMessage });
    });

    fakeium.hook('chrome.runtime.getURL', (path: string) => {
        return `chrome-extension://mock-extension-id/${path}`;
    });

    fakeium.hook('chrome.runtime.connect', (extensionId?: string, connectInfo?: any) => {
        return { name: connectInfo?.name || 'port', disconnect: () => {}, postMessage: () => {} };
    });

    fakeium.hook('chrome.runtime.onMessage', new MockEvent());
    fakeium.hook('chrome.runtime.onConnect', new MockEvent());

    // Common APIs
    fakeium.hook('console.log', (...args: any[]) => {
        // Silent in sandbox, just capture the call
    });

    fakeium.hook('console.error', (...args: any[]) => {
        // Silent in sandbox, just capture the call
    });

    fakeium.hook('console.warn', (...args: any[]) => {
        // Silent in sandbox, just capture the call
    });
}
