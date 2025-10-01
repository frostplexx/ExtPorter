import { Extension } from '../../migrator/types/extension';
import { LazyFile } from '../../migrator/types/abstract_file';
import { ExtFileType } from '../../migrator/types/ext_file_types';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface TestExtensionFixture {
    name: string;
    manifest: any;
    files: Array<{
        path: string;
        content: string;
        type: ExtFileType;
    }>;
}

export const SAMPLE_EXTENSIONS: TestExtensionFixture[] = [
    {
        name: 'simple-extension',
        manifest: {
            name: 'Simple Extension',
            version: '1.0.0',
            manifest_version: 2,
            description: 'A simple test extension',
            permissions: ['activeTab', 'storage'],
            browser_action: {
                default_popup: 'popup.html',
                default_title: 'Simple Extension',
            },
            background: {
                scripts: ['background.js'],
                persistent: false,
            },
            content_scripts: [
                {
                    matches: ['<all_urls>'],
                    js: ['content.js'],
                },
            ],
        },
        files: [
            {
                path: 'background.js',
                content: `
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

chrome.browserAction.onClicked.addListener((tab) => {
  chrome.tabs.executeScript(tab.id, {
    code: 'document.body.style.backgroundColor = "yellow";'
  });
});
        `,
                type: ExtFileType.JS,
            },
            {
                path: 'content.js',
                content: `
console.log('Content script loaded');

// Add a simple observer
const observer = new MutationObserver((mutations) => {
  console.log('DOM mutations observed:', mutations.length);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
        `,
                type: ExtFileType.JS,
            },
            {
                path: 'popup.html',
                content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      width: 300px;
      height: 200px;
      padding: 20px;
    }
    button {
      width: 100%;
      padding: 10px;
      margin: 5px 0;
    }
  </style>
</head>
<body>
  <h1>Simple Extension</h1>
  <button id="action-btn">Perform Action</button>
  <script migrator="popup.js"></script>
</body>
</html>
        `,
                type: ExtFileType.HTML,
            },
            {
                path: 'popup.js',
                content: `
document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('action-btn');

  button.addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.tabs.executeScript(tabs[0].id, {
        code: 'alert("Hello from popup!");'
      });
    });
  });
});
        `,
                type: ExtFileType.JS,
            },
        ],
    },
    {
        name: 'complex-extension',
        manifest: {
            name: 'Complex Extension',
            version: '2.1.0',
            manifest_version: 2,
            description: 'A complex test extension with multiple features',
            permissions: [
                'activeTab',
                'storage',
                'webRequestBlocking',
                'http://example.com/*',
                'https://api.example.com/*',
            ],
            web_accessible_resources: ['images/*', 'css/injected.css'],
            browser_action: {
                default_popup: 'popup.html',
                default_title: 'Complex Extension',
                default_icon: {
                    16: 'icons/icon16.png',
                    48: 'icons/icon48.png',
                    128: 'icons/icon128.png',
                },
            },
            page_action: {
                default_title: 'Page Action',
            },
            background: {
                scripts: ['background.js', 'utils.js'],
                persistent: false,
            },
            content_scripts: [
                {
                    matches: ['*://*.example.com/*'],
                    js: ['content.js'],
                    css: ['content.css'],
                },
            ],
            options_page: 'options.html',
        },
        files: [
            {
                path: 'background.js',
                content: `
// Complex background script with multiple APIs
const API_URL = 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      apiUrl: API_URL,
      isEnabled: true
    });
  }
});

// Web request handling
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.includes('unwanted-tracker')) {
      return { cancel: true };
    }
  },
  { urls: ['<all_urls>'] },
  ['blocking']
);

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getData') {
    chrome.storage.sync.get(['apiUrl'], (result) => {
      sendResponse({ data: result.apiUrl });
    });
    return true;
  }
});
        `,
                type: ExtFileType.JS,
            },
            {
                path: 'utils.js',
                content: `
// Utility functions
function loadExternalResource(url) {
  if (url.includes('cdn.jsdelivr.net')) {
    console.log('Loading from jsDelivr:', url);
  }

  return fetch(url)
    .then(response => response.text())
    .catch(error => console.error('Failed to load resource:', error));
}

function injectCSS(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

// Export for background script
window.extensionUtils = {
  loadExternalResource,
  injectCSS
};
        `,
                type: ExtFileType.JS,
            },
            {
                path: 'content.js',
                content: `
// Content script with remote resource usage
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap';
const CDN_LIBRARY = 'https://unpkg.com/lodash@4.17.21/lodash.min.js';

// Load external font
if (!document.querySelector('link[href*="googleapis"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_URL;
  document.head.appendChild(link);
}

// Communication with background
chrome.runtime.sendMessage({action: 'getData'}, (response) => {
  if (response && response.data) {
    console.log('Received data from background:', response.data);
  }
});

// Page modification
function enhancePage() {
  const style = document.createElement('style');
  style.textContent = \`
    body {
      font-family: 'Inter', sans-serif !important;
      background-image: url('https://images.unsplash.com/photo-1234567890');
    }
  \`;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enhancePage);
} else {
  enhancePage();
}
        `,
                type: ExtFileType.JS,
            },
            {
                path: 'content.css',
                content: `
/* Content CSS with external resources */
@import url('https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css');

.extension-widget {
  position: fixed;
  top: 10px;
  right: 10px;
  background: white;
  border: 1px solid #ccc;
  border-radius: 5px;
  padding: 10px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  z-index: 9999;
  font-family: 'Roboto', sans-serif;
}

.extension-widget::before {
  content: '';
  background-image: url('https://cdn.jsdelivr.net/gh/user/repo/icon.svg');
  width: 16px;
  height: 16px;
  display: inline-block;
}
        `,
                type: ExtFileType.CSS,
            },
            {
                path: 'popup.html',
                content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Complex Extension Popup</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    body {
      width: 350px;
      height: 400px;
      padding: 20px;
      font-family: 'Arial', sans-serif;
    }
    .header {
      background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px;
      margin: -20px -20px 20px -20px;
      border-radius: 5px 5px 0 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1><i class="fas fa-puzzle-piece"></i> Complex Extension</h1>
  </div>

  <div class="content">
    <div class="section">
      <h3>Settings</h3>
      <label>
        <input type="checkbox" id="enable-feature"> Enable Feature
      </label>
    </div>

    <div class="section">
      <h3>Actions</h3>
      <button id="perform-action" class="btn btn-primary">
        <i class="fas fa-play"></i> Perform Action
      </button>
    </div>
  </div>

  <script migrator="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  <script migrator="popup.js"></script>
</body>
</html>
        `,
                type: ExtFileType.HTML,
            },
        ],
    },
    {
        name: 'newtab-extension',
        manifest: {
            name: 'New Tab Extension',
            version: '1.5.0',
            manifest_version: 2,
            description: 'A new tab replacement extension',
            permissions: ['storage', 'bookmarks'],
            chrome_url_overrides: {
                newtab: 'newtab.html',
            },
            background: {
                scripts: ['background.js'],
                persistent: false,
            },
        },
        files: [
            {
                path: 'newtab.html',
                content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>New Tab</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      font-family: 'Poppins', sans-serif;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
      max-width: 800px;
      padding: 40px;
    }
    h1 {
      font-size: 3em;
      margin-bottom: 20px;
      font-weight: 300;
    }
    .widgets {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-top: 40px;
    }
    .widget {
      background: rgba(255, 255, 255, 0.1);
      padding: 20px;
      border-radius: 10px;
      backdrop-filter: blur(10px);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Welcome to Your New Tab</h1>
    <p>A beautiful and functional new tab page</p>

    <div class="widgets">
      <div class="widget">
        <h3>Bookmarks</h3>
        <div id="bookmarks-list"></div>
      </div>

      <div class="widget">
        <h3>Weather</h3>
        <div id="weather-info">Loading...</div>
      </div>

      <div class="widget">
        <h3>Quick Links</h3>
        <div id="quick-links"></div>
      </div>
    </div>
  </div>

  <script migrator="newtab.js"></script>
</body>
</html>
        `,
                type: ExtFileType.HTML,
            },
            {
                path: 'newtab.js',
                content: `
// New tab page functionality
document.addEventListener('DOMContentLoaded', () => {
  loadBookmarks();
  loadWeather();
  loadQuickLinks();
});

function loadBookmarks() {
  chrome.bookmarks.getTree((bookmarkTree) => {
    const bookmarksList = document.getElementById('bookmarks-list');
    const bookmarks = extractBookmarks(bookmarkTree);

    bookmarks.slice(0, 5).forEach(bookmark => {
      const link = document.createElement('a');
      link.href = bookmark.url;
      link.textContent = bookmark.title;
      link.style.display = 'block';
      link.style.marginBottom = '5px';
      link.style.color = 'white';
      bookmarksList.appendChild(link);
    });
  });
}

function loadWeather() {
  // Simulated weather data (would normally fetch from API)
  const weatherInfo = document.getElementById('weather-info');
  weatherInfo.innerHTML = \`
    <div>Sunny, 72°F</div>
    <div>San Francisco, CA</div>
  \`;
}

function loadQuickLinks() {
  const quickLinks = [
    { name: 'Gmail', url: 'https://gmail.com' },
    { name: 'GitHub', url: 'https://github.com' },
    { name: 'Stack Overflow', url: 'https://stackoverflow.com' }
  ];

  const quickLinksContainer = document.getElementById('quick-links');
  quickLinks.forEach(link => {
    const a = document.createElement('a');
    a.href = link.url;
    a.textContent = link.name;
    a.style.display = 'block';
    a.style.marginBottom = '5px';
    a.style.color = 'white';
    quickLinksContainer.appendChild(a);
  });
}

function extractBookmarks(bookmarkTree, result = []) {
  bookmarkTree.forEach(node => {
    if (node.url) {
      result.push({ title: node.title, url: node.url });
    } else if (node.children) {
      extractBookmarks(node.children, result);
    }
  });
  return result;
}
        `,
                type: ExtFileType.JS,
            },
            {
                path: 'background.js',
                content: `
// Background script for new tab extension
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    newTabEnabled: true,
    showWeather: true,
    showBookmarks: true
  });
});

// Handle settings changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    console.log('Settings changed:', changes);
  }
});
        `,
                type: ExtFileType.JS,
            },
        ],
    },
];

/**
 * Creates test extension files in the specified directory
 */
export function createTestExtension(fixture: TestExtensionFixture, baseDir: string): Extension {
    const extensionDir = path.join(baseDir, fixture.name);
    fs.ensureDirSync(extensionDir);

    // Write manifest
    fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), fixture.manifest, {
        spaces: 2,
    });

    // Create lazy files
    const lazyFiles: LazyFile[] = [];

    fixture.files.forEach((file) => {
        const filePath = path.join(extensionDir, file.path);
        fs.ensureDirSync(path.dirname(filePath));
        fs.writeFileSync(filePath, file.content.trim());

        lazyFiles.push(new LazyFile(file.path, filePath, file.type));
    });

    return {
        id: `test-${fixture.name}`,
        name: fixture.name,
        manifest_v2_path: extensionDir,
        manifest: fixture.manifest,
        files: lazyFiles,
    };
}

/**
 * Creates multiple test extensions from fixtures
 */
export function createTestExtensions(
    fixtures: TestExtensionFixture[],
    baseDir: string
): Extension[] {
    return fixtures.map((fixture) => createTestExtension(fixture, baseDir));
}
