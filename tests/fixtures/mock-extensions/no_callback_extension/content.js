// Content script with non-callback Chrome APIs

// Direct URL access
const imageUrl = chrome.runtime.getURL("images/icon.png");
console.log("Image URL:", imageUrl);

// Event listeners (not callback-based)
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.type === "GET_PAGE_INFO") {
    sendResponse({
      title: document.title,
      url: window.location.href,
    });
  }
});

// DOM manipulation without Chrome API callbacks
function highlightPage() {
  document.body.style.border = "3px solid red";
  console.log("Page highlighted");
}

// Simple operations
function logPageInfo() {
  console.log("Page title:", document.title);
  console.log("Page URL:", window.location.href);
  console.log("Extension ID:", chrome.runtime.id);
}

// Initialize
highlightPage();
logPageInfo();
