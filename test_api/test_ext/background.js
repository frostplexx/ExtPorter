// Test extension with deprecated APIs
chrome.browserAction.setBadgeText({text: "test"});
chrome.extension.getURL("test.html");
chrome.tabs.executeScript({code: "console.log('test')"});
chrome.webRequest.onBeforeRequest.addListener(
  function() { return {cancel: true}; },
  {urls: ["<all_urls>"]},
  ["blocking"]
);
