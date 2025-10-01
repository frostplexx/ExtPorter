// Content script with callback-based Chrome APIs

// Listen for messages from background script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.type === 'GET_PAGE_INFO') {
    // Get page information and send back
    const pageInfo = {
      title: document.title,
      url: window.location.href,
      timestamp: Date.now()
    };

    sendResponse(pageInfo);
  }

  if (request.type === 'HIGHLIGHT_LINKS') {
    // Highlight all links on the page
    const links = document.querySelectorAll('a');
    links.forEach(link => {
      link.style.backgroundColor = 'yellow';
    });

    sendResponse({count: links.length});
  }
});

// Storage operations with callbacks
function savePageData() {
  const pageData = {
    title: document.title,
    url: window.location.href,
    visitTime: Date.now(),
    wordCount: document.body.innerText.split(/\s+/).length
  };

  chrome.runtime.sendMessage({
    type: 'SAVE_DATA',
    data: pageData
  }, function(response) {
    if (chrome.runtime.lastError) {
      console.error('Failed to save data:', chrome.runtime.lastError.message);
    } else if (response.success) {
      console.log('Page data saved successfully');
    } else {
      console.error('Server error:', response.error);
    }
  });
}

// Get user settings with callback
function applyUserSettings() {
  chrome.runtime.sendMessage({
    type: 'GET_SETTINGS'
  }, function(response) {
    if (chrome.runtime.lastError) {
      console.error('Failed to get settings:', chrome.runtime.lastError.message);
      return;
    }

    if (response.success && response.settings) {
      if (response.settings.theme === 'dark') {
        document.body.style.filter = 'invert(1)';
      }

      if (response.settings.autoSync) {
        savePageData();
      }
    }
  });
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyUserSettings);
} else {
  applyUserSettings();
}