function notify(message) {
  console.log("cs Received: ", message);
  window.postMessage({
    type: "FROM_CS",
    text: message
  }, "*");
}

chrome.runtime.onMessage.addListener(notify);

window.addEventListener("message", function(event) {
  // We only accept messages from ourselves
  if (event.source != window)
    return;

  if (event.data.type && (event.data.type == "FROM_PAGE")) {
    console.log('method:', event.data.method);
    chrome.runtime.sendMessage(event.data.text);
  }
}, false);
