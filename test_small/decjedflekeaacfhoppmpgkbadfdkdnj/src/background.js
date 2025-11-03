importScripts('ext_bridge.js');
var port;

function ensureConnection() {

  if (port)
    return;

  console.log('bg connect');

  port = chrome.runtime.connectNative("com.goldcard.china.www");

  port.onDisconnect.addListener(function() {
    port = null;
  });
  
  port.onMessage.addListener((response) => {
      console.log("bg Received: ", response);
      if (response.code == '0') {
        chrome.tabs.sendMessage(response.request.tabId, {
          ...response
        });
      }
  });
}

ensureConnection()

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    try {
      if (!request)
        return

      //console.log('request', request);
      if (request.connect) {
        ensureConnection();
      } else if (request.cmd) {
        if (port) {
          console.log('bg postMessage');
          port.postMessage({
            ...request,
            "tabId": sender.tab.id
          });
        } else {
          chrome.tabs.sendMessage(sender.tab.id, {
            "err": "not connected",
            "request": {
              ...request
            }
          });
        }
      } else {}
    } catch (err) {
      console.log("err:", err.message);
      if (sender.tab.id)
        chrome.tabs.sendMessage(sender.tab.id, {
          "err": "exception",
          "request": {
            ...request
          }
        });
    }
  }
);