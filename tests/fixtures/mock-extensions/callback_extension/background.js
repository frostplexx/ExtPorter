// Background script with callback-based Chrome APIs

// Storage API with callback
chrome.storage.local.get(['userSettings'], function(result) {
  if (chrome.runtime.lastError) {
    console.error('Storage error:', chrome.runtime.lastError.message);
    return;
  }

  console.log('User settings:', result.userSettings);

  // Initialize default settings if not found
  if (!result.userSettings) {
    chrome.storage.local.set({
      userSettings: {
        theme: 'light',
        autoSync: true
      }
    }, function() {
      if (chrome.runtime.lastError) {
        console.error('Failed to save settings:', chrome.runtime.lastError.message);
      } else {
        console.log('Default settings saved');
      }
    });
  }
});

// Tabs API with callbacks
chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
  if (chrome.runtime.lastError) {
    console.error('Query error:', chrome.runtime.lastError.message);
    return;
  }

  if (tabs && tabs.length > 0) {
    console.log('Active tab:', tabs[0].url);

    // Send message to content script
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'GET_PAGE_INFO'
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.log('Could not send message:', chrome.runtime.lastError.message);
      } else {
        console.log('Page info:', response);
      }
    });
  }
});

// Runtime messaging with callback
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.type === 'SAVE_DATA') {
    chrome.storage.local.set({
      pageData: request.data
    }, function() {
      if (chrome.runtime.lastError) {
        sendResponse({success: false, error: chrome.runtime.lastError.message});
      } else {
        sendResponse({success: true});
      }
    });

    // Return true to indicate async response
    return true;
  }

  if (request.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['userSettings'], function(result) {
      if (chrome.runtime.lastError) {
        sendResponse({success: false, error: chrome.runtime.lastError.message});
      } else {
        sendResponse({success: true, settings: result.userSettings});
      }
    });

    return true;
  }
});

// Browser action with callback (MV2 style)
chrome.browserAction.onClicked.addListener(function(tab) {
  chrome.tabs.executeScript(tab.id, {
    code: 'document.body.style.backgroundColor = "yellow";'
  }, function(result) {
    if (chrome.runtime.lastError) {
      console.error('Script injection failed:', chrome.runtime.lastError.message);
    } else {
      console.log('Script executed successfully');
    }
  });
});