use once_cell::sync::Lazy;
use std::collections::HashMap;

/// Human-readable labels for Chrome Extension API event listeners
/// This mapping makes technical API names more understandable for users
///
/// To add new mappings, simply add entries to the LISTENER_LABELS HashMap below
static LISTENER_LABELS: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();

    // Runtime API
    m.insert("chrome.runtime.onMessage", "Background Messages");
    m.insert("chrome.runtime.onMessageExternal", "External Messages");
    m.insert("chrome.runtime.onConnect", "Port Connections");
    m.insert(
        "chrome.runtime.onConnectExternal",
        "External Port Connections",
    );
    m.insert("chrome.runtime.onInstalled", "Installation/Update Events");
    m.insert("chrome.runtime.onStartup", "Browser Startup");
    m.insert("chrome.runtime.onSuspend", "Extension Suspend");
    m.insert("chrome.runtime.onSuspendCanceled", "Suspend Canceled");
    m.insert("chrome.runtime.onUpdateAvailable", "Update Available");
    m.insert("chrome.runtime.onRestartRequired", "Restart Required");

    // Tabs API
    m.insert("chrome.tabs.onCreated", "Tab Created");
    m.insert("chrome.tabs.onUpdated", "Tab Updated");
    m.insert("chrome.tabs.onMoved", "Tab Moved");
    m.insert("chrome.tabs.onActivated", "Tab Activated");
    m.insert("chrome.tabs.onHighlighted", "Tab Highlighted");
    m.insert("chrome.tabs.onDetached", "Tab Detached");
    m.insert("chrome.tabs.onAttached", "Tab Attached");
    m.insert("chrome.tabs.onRemoved", "Tab Closed");
    m.insert("chrome.tabs.onReplaced", "Tab Replaced");
    m.insert("chrome.tabs.onZoomChange", "Tab Zoom Changed");

    // Windows API
    m.insert("chrome.windows.onCreated", "Window Created");
    m.insert("chrome.windows.onRemoved", "Window Closed");
    m.insert("chrome.windows.onFocusChanged", "Window Focus Changed");
    m.insert("chrome.windows.onBoundsChanged", "Window Bounds Changed");

    // WebNavigation API
    m.insert("chrome.webNavigation.onBeforeNavigate", "Before Navigation");
    m.insert("chrome.webNavigation.onCommitted", "Navigation Committed");
    m.insert(
        "chrome.webNavigation.onDOMContentLoaded",
        "DOM Content Loaded",
    );
    m.insert("chrome.webNavigation.onCompleted", "Navigation Completed");
    m.insert("chrome.webNavigation.onErrorOccurred", "Navigation Error");
    m.insert(
        "chrome.webNavigation.onCreatedNavigationTarget",
        "New Navigation Target",
    );
    m.insert(
        "chrome.webNavigation.onReferenceFragmentUpdated",
        "Fragment Updated",
    );
    m.insert(
        "chrome.webNavigation.onTabReplaced",
        "Tab Replaced in Navigation",
    );
    m.insert(
        "chrome.webNavigation.onHistoryStateUpdated",
        "History State Updated",
    );

    // WebRequest API
    m.insert("chrome.webRequest.onBeforeRequest", "Before Web Request");
    m.insert(
        "chrome.webRequest.onBeforeSendHeaders",
        "Before Send Headers",
    );
    m.insert("chrome.webRequest.onSendHeaders", "Send Headers");
    m.insert("chrome.webRequest.onHeadersReceived", "Headers Received");
    m.insert("chrome.webRequest.onAuthRequired", "Auth Required");
    m.insert("chrome.webRequest.onResponseStarted", "Response Started");
    m.insert("chrome.webRequest.onBeforeRedirect", "Before Redirect");
    m.insert("chrome.webRequest.onCompleted", "Request Completed");
    m.insert("chrome.webRequest.onErrorOccurred", "Request Error");

    // Bookmarks API
    m.insert("chrome.bookmarks.onCreated", "Bookmark Created");
    m.insert("chrome.bookmarks.onRemoved", "Bookmark Removed");
    m.insert("chrome.bookmarks.onChanged", "Bookmark Changed");
    m.insert("chrome.bookmarks.onMoved", "Bookmark Moved");
    m.insert(
        "chrome.bookmarks.onChildrenReordered",
        "Bookmarks Reordered",
    );
    m.insert("chrome.bookmarks.onImportBegan", "Bookmark Import Started");
    m.insert("chrome.bookmarks.onImportEnded", "Bookmark Import Ended");

    // History API
    m.insert("chrome.history.onVisited", "Page Visited");
    m.insert("chrome.history.onVisitRemoved", "Visit Removed");

    // Downloads API
    m.insert("chrome.downloads.onCreated", "Download Started");
    m.insert("chrome.downloads.onChanged", "Download Changed");
    m.insert("chrome.downloads.onErased", "Download Erased");
    m.insert(
        "chrome.downloads.onDeterminingFilename",
        "Determining Filename",
    );

    // Cookies API
    m.insert("chrome.cookies.onChanged", "Cookie Changed");

    // Storage API
    m.insert("chrome.storage.onChanged", "Storage Changed");

    // Alarms API
    m.insert("chrome.alarms.onAlarm", "Alarm Triggered");

    // Notifications API
    m.insert("chrome.notifications.onClicked", "Notification Clicked");
    m.insert(
        "chrome.notifications.onButtonClicked",
        "Notification Button Clicked",
    );
    m.insert("chrome.notifications.onClosed", "Notification Closed");
    m.insert("chrome.notifications.onShown", "Notification Shown");

    // Context Menus API
    m.insert("chrome.contextMenus.onClicked", "Context Menu Clicked");

    // Commands API
    m.insert("chrome.commands.onCommand", "Keyboard Command");

    // Omnibox API
    m.insert("chrome.omnibox.onInputStarted", "Omnibox Input Started");
    m.insert("chrome.omnibox.onInputChanged", "Omnibox Input Changed");
    m.insert("chrome.omnibox.onInputEntered", "Omnibox Input Entered");
    m.insert("chrome.omnibox.onInputCancelled", "Omnibox Input Cancelled");
    m.insert(
        "chrome.omnibox.onDeleteSuggestion",
        "Omnibox Suggestion Deleted",
    );

    // Management API
    m.insert("chrome.management.onInstalled", "Extension Installed");
    m.insert("chrome.management.onUninstalled", "Extension Uninstalled");
    m.insert("chrome.management.onEnabled", "Extension Enabled");
    m.insert("chrome.management.onDisabled", "Extension Disabled");

    // Idle API
    m.insert("chrome.idle.onStateChanged", "Idle State Changed");

    // Browser Action / Page Action / Action API
    m.insert("chrome.browserAction.onClicked", "Browser Action Clicked");
    m.insert("chrome.pageAction.onClicked", "Page Action Clicked");
    m.insert("chrome.action.onClicked", "Action Clicked");

    // Declarative Content API
    m.insert(
        "chrome.declarativeContent.onPageChanged",
        "Page Content Changed",
    );

    // Content Settings API
    m.insert(
        "chrome.contentSettings.onChanged",
        "Content Setting Changed",
    );

    // Privacy API
    m.insert(
        "chrome.privacy.network.onChanged",
        "Network Privacy Changed",
    );
    m.insert(
        "chrome.privacy.services.onChanged",
        "Services Privacy Changed",
    );
    m.insert(
        "chrome.privacy.websites.onChanged",
        "Websites Privacy Changed",
    );

    // Proxy API
    m.insert("chrome.proxy.onProxyError", "Proxy Error");

    // TTS (Text-to-Speech) API
    m.insert("chrome.tts.onEvent", "TTS Event");

    // Font Settings API
    m.insert("chrome.fontSettings.onFontChanged", "Font Changed");
    m.insert(
        "chrome.fontSettings.onDefaultFontSizeChanged",
        "Default Font Size Changed",
    );
    m.insert(
        "chrome.fontSettings.onDefaultFixedFontSizeChanged",
        "Fixed Font Size Changed",
    );
    m.insert(
        "chrome.fontSettings.onMinimumFontSizeChanged",
        "Minimum Font Size Changed",
    );

    // Browser equivalent (for Firefox/cross-browser extensions)
    m.insert("browser.runtime.onMessage", "Background Messages");
    m.insert("browser.runtime.onConnect", "Port Connections");
    m.insert("browser.runtime.onInstalled", "Installation/Update Events");
    m.insert("browser.tabs.onCreated", "Tab Created");
    m.insert("browser.tabs.onUpdated", "Tab Updated");
    m.insert("browser.tabs.onActivated", "Tab Activated");
    m.insert("browser.tabs.onRemoved", "Tab Closed");
    m.insert("browser.webNavigation.onCompleted", "Navigation Completed");
    m.insert("browser.webRequest.onBeforeRequest", "Before Web Request");
    m.insert("browser.storage.onChanged", "Storage Changed");

    m
});

/// Get a human-readable label for an event listener API
///
/// # Arguments
/// * `api` - The full API path (e.g., "chrome.tabs.onUpdated")
///
/// # Returns
/// A human-readable label if one exists, otherwise returns the original API string
///
/// # Example
/// ```
/// let label = get_listener_label("chrome.tabs.onUpdated");
/// assert_eq!(label, "Tab Updated");
///
/// let unknown = get_listener_label("chrome.unknown.onSomething");
/// assert_eq!(unknown, "chrome.unknown.onSomething");
/// ```
pub fn get_listener_label(api: &str) -> &str {
    LISTENER_LABELS.get(api).copied().unwrap_or(api)
}

/// Get the original API name from a label (reverse lookup)
/// This is useful if you need to go from a human-readable label back to the API
///
/// Note: This does a linear search, so it's not as efficient as get_listener_label
pub fn get_api_from_label(label: &str) -> Option<&'static str> {
    LISTENER_LABELS
        .iter()
        .find(|(_, &v)| v == label)
        .map(|(&k, _)| k)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_listener_label() {
        assert_eq!(get_listener_label("chrome.tabs.onUpdated"), "Tab Updated");
        assert_eq!(
            get_listener_label("chrome.runtime.onMessage"),
            "Background Messages"
        );
    }

    #[test]
    fn test_unknown_listener() {
        let unknown = "chrome.unknown.onSomething";
        assert_eq!(get_listener_label(unknown), unknown);
    }

    #[test]
    fn test_browser_api() {
        assert_eq!(get_listener_label("browser.tabs.onUpdated"), "Tab Updated");
    }

    #[test]
    fn test_reverse_lookup() {
        assert_eq!(
            get_api_from_label("Tab Updated"),
            Some("chrome.tabs.onUpdated")
        );
    }
}
