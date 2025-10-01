// Popup Test Extension - Main popup script
console.log("🔧 Popup script loaded");

// State management
let counter = 0;
let settings = {
  autoInject: false,
  debugMode: false,
  notifications: true,
};

// DOM elements
const elements = {
  counter: null,
  status: null,
  buttons: {},
  checkboxes: {},
};

// Initialize popup when DOM is ready
document.addEventListener("DOMContentLoaded", initializePopup);

async function initializePopup() {
  console.log("🚀 Initializing popup...");

  // Get DOM elements
  elements.counter = document.getElementById("counter");
  elements.status = document.getElementById("status");

  // Get buttons
  elements.buttons = {
    injectContent: document.getElementById("inject-content"),
    highlightPage: document.getElementById("highlight-page"),
    changeBackground: document.getElementById("change-background"),
    showAlert: document.getElementById("show-alert"),
    increment: document.getElementById("increment"),
    decrement: document.getElementById("decrement"),
    reset: document.getElementById("reset"),
  };

  // Get checkboxes
  elements.checkboxes = {
    autoInject: document.getElementById("auto-inject"),
    debugMode: document.getElementById("debug-mode"),
    notifications: document.getElementById("notifications"),
  };

  // Load saved settings
  await loadSettings();

  // Set up event listeners
  setupEventListeners();

  // Update UI
  updateCounterDisplay();
  updateStatus("Popup initialized successfully", "success");

  console.log("✅ Popup initialization complete");
}

function setupEventListeners() {
  // Action buttons
  elements.buttons.injectContent.addEventListener("click", handleInjectContent);
  elements.buttons.highlightPage.addEventListener("click", handleHighlightPage);
  elements.buttons.changeBackground.addEventListener(
    "click",
    handleChangeBackground,
  );
  elements.buttons.showAlert.addEventListener("click", handleShowAlert);

  // Counter buttons
  elements.buttons.increment.addEventListener("click", handleIncrement);
  elements.buttons.decrement.addEventListener("click", handleDecrement);
  elements.buttons.reset.addEventListener("click", handleReset);

  // Settings checkboxes
  elements.checkboxes.autoInject.addEventListener(
    "change",
    handleAutoInjectChange,
  );
  elements.checkboxes.debugMode.addEventListener(
    "change",
    handleDebugModeChange,
  );
  elements.checkboxes.notifications.addEventListener(
    "change",
    handleNotificationsChange,
  );

  console.log("📡 Event listeners set up");
}

// Action handlers
async function handleInjectContent() {
  updateStatus("Injecting content script...", "info");
  setButtonState("injectContent", false);

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    await chrome.tabs.executeScript(tab.id, {
      code: `
                console.log('💉 Content script injected via popup');

                // Create and show injection indicator
                const indicator = document.createElement('div');
                indicator.textContent = '✅ Content Script Injected!';
                indicator.style.cssText = \`
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #48bb78;
                    color: white;
                    padding: 10px 15px;
                    border-radius: 6px;
                    z-index: 10000;
                    font-family: sans-serif;
                    font-size: 14px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                \`;
                document.body.appendChild(indicator);

                // Remove indicator after 3 seconds
                setTimeout(() => {
                    if (indicator.parentNode) {
                        indicator.parentNode.removeChild(indicator);
                    }
                }, 3000);

                // Signal injection success
                'INJECTION_SUCCESS';
            `,
    });

    updateStatus("Content script injected successfully!", "success");
    console.log("✅ Content script injection successful");
  } catch (error) {
    console.error("❌ Content script injection failed:", error);
    updateStatus(`Injection failed: ${error.message}`, "error");
  } finally {
    setButtonState("injectContent", true);
  }
}

async function handleHighlightPage() {
  updateStatus("Highlighting page elements...", "info");
  setButtonState("highlightPage", false);

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    await chrome.tabs.executeScript(tab.id, {
      code: `
                console.log('🎨 Highlighting page elements');

                // Add highlight styles
                const style = document.createElement('style');
                style.textContent = \`
                    .popup-test-highlight {
                        outline: 3px solid #ff6b6b !important;
                        outline-offset: 2px !important;
                        animation: pulse-highlight 2s infinite !important;
                    }
                    @keyframes pulse-highlight {
                        0%, 100% { outline-color: #ff6b6b; }
                        50% { outline-color: #4ecdc4; }
                    }
                \`;
                document.head.appendChild(style);

                // Highlight various elements
                const selectors = ['h1', 'h2', 'button', 'a', 'input'];
                let highlightCount = 0;

                selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(element => {
                        element.classList.add('popup-test-highlight');
                        highlightCount++;
                    });
                });

                // Show highlight count
                const counter = document.createElement('div');
                counter.textContent = \`🎯 Highlighted \${highlightCount} elements\`;
                counter.style.cssText = \`
                    position: fixed;
                    top: 20px;
                    left: 20px;
                    background: #4ecdc4;
                    color: white;
                    padding: 10px 15px;
                    border-radius: 6px;
                    z-index: 10000;
                    font-family: sans-serif;
                    font-size: 14px;
                \`;
                document.body.appendChild(counter);

                // Remove highlights and counter after 5 seconds
                setTimeout(() => {
                    document.querySelectorAll('.popup-test-highlight').forEach(el => {
                        el.classList.remove('popup-test-highlight');
                    });
                    if (counter.parentNode) {
                        counter.parentNode.removeChild(counter);
                    }
                    if (style.parentNode) {
                        style.parentNode.removeChild(style);
                    }
                }, 5000);

                highlightCount;
            `,
    });

    updateStatus("Page elements highlighted successfully!", "success");
    console.log("✅ Page highlighting successful");
  } catch (error) {
    console.error("❌ Page highlighting failed:", error);
    updateStatus(`Highlighting failed: ${error.message}`, "error");
  } finally {
    setButtonState("highlightPage", true);
  }
}

async function handleChangeBackground() {
  updateStatus("Changing page background...", "info");
  setButtonState("changeBackground", false);

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const colors = [
      "#ff6b6b",
      "#4ecdc4",
      "#45b7d1",
      "#96ceb4",
      "#ffeaa7",
      "#dda0dd",
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    await chrome.tabs.executeScript(tab.id, {
      code: `
                console.log('🎨 Changing page background color');

                // Store original background
                if (!document.body.dataset.originalBackground) {
                    document.body.dataset.originalBackground = window.getComputedStyle(document.body).backgroundColor;
                }

                // Apply new background
                document.body.style.backgroundColor = '${randomColor}';
                document.body.style.transition = 'background-color 0.5s ease';

                // Show color indicator
                const indicator = document.createElement('div');
                indicator.textContent = '🎨 Background: ${randomColor}';
                indicator.style.cssText = \`
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: rgba(0,0,0,0.8);
                    color: white;
                    padding: 10px 15px;
                    border-radius: 6px;
                    z-index: 10000;
                    font-family: sans-serif;
                    font-size: 14px;
                \`;
                document.body.appendChild(indicator);

                // Remove indicator after 3 seconds
                setTimeout(() => {
                    if (indicator.parentNode) {
                        indicator.parentNode.removeChild(indicator);
                    }
                }, 3000);

                '${randomColor}';
            `,
    });

    updateStatus(`Background changed to ${randomColor}!`, "success");
    console.log("✅ Background change successful");
  } catch (error) {
    console.error("❌ Background change failed:", error);
    updateStatus(`Background change failed: ${error.message}`, "error");
  } finally {
    setButtonState("changeBackground", true);
  }
}

async function handleShowAlert() {
  updateStatus("Showing page alert...", "info");
  setButtonState("showAlert", false);

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    await chrome.tabs.executeScript(tab.id, {
      code: `
                console.log('🚨 Showing custom alert');

                // Create custom alert overlay
                const overlay = document.createElement('div');
                overlay.style.cssText = \`
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0,0,0,0.5);
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                \`;

                const alertBox = document.createElement('div');
                alertBox.style.cssText = \`
                    background: white;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    text-align: center;
                    max-width: 400px;
                    animation: alertSlideIn 0.3s ease;
                \`;

                // Add animation
                const style = document.createElement('style');
                style.textContent = \`
                    @keyframes alertSlideIn {
                        from { transform: scale(0.7); opacity: 0; }
                        to { transform: scale(1); opacity: 1; }
                    }
                \`;
                document.head.appendChild(style);

                alertBox.innerHTML = \`
                    <h2 style="margin: 0 0 15px 0; color: #333;">🎉 Test Alert</h2>
                    <p style="margin: 0 0 20px 0; color: #666;">This alert was triggered by the popup extension!</p>
                    <button id="close-alert" style="
                        background: #667eea;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 5px;
                        cursor: pointer;
                        font-size: 14px;
                    ">Close Alert</button>
                \`;

                overlay.appendChild(alertBox);
                document.body.appendChild(overlay);

                // Close button functionality
                alertBox.querySelector('#close-alert').addEventListener('click', () => {
                    overlay.style.animation = 'alertSlideIn 0.3s ease reverse';
                    setTimeout(() => {
                        if (overlay.parentNode) {
                            overlay.parentNode.removeChild(overlay);
                        }
                        if (style.parentNode) {
                            style.parentNode.removeChild(style);
                        }
                    }, 300);
                });

                // Auto-close after 5 seconds
                setTimeout(() => {
                    if (overlay.parentNode) {
                        overlay.click();
                    }
                }, 5000);

                'ALERT_SHOWN';
            `,
    });

    updateStatus("Custom alert displayed successfully!", "success");
    console.log("✅ Alert display successful");
  } catch (error) {
    console.error("❌ Alert display failed:", error);
    updateStatus(`Alert failed: ${error.message}`, "error");
  } finally {
    setButtonState("showAlert", true);
  }
}

// Counter handlers
function handleIncrement() {
  counter++;
  updateCounterDisplay();
  updateStatus(`Counter incremented to ${counter}`, "info");
  saveSettings();
}

function handleDecrement() {
  counter--;
  updateCounterDisplay();
  updateStatus(`Counter decremented to ${counter}`, "info");
  saveSettings();
}

function handleReset() {
  counter = 0;
  updateCounterDisplay();
  updateStatus("Counter reset to 0", "info");
  saveSettings();
}

// Settings handlers
function handleAutoInjectChange() {
  settings.autoInject = elements.checkboxes.autoInject.checked;
  updateStatus(
    `Auto-inject ${settings.autoInject ? "enabled" : "disabled"}`,
    "info",
  );
  saveSettings();
}

function handleDebugModeChange() {
  settings.debugMode = elements.checkboxes.debugMode.checked;
  updateStatus(
    `Debug mode ${settings.debugMode ? "enabled" : "disabled"}`,
    "info",
  );
  saveSettings();
}

function handleNotificationsChange() {
  settings.notifications = elements.checkboxes.notifications.checked;
  updateStatus(
    `Notifications ${settings.notifications ? "enabled" : "disabled"}`,
    "info",
  );
  saveSettings();
}

// Utility functions
function updateCounterDisplay() {
  if (elements.counter) {
    elements.counter.textContent = counter;
    elements.counter.setAttribute("data-value", counter);
  }
}

function updateStatus(message, type = "info") {
  if (elements.status) {
    elements.status.textContent = message;
    elements.status.className = `status ${type}`;
    elements.status.setAttribute("data-status", type);
    elements.status.setAttribute("data-message", message);
  }

  if (settings.debugMode) {
    console.log(`📊 Status: ${type.toUpperCase()} - ${message}`);
  }
}

function setButtonState(buttonName, enabled) {
  const button = elements.buttons[buttonName];
  if (button) {
    button.disabled = !enabled;
    button.setAttribute("data-enabled", enabled.toString());
  }
}

// Storage functions
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(["counter", "settings"]);

    if (result.counter !== undefined) {
      counter = result.counter;
    }

    if (result.settings) {
      settings = { ...settings, ...result.settings };
    }

    // Update UI with loaded settings
    elements.checkboxes.autoInject.checked = settings.autoInject;
    elements.checkboxes.debugMode.checked = settings.debugMode;
    elements.checkboxes.notifications.checked = settings.notifications;

    console.log("📁 Settings loaded:", { counter, settings });
  } catch (error) {
    console.error("❌ Failed to load settings:", error);
  }
}

async function saveSettings() {
  try {
    await chrome.storage.sync.set({
      counter: counter,
      settings: settings,
    });

    if (settings.debugMode) {
      console.log("💾 Settings saved:", { counter, settings });
    }
  } catch (error) {
    console.error("❌ Failed to save settings:", error);
  }
}

// Export for testing
if (typeof window !== "undefined") {
  window.popupTestExtension = {
    counter: () => counter,
    settings: () => settings,
    elements: () => elements,
    updateStatus,
    setButtonState,
  };
}
