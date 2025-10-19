# Currently Mocked Chrome APIs

This document lists all Chrome Extension APIs that are currently mocked in the fakeium validation system.

## How to Know if an API is Missing

Run fakeium validation with verbose mode:
```bash
FAKEIUM_VERBOSE=true yarn test:fakeium:extension path/to/extension
```

If an extension accesses an API that isn't mocked, you'll see:
```
⚠️  UNMOCKED APIs detected (3):
  - chrome.alarms.create
  - chrome.notifications.create
  - chrome.contextMenus.create

Add these APIs to migrator/features/fakeium/chrome-api-injection.ts
```

## Coverage Status

**Currently Mocked**: 11 Chrome API namespaces
**Total Chrome APIs**: ~50+ namespaces

### Fully Mocked Namespaces

#### chrome.storage (MV2 & MV3)
- `storage.local.get(keys, callback)` / `get(keys): Promise`
- `storage.local.set(items, callback)` / `set(items): Promise`
- `storage.local.remove(keys, callback)` / `remove(keys): Promise`
- `storage.local.clear(callback)` / `clear(): Promise`
- `storage.sync.*` (same methods as local)

#### chrome.tabs (MV2 & MV3)
- `tabs.query(queryInfo, callback)` / `query(queryInfo): Promise`
- `tabs.get(tabId, callback)` / `get(tabId): Promise`
- `tabs.create(createProperties, callback)` / `create(createProperties): Promise`
- `tabs.update(tabId, updateProperties, callback)` / `update(tabId, updateProperties): Promise`
- `tabs.remove(tabIds, callback)` / `remove(tabIds): Promise`
- `tabs.sendMessage(tabId, message, options, callback)` / `sendMessage(tabId, message, options): Promise`
- `tabs.executeScript(tabId, details, callback)` (MV2 only)
- `tabs.getAllInWindow(windowId, callback)` (MV2 only - deprecated)
- `tabs.getSelected(windowId, callback)` (MV2 only - deprecated)
- `tabs.onActivated.addListener(callback)`
- `tabs.onUpdated.addListener(callback)`
- `tabs.onCreated.addListener(callback)`
- `tabs.onRemoved.addListener(callback)`

#### chrome.runtime (MV2 & MV3)
- `runtime.id`
- `runtime.lastError`
- `runtime.getURL(path)`
- `runtime.getManifest()`
- `runtime.sendMessage(extensionId, message, options, callback)` / `sendMessage(...): Promise`
- `runtime.connect(extensionId, connectInfo)`
- `runtime.onMessage.addListener(callback)`
- `runtime.onConnect.addListener(callback)`
- `runtime.onInstalled.addListener(callback)`
- `runtime.onStartup.addListener(callback)`

#### chrome.browserAction (MV2 only)
- `browserAction.setTitle(details, callback)`
- `browserAction.getTitle(details, callback)`
- `browserAction.setIcon(details, callback)`
- `browserAction.setBadgeText(details, callback)`
- `browserAction.getBadgeText(details, callback)`
- `browserAction.setBadgeBackgroundColor(details, callback)`
- `browserAction.onClicked.addListener(callback)`

#### chrome.action (MV3 only)
- `action.setTitle(details): Promise`
- `action.getTitle(details): Promise`
- `action.setIcon(details): Promise`
- `action.setBadgeText(details): Promise`
- `action.getBadgeText(details): Promise`
- `action.setBadgeBackgroundColor(details): Promise`
- `action.show(tabId): Promise`
- `action.hide(tabId): Promise`
- `action.onClicked.addListener(callback)`

#### chrome.extension (MV2 only - deprecated)
- `extension.getURL(path)`
- `extension.sendMessage(message, callback)`
- `extension.connect(connectInfo)`
- `extension.onMessage.addListener(callback)`
- `extension.onConnect.addListener(callback)`

#### chrome.pageAction (MV2 only)
- `pageAction.show(tabId, callback)`
- `pageAction.hide(tabId, callback)`
- `pageAction.setTitle(details, callback)`
- `pageAction.setIcon(details, callback)`
- `pageAction.onClicked.addListener(callback)`

#### chrome.scripting (MV3 only)
- `scripting.executeScript(details): Promise`
- `scripting.insertCSS(details): Promise`
- `scripting.removeCSS(details): Promise`

#### chrome.webNavigation (MV2 & MV3)
- `webNavigation.onBeforeNavigate.addListener(callback)`
- `webNavigation.onCompleted.addListener(callback)`

#### chrome.windows (MV2 & MV3)
- `windows.get(windowId, getInfo, callback)` / `get(windowId, getInfo): Promise`
- `windows.getCurrent(getInfo, callback)` / `getCurrent(getInfo): Promise`
- `windows.create(createData, callback)` / `create(createData): Promise`

### Additional Features

- **Namespace Support**: Both `chrome.*` and `browser.*` namespaces are supported
- **Unmocked API Detection**: Automatically warns when extension code accesses APIs that aren't mocked
- **Proxy-based Detection**: Uses JavaScript Proxy to catch property accesses dynamically

## Common APIs NOT Yet Mocked

These are frequently used Chrome APIs that you might need to add:

- `chrome.alarms.*` - Scheduling APIs
- `chrome.notifications.*` - System notifications
- `chrome.contextMenus.*` - Context menu management
- `chrome.cookies.*` - Cookie management
- `chrome.bookmarks.*` - Bookmark management
- `chrome.history.*` - Browsing history
- `chrome.downloads.*` - Download management
- `chrome.management.*` - Extension management
- `chrome.permissions.*` - Permission requests
- `chrome.identity.*` - OAuth support
- `chrome.declarativeNetRequest.*` - Network request modification (MV3)
- `chrome.webRequest.*` - Network request interception (MV2)
- `chrome.contentSettings.*` - Content settings
- `chrome.privacy.*` - Privacy settings
- `chrome.proxy.*` - Proxy configuration
- `chrome.tts.*` - Text-to-speech
- `chrome.i18n.*` - Internationalization

## Adding a New Mock

See [FAKEIUM_VALIDATION.md](../../../FAKEIUM_VALIDATION.md#adding-new-api-mocks) for instructions on adding new API mocks.

## Testing Coverage

Run all test extensions to see which APIs are being used:
```bash
yarn test:fakeium:extension tests/fixtures/mock-extensions/callback_extension
yarn test:fakeium:extension tests/fixtures/mock-extensions/no_callback_extension
yarn test:fakeium:extension tests/fixtures/mock-extensions/popup-extension
```

Current test coverage:
- **callback_extension**: 39 API calls detected ✅
- **no_callback_extension**: 41 API calls detected ✅
- **popup-extension**: 103 API calls detected ✅

All test extensions run without unmocked API warnings, indicating good coverage for common extension patterns.
