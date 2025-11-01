/**
 * Chrome Extension API mocks for fakeium (v2 - object-based approach)
 * Hooks the entire chrome object to properly capture all API accesses
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

    local = {
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
}

/**
 * Create a complete chrome API object for MV2
 */
function createMV2ChromeAPI(): any {
    const storage = new MockStorage();

    const mockTabs = [
        { id: 1, url: 'https://example.com', active: true, windowId: 1 }
    ];

    return {
        // chrome.extension.* (MV2)
        extension: {
            getURL: (path: string) => `chrome-extension://mock-id/${path}`,
            connect: (extensionId?: string, connectInfo?: any) => ({
                name: connectInfo?.name || 'port',
                disconnect: () => {},
                postMessage: () => {}
            }),
            sendMessage: (extensionId: any, message: any, options?: any, callback?: Function) => {
                const cb = typeof message === 'function' ? message : (options || callback);
                if (typeof cb === 'function') cb({ received: true });
                return Promise.resolve({ received: true });
            },
            onMessage: new MockEvent(),
            onConnect: new MockEvent()
        },

        // chrome.browserAction.* (MV2)
        browserAction: {
            setTitle: (details: any, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            setBadgeText: (details: any, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            setBadgeBackgroundColor: (details: any, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            onClicked: new MockEvent()
        },

        // chrome.pageAction.* (MV2)
        pageAction: {
            show: (tabId: number, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            hide: (tabId: number, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            setTitle: (details: any, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            onClicked: new MockEvent()
        },

        // chrome.tabs.*
        tabs: {
            query: (queryInfo: any, callback?: (tabs: any[]) => void) => {
                let result = [...mockTabs];
                if (queryInfo.active !== undefined) {
                    result = result.filter(t => t.active === queryInfo.active);
                }
                if (callback) callback(result);
                return Promise.resolve(result);
            },
            get: (tabId: number, callback?: (tab: any) => void) => {
                const tab = mockTabs.find(t => t.id === tabId);
                if (callback) callback(tab);
                return Promise.resolve(tab);
            },
            create: (createProperties: any, callback?: (tab: any) => void) => {
                const newTab = { id: Date.now(), url: createProperties.url || 'about:blank', active: true, windowId: 1 };
                if (callback) callback(newTab);
                return Promise.resolve(newTab);
            },
            sendMessage: (tabId: number, message: any, options?: any, callback?: Function) => {
                if (callback) callback({ received: true });
                return Promise.resolve({ received: true });
            },
            // MV2 deprecated methods
            getAllInWindow: (windowId: number | null, callback: (tabs: any[]) => void) => {
                if (callback) callback(mockTabs);
            },
            getSelected: (windowId: number | null, callback: (tab: any) => void) => {
                if (callback) callback(mockTabs[0]);
            },
            executeScript: (tabId: any, details: any, callback?: Function) => {
                if (callback) callback([{ success: true }]);
                return Promise.resolve([{ success: true }]);
            },
            onActivated: new MockEvent(),
            onActiveChanged: new MockEvent(), // Deprecated
            onCreated: new MockEvent(),
            onUpdated: new MockEvent()
        },

        // chrome.storage.*
        storage: {
            sync: storage.sync,
            local: storage.local
        },

        // chrome.runtime.*
        runtime: {
            sendMessage: (extensionId: any, message: any, options?: any, callback?: Function) => {
                const cb = typeof message === 'function' ? message : (options || callback);
                if (typeof cb === 'function') cb({ received: true });
                return Promise.resolve({ received: true });
            },
            getURL: (path: string) => `chrome-extension://mock-id/${path}`,
            connect: (extensionId?: string, connectInfo?: any) => ({
                name: connectInfo?.name || 'port',
                disconnect: () => {},
                postMessage: () => {}
            }),
            lastError: null,
            onMessage: new MockEvent(),
            onConnect: new MockEvent()
        }
    };
}

/**
 * Create a complete chrome API object for MV3
 */
function createMV3ChromeAPI(): any {
    const storage = new MockStorage();

    const mockTabs = [
        { id: 1, url: 'https://example.com', active: true, windowId: 1 }
    ];

    return {
        // chrome.action.* (MV3 - replaces browserAction and pageAction)
        action: {
            setTitle: (details: any, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            setBadgeText: (details: any, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            setBadgeBackgroundColor: (details: any, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            show: (tabId: number, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            hide: (tabId: number, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            },
            onClicked: new MockEvent()
        },

        // chrome.tabs.* (MV3 - no deprecated methods)
        tabs: {
            query: (queryInfo: any, callback?: (tabs: any[]) => void) => {
                let result = [...mockTabs];
                if (queryInfo.active !== undefined) {
                    result = result.filter(t => t.active === queryInfo.active);
                }
                if (callback) callback(result);
                return Promise.resolve(result);
            },
            get: (tabId: number, callback?: (tab: any) => void) => {
                const tab = mockTabs.find(t => t.id === tabId);
                if (callback) callback(tab);
                return Promise.resolve(tab);
            },
            create: (createProperties: any, callback?: (tab: any) => void) => {
                const newTab = { id: Date.now(), url: createProperties.url || 'about:blank', active: true, windowId: 1 };
                if (callback) callback(newTab);
                return Promise.resolve(newTab);
            },
            sendMessage: (tabId: number, message: any, options?: any, callback?: Function) => {
                if (callback) callback({ received: true });
                return Promise.resolve({ received: true });
            },
            onActivated: new MockEvent(),
            onCreated: new MockEvent(),
            onUpdated: new MockEvent()
        },

        // chrome.scripting.* (MV3 - replaces tabs.executeScript)
        scripting: {
            executeScript: (injection: any, callback?: Function) => {
                const result = [{ success: true, injection }];
                if (callback) callback(result);
                return Promise.resolve(result);
            },
            insertCSS: (injection: any, callback?: Function) => {
                if (callback) callback();
                return Promise.resolve();
            }
        },

        // chrome.storage.*
        storage: {
            sync: storage.sync,
            local: storage.local
        },

        // chrome.runtime.*
        runtime: {
            sendMessage: (extensionId: any, message: any, options?: any, callback?: Function) => {
                const cb = typeof message === 'function' ? message : (options || callback);
                if (typeof cb === 'function') cb({ received: true });
                return Promise.resolve({ received: true });
            },
            getURL: (path: string) => `chrome-extension://mock-id/${path}`,
            connect: (extensionId?: string, connectInfo?: any) => ({
                name: connectInfo?.name || 'port',
                disconnect: () => {},
                postMessage: () => {}
            }),
            lastError: null,
            onMessage: new MockEvent(),
            onConnect: new MockEvent()
        }
    };
}

/**
 * Setup Chrome Extension API mocks for Manifest V2
 */
export function setupMV2Mocks(fakeium: Fakeium): void {
    const chromeAPI = createMV2ChromeAPI();

    // Hook the entire chrome object
    fakeium.hook('chrome', chromeAPI);

    // Also hook console for logging
    fakeium.hook('console', {
        log: (...args: any[]) => {},
        error: (...args: any[]) => {},
        warn: (...args: any[]) => {},
        info: (...args: any[]) => {},
        debug: (...args: any[]) => {}
    });
}

/**
 * Setup Chrome Extension API mocks for Manifest V3
 */
export function setupMV3Mocks(fakeium: Fakeium): void {
    const chromeAPI = createMV3ChromeAPI();

    // Hook the entire chrome object
    fakeium.hook('chrome', chromeAPI);

    // Also hook console for logging
    fakeium.hook('console', {
        log: (...args: any[]) => {},
        error: (...args: any[]) => {},
        warn: (...args: any[]) => {},
        info: (...args: any[]) => {},
        debug: (...args: any[]) => {}
    });
}
