import { Extension } from '../../migrator/types/extension';
import { AbstractFile, LazyFile } from '../../migrator/types/abstract_file';
import { ExtFileType } from '../../migrator/types/ext_file_types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Helper functions for creating test fixtures and mocks
 */

export interface MockFileOptions {
    path: string;
    content?: string;
    filetype?: ExtFileType;
}

export interface MockExtensionOptions {
    id?: string;
    name?: string;
    manifest?: any;
    files?: AbstractFile[];
    isNewTabExtension?: boolean;
}

/**
 * Creates a mock AbstractFile for testing
 */
export function createMockFile(options: MockFileOptions): AbstractFile {
    const mockFile = Object.create(LazyFile.prototype);
    mockFile.path = options.path;
    mockFile.filetype = options.filetype || ExtFileType.JS;

    const content = options.content || '';
    mockFile.getContent = jest.fn().mockReturnValue(content);
    mockFile.getSize = jest.fn().mockReturnValue(Buffer.byteLength(content, 'utf8'));
    mockFile.close = jest.fn();
    mockFile.getAST = jest.fn().mockReturnValue(undefined);
    mockFile.releaseMemory = jest.fn();

    return mockFile;
}

/**
 * Creates a mock Extension for testing
 */
export function createMockExtension(options: MockExtensionOptions = {}): Extension {
    return {
        id: options.id || 'test-extension-id',
        name: options.name || 'Test Extension',
        manifest: options.manifest || { manifest_version: 3 },
        files: options.files || [],
        isNewTabExtension: options.isNewTabExtension || false,
    } as Extension;
}

/**
 * Loads a sample extension from fixtures
 */
export function loadSampleExtension(extensionName: string): Extension {
    const extensionPath = path.join(__dirname, 'sample_extensions', extensionName);

    if (!fs.existsSync(extensionPath)) {
        throw new Error(`Sample extension not found: ${extensionName}`);
    }

    // Load manifest
    const manifestPath = path.join(extensionPath, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Load all files
    const files: AbstractFile[] = [];
    const loadFiles = (dir: string, relativePath = '') => {
        const items = fs.readdirSync(dir);

        for (const item of items) {
            const fullPath = path.join(dir, item);
            const itemRelativePath = path.join(relativePath, item);

            if (fs.statSync(fullPath).isDirectory()) {
                loadFiles(fullPath, itemRelativePath);
            } else {
                const content = fs.readFileSync(fullPath, 'utf8');
                const filetype = getFileType(item);

                files.push(
                    createMockFile({
                        path: itemRelativePath,
                        content,
                        filetype,
                    })
                );
            }
        }
    };

    loadFiles(extensionPath);

    return createMockExtension({
        id: extensionName,
        name: manifest.name,
        manifest,
        files,
    });
}

/**
 * Gets file type based on extension
 */
function getFileType(filename: string): ExtFileType {
    const ext = path.extname(filename).toLowerCase();

    switch (ext) {
        case '.js':
            return ExtFileType.JS;
        case '.json':
            return ExtFileType.OTHER;
        case '.css':
            return ExtFileType.CSS;
        case '.html':
            return ExtFileType.HTML;
        default:
            return ExtFileType.OTHER;
    }
}

/**
 * Creates a minimal valid manifest for testing
 */
export function createTestManifest(overrides: any = {}): any {
    return {
        manifest_version: 3,
        name: 'Test Extension',
        version: '1.0.0',
        description: 'Test extension for unit tests',
        ...overrides,
    };
}

/**
 * Common callback-based code patterns for testing
 */
export const CALLBACK_PATTERNS = {
    storageGet: `chrome.storage.local.get(['key'], function(result) {
    console.log(result);
  });`,

    storageSet: `chrome.storage.local.set({key: 'value'}, function() {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.message);
    }
  });`,

    tabsQuery: `chrome.tabs.query({active: true}, function(tabs) {
    console.log(tabs);
  });`,

    tabsCreate: `chrome.tabs.create({url: 'https://example.com'}, function(tab) {
    console.log('Created tab:', tab.id);
  });`,

    runtimeSendMessage: `chrome.runtime.sendMessage({type: 'test'}, function(response) {
    if (chrome.runtime.lastError) {
      console.error('Message failed');
    } else {
      console.log(response);
    }
  });`,

    executeScript: `chrome.tabs.executeScript(tabId, {code: 'alert("test");'}, function(results) {
    console.log(results);
  });`,

    nestedCallbacks: `chrome.tabs.query({active: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {msg: 'hello'}, function(response) {
      chrome.storage.local.set({response: response}, function() {
        console.log('All done');
      });
    });
  });`,
};

/**
 * Common non-callback code patterns for testing
 */
export const NON_CALLBACK_PATTERNS = {
    getURL: `const url = chrome.runtime.getURL('popup.html');`,

    setBadge: `chrome.browserAction.setBadgeText({text: 'test'});`,

    eventListeners: `chrome.tabs.onCreated.addListener(function(tab) {
    console.log('Tab created');
  });`,

    directAccess: `console.log(chrome.runtime.id);`,

    promiseUsage: `chrome.storage.local.get(['key']).then(result => {
    console.log(result);
  });`,
};

/**
 * Mock Chrome API that returns promises (simulating MV3)
 */
export function createMockChromeAPI(): any {
    return {
        storage: {
            local: {
                get: jest.fn().mockResolvedValue({ key: 'test-value' }),
                set: jest.fn().mockResolvedValue(undefined),
                clear: jest.fn().mockResolvedValue(undefined),
                remove: jest.fn().mockResolvedValue(undefined),
                getBytesInUse: jest.fn().mockResolvedValue(1024),
            },
            sync: {
                get: jest.fn().mockResolvedValue({ syncKey: 'sync-value' }),
                set: jest.fn().mockResolvedValue(undefined),
                clear: jest.fn().mockResolvedValue(undefined),
                remove: jest.fn().mockResolvedValue(undefined),
            },
            session: {
                get: jest.fn().mockResolvedValue({ sessionKey: 'session-value' }),
                set: jest.fn().mockResolvedValue(undefined),
                clear: jest.fn().mockResolvedValue(undefined),
                remove: jest.fn().mockResolvedValue(undefined),
            },
        },
        tabs: {
            query: jest.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
            get: jest.fn().mockResolvedValue({ id: 1, url: 'https://example.com' }),
            create: jest.fn().mockResolvedValue({ id: 2, url: 'https://new-tab.com' }),
            update: jest.fn().mockResolvedValue({ id: 1, url: 'https://updated.com' }),
            remove: jest.fn().mockResolvedValue(undefined),
            duplicate: jest.fn().mockResolvedValue({ id: 3, url: 'https://example.com' }),
            move: jest.fn().mockResolvedValue([{ id: 1, index: 1 }]),
            reload: jest.fn().mockResolvedValue(undefined),
            captureVisibleTab: jest.fn().mockResolvedValue('data:image/png;base64,...'),
            executeScript: jest.fn().mockResolvedValue([{ result: 'script executed' }]),
            insertCSS: jest.fn().mockResolvedValue(undefined),
            removeCSS: jest.fn().mockResolvedValue(undefined),
            sendMessage: jest.fn().mockResolvedValue({ response: 'tab message sent' }),
            detectLanguage: jest.fn().mockResolvedValue('en'),
            getZoom: jest.fn().mockResolvedValue(1.0),
            setZoom: jest.fn().mockResolvedValue(undefined),
        },
        runtime: {
            sendMessage: jest.fn().mockResolvedValue({ response: 'message sent' }),
            sendNativeMessage: jest
                .fn()
                .mockResolvedValue({ nativeResponse: 'native message sent' }),
            getURL: jest.fn().mockReturnValue('chrome-extension://test/file.html'),
            getPlatformInfo: jest.fn().mockResolvedValue({ os: 'mac', arch: 'x86-64' }),
            getPackageDirectoryEntry: jest.fn().mockResolvedValue({}),
            requestUpdateCheck: jest.fn().mockResolvedValue({ status: 'no_update' }),
            id: 'test-extension-id',
            getManifest: jest.fn().mockReturnValue({ version: '1.0.0' }),
        },
        action: {
            setBadgeText: jest.fn().mockResolvedValue(undefined),
            getBadgeText: jest.fn().mockResolvedValue('test'),
            setBadgeBackgroundColor: jest.fn().mockResolvedValue(undefined),
            getBadgeBackgroundColor: jest.fn().mockResolvedValue('#FF0000'),
            setTitle: jest.fn().mockResolvedValue(undefined),
            getTitle: jest.fn().mockResolvedValue('Test Extension'),
            setIcon: jest.fn().mockResolvedValue(undefined),
            setPopup: jest.fn().mockResolvedValue(undefined),
            getPopup: jest.fn().mockResolvedValue('popup.html'),
            enable: jest.fn().mockResolvedValue(undefined),
            disable: jest.fn().mockResolvedValue(undefined),
            isEnabled: jest.fn().mockResolvedValue(true),
        },
        scripting: {
            executeScript: jest.fn().mockResolvedValue([{ result: 'script executed' }]),
            insertCSS: jest.fn().mockResolvedValue(undefined),
            removeCSS: jest.fn().mockResolvedValue(undefined),
        },
    };
}
