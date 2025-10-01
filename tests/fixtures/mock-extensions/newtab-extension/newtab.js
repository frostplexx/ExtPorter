// New Tab Test Extension - Main script
console.log('🌟 New Tab Test Extension loaded');

// Global state
const newTabState = {
    isLoaded: false,
    startTime: Date.now(),
    widgetsLoaded: {
        clock: false,
        weather: false,
        bookmarks: false,
        topSites: false,
        recent: false,
    },
    settings: {
        showWeather: true,
        showBookmarks: true,
        showTopSites: true,
        use24HourFormat: false,
    },
    testData: {
        bookmarksTestRun: false,
        storageTestRun: false,
        errorTestRun: false,
    },
};

// DOM elements cache
const elements = {};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializeNewTab);

async function initializeNewTab() {
    console.log('🚀 Initializing New Tab page...');

    // Cache DOM elements
    cacheElements();

    // Load saved settings
    await loadSettings();

    // Initialize widgets
    initializeWidgets();

    // Set up event listeners
    setupEventListeners();

    // Mark as loaded
    newTabState.isLoaded = true;
    document.body.setAttribute('data-newtab-loaded', 'true');
    document.body.setAttribute('data-load-time', newTabState.startTime.toString());

    console.log('✅ New Tab initialization complete');
}

function cacheElements() {
    // Clock elements
    elements.timeDisplay = document.getElementById('time-display');
    elements.dateDisplay = document.getElementById('date-display');

    // Weather elements
    elements.temperature = document.getElementById('temperature');
    elements.weatherCondition = document.getElementById('weather-condition');
    elements.humidity = document.getElementById('humidity');
    elements.wind = document.getElementById('wind');

    // List elements
    elements.bookmarksList = document.getElementById('bookmarks-list');
    elements.topsitesList = document.getElementById('topsites-list');
    elements.recentList = document.getElementById('recent-list');

    // Settings elements
    elements.settingsToggle = document.getElementById('settings-toggle');
    elements.settingsContent = document.getElementById('settings-content');
    elements.weatherToggle = document.getElementById('weather-toggle');
    elements.bookmarksToggle = document.getElementById('bookmarks-toggle');
    elements.topsitesToggle = document.getElementById('topsites-toggle');
    elements.timeFormatToggle = document.getElementById('time-format-toggle');

    // Action buttons
    elements.newTabBtn = document.getElementById('new-tab-btn');
    elements.newWindowBtn = document.getElementById('new-window-btn');
    elements.bookmarksBtn = document.getElementById('bookmarks-btn');
    elements.historyBtn = document.getElementById('history-btn');

    // Test buttons
    elements.refreshDataBtn = document.getElementById('refresh-data-btn');
    elements.testBookmarksBtn = document.getElementById('test-bookmarks-btn');
    elements.testStorageBtn = document.getElementById('test-storage-btn');
    elements.testErrorBtn = document.getElementById('test-error-btn');

    console.log('📋 DOM elements cached');
}

function initializeWidgets() {
    console.log('🔧 Initializing widgets...');

    // Start clock immediately
    initializeClock();

    // Initialize other widgets with delay for realistic loading
    setTimeout(() => initializeWeather(), 500);
    setTimeout(() => initializeBookmarks(), 800);
    setTimeout(() => initializeTopSites(), 1100);
    setTimeout(() => initializeRecentActivity(), 1400);
}

function initializeClock() {
    console.log('🕐 Initializing clock widget');

    function updateClock() {
        const now = new Date();

        // Format time
        const timeOptions = {
            hour12: !newTabState.settings.use24HourFormat,
            hour: '2-digit',
            minute: '2-digit',
        };

        const timeString = now.toLocaleTimeString('en-US', timeOptions);
        elements.timeDisplay.textContent = timeString;
        elements.timeDisplay.setAttribute('data-time', timeString);

        // Format date
        const dateOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        };

        const dateString = now.toLocaleDateString('en-US', dateOptions);
        elements.dateDisplay.textContent = dateString;
        elements.dateDisplay.setAttribute('data-date', dateString);
    }

    // Update immediately and then every second
    updateClock();
    setInterval(updateClock, 1000);

    newTabState.widgetsLoaded.clock = true;
    console.log('✅ Clock widget initialized');
}

function initializeWeather() {
    console.log('🌤️ Initializing weather widget');

    // Simulate weather data (in real extension, this would come from an API)
    const mockWeatherData = {
        temperature: Math.floor(Math.random() * 30) + 60, // 60-90°F
        condition: ['Sunny', 'Partly Cloudy', 'Cloudy', 'Rainy'][Math.floor(Math.random() * 4)],
        humidity: Math.floor(Math.random() * 40) + 40, // 40-80%
        wind: Math.floor(Math.random() * 15) + 5, // 5-20 mph
    };

    // Update weather display
    elements.temperature.textContent = `${mockWeatherData.temperature}°F`;
    elements.temperature.setAttribute('data-temp', mockWeatherData.temperature.toString());

    elements.weatherCondition.textContent = mockWeatherData.condition;
    elements.weatherCondition.setAttribute('data-condition', mockWeatherData.condition);

    elements.humidity.textContent = `${mockWeatherData.humidity}%`;
    elements.humidity.setAttribute('data-humidity', mockWeatherData.humidity.toString());

    elements.wind.textContent = `${mockWeatherData.wind} mph`;
    elements.wind.setAttribute('data-wind', mockWeatherData.wind.toString());

    newTabState.widgetsLoaded.weather = true;
    console.log('✅ Weather widget initialized');
}

async function initializeBookmarks() {
    console.log('📚 Initializing bookmarks widget');

    try {
        // Get bookmarks from Chrome API
        const bookmarkTree = await chrome.bookmarks.getTree();
        const bookmarks = extractBookmarks(bookmarkTree);

        // Clear loading state
        elements.bookmarksList.innerHTML = '';

        if (bookmarks.length === 0) {
            elements.bookmarksList.innerHTML = '<div class="empty-state">No bookmarks found</div>';
        } else {
            // Display first 5 bookmarks
            bookmarks.slice(0, 5).forEach((bookmark, index) => {
                const bookmarkElement = createBookmarkElement(bookmark, index);
                elements.bookmarksList.appendChild(bookmarkElement);
            });
        }

        elements.bookmarksList.setAttribute('data-bookmark-count', bookmarks.length.toString());
        newTabState.widgetsLoaded.bookmarks = true;
        console.log(`✅ Bookmarks widget initialized with ${bookmarks.length} bookmarks`);
    } catch (error) {
        console.error('❌ Failed to load bookmarks:', error);
        elements.bookmarksList.innerHTML = '<div class="error">Failed to load bookmarks</div>';
    }
}

async function initializeTopSites() {
    console.log('⭐ Initializing top sites widget');

    try {
        // Get top sites from Chrome API
        const topSites = await chrome.topSites.get();

        // Clear loading state
        elements.topsitesList.innerHTML = '';

        if (topSites.length === 0) {
            elements.topsitesList.innerHTML = '<div class="empty-state">No top sites found</div>';
        } else {
            // Display top sites
            topSites.slice(0, 6).forEach((site, index) => {
                const siteElement = createTopSiteElement(site, index);
                elements.topsitesList.appendChild(siteElement);
            });
        }

        elements.topsitesList.setAttribute('data-topsite-count', topSites.length.toString());
        newTabState.widgetsLoaded.topSites = true;
        console.log(`✅ Top sites widget initialized with ${topSites.length} sites`);
    } catch (error) {
        console.error('❌ Failed to load top sites:', error);
        elements.topsitesList.innerHTML = '<div class="error">Failed to load top sites</div>';

        // Fallback: show mock data for testing
        showMockTopSites();
    }
}

function initializeRecentActivity() {
    console.log('🕒 Initializing recent activity widget');

    // Generate mock recent activity for testing
    const mockRecentActivity = [
        { title: 'GitHub', url: 'https://github.com', time: '2 minutes ago' },
        {
            title: 'Stack Overflow',
            url: 'https://stackoverflow.com',
            time: '15 minutes ago',
        },
        {
            title: 'MDN Web Docs',
            url: 'https://developer.mozilla.org',
            time: '1 hour ago',
        },
        {
            title: 'Chrome Extensions',
            url: 'https://developer.chrome.com',
            time: '2 hours ago',
        },
    ];

    // Clear loading state
    elements.recentList.innerHTML = '';

    mockRecentActivity.forEach((activity, index) => {
        const activityElement = createRecentActivityElement(activity, index);
        elements.recentList.appendChild(activityElement);
    });

    elements.recentList.setAttribute('data-recent-count', mockRecentActivity.length.toString());
    newTabState.widgetsLoaded.recent = true;
    console.log('✅ Recent activity widget initialized');
}

// Helper functions for creating DOM elements
function createBookmarkElement(bookmark, index) {
    const element = document.createElement('a');
    element.className = 'bookmark-item';
    element.href = bookmark.url;
    element.setAttribute('data-testid', `bookmark-${index}`);
    element.setAttribute('data-bookmark-title', bookmark.title);

    element.innerHTML = `
        <div class="item-icon">📄</div>
        <div class="item-title">${bookmark.title}</div>
    `;

    element.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: bookmark.url });
    });

    return element;
}

function createTopSiteElement(site, index) {
    const element = document.createElement('a');
    element.className = 'topsite-item';
    element.href = site.url;
    element.setAttribute('data-testid', `topsite-${index}`);
    element.setAttribute('data-site-title', site.title);

    element.innerHTML = `
        <div class="item-icon">🌐</div>
        <div class="item-title">${site.title}</div>
    `;

    element.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.update({ url: site.url });
    });

    return element;
}

function createRecentActivityElement(activity, index) {
    const element = document.createElement('div');
    element.className = 'recent-item';
    element.setAttribute('data-testid', `recent-${index}`);
    element.setAttribute('data-activity-title', activity.title);

    element.innerHTML = `
        <div class="item-icon">🕒</div>
        <div class="item-title">${activity.title}</div>
        <div style="font-size: 12px; opacity: 0.7;">${activity.time}</div>
    `;

    element.addEventListener('click', () => {
        chrome.tabs.create({ url: activity.url });
    });

    return element;
}

function showMockTopSites() {
    const mockSites = [
        { title: 'Google', url: 'https://google.com' },
        { title: 'YouTube', url: 'https://youtube.com' },
        { title: 'Gmail', url: 'https://gmail.com' },
        { title: 'GitHub', url: 'https://github.com' },
    ];

    elements.topsitesList.innerHTML = '';
    mockSites.forEach((site, index) => {
        const siteElement = createTopSiteElement(site, index);
        elements.topsitesList.appendChild(siteElement);
    });

    elements.topsitesList.setAttribute('data-topsite-count', mockSites.length.toString());
}

// Event listeners setup
function setupEventListeners() {
    console.log('📡 Setting up event listeners');

    // Settings toggle
    elements.settingsToggle.addEventListener('click', toggleSettings);

    // Settings toggles
    elements.weatherToggle.addEventListener('click', () => toggleSetting('showWeather'));
    elements.bookmarksToggle.addEventListener('click', () => toggleSetting('showBookmarks'));
    elements.topsitesToggle.addEventListener('click', () => toggleSetting('showTopSites'));
    elements.timeFormatToggle.addEventListener('click', () => toggleSetting('use24HourFormat'));

    // Quick action buttons
    elements.newTabBtn.addEventListener('click', () => chrome.tabs.create({}));
    elements.newWindowBtn.addEventListener('click', () => chrome.windows.create({}));
    elements.bookmarksBtn.addEventListener('click', () =>
        chrome.tabs.create({ url: 'chrome://bookmarks/' })
    );
    elements.historyBtn.addEventListener('click', () =>
        chrome.tabs.create({ url: 'chrome://history/' })
    );

    // Test buttons
    elements.refreshDataBtn.addEventListener('click', refreshAllData);
    elements.testBookmarksBtn.addEventListener('click', testBookmarksFunctionality);
    elements.testStorageBtn.addEventListener('click', testStorageFunctionality);
    elements.testErrorBtn.addEventListener('click', testErrorHandling);

    console.log('✅ Event listeners set up');
}

// Settings functions
function toggleSettings() {
    const isOpen = elements.settingsContent.classList.contains('open');
    elements.settingsContent.classList.toggle('open');
    elements.settingsToggle.setAttribute('data-open', (!isOpen).toString());

    console.log(`⚙️ Settings ${isOpen ? 'closed' : 'opened'}`);
}

function toggleSetting(settingName) {
    newTabState.settings[settingName] = !newTabState.settings[settingName];

    // Update toggle visual state
    const toggleElement = document.getElementById(
        `${settingName.replace(/([A-Z])/g, '-$1').toLowerCase()}-toggle`
    );
    if (toggleElement) {
        toggleElement.classList.toggle('active', newTabState.settings[settingName]);
        toggleElement.setAttribute('data-active', newTabState.settings[settingName].toString());
    }

    // Apply setting changes
    applySettingChange(settingName);

    // Save settings
    saveSettings();

    console.log(`⚙️ Setting ${settingName} changed to:`, newTabState.settings[settingName]);
}

function applySettingChange(settingName) {
    switch (settingName) {
        case 'showWeather':
            const weatherWidget = document.querySelector('[data-testid="weather-widget"]');
            weatherWidget.style.display = newTabState.settings.showWeather ? 'block' : 'none';
            break;

        case 'showBookmarks':
            const bookmarksWidget = document.querySelector('[data-testid="bookmarks-widget"]');
            bookmarksWidget.style.display = newTabState.settings.showBookmarks ? 'block' : 'none';
            break;

        case 'showTopSites':
            const topsitesWidget = document.querySelector('[data-testid="topsites-widget"]');
            topsitesWidget.style.display = newTabState.settings.showTopSites ? 'block' : 'none';
            break;

        case 'use24HourFormat':
            // Clock will update on next tick
            break;
    }
}

// Test functions
async function refreshAllData() {
    console.log('🔄 Refreshing all data');

    elements.refreshDataBtn.textContent = '🔄 Refreshing...';
    elements.refreshDataBtn.disabled = true;

    try {
        // Re-initialize widgets
        await initializeBookmarks();
        await initializeTopSites();
        initializeRecentActivity();

        elements.refreshDataBtn.textContent = '✅ Refreshed';
        setTimeout(() => {
            elements.refreshDataBtn.textContent = '🔄 Refresh Data';
            elements.refreshDataBtn.disabled = false;
        }, 2000);
    } catch (error) {
        console.error('❌ Refresh failed:', error);
        elements.refreshDataBtn.textContent = '❌ Failed';
        setTimeout(() => {
            elements.refreshDataBtn.textContent = '🔄 Refresh Data';
            elements.refreshDataBtn.disabled = false;
        }, 2000);
    }
}

async function testBookmarksFunctionality() {
    console.log('📚 Testing bookmarks functionality');

    elements.testBookmarksBtn.textContent = '📚 Testing...';
    elements.testBookmarksBtn.disabled = true;

    try {
        // Try to get bookmarks
        const bookmarkTree = await chrome.bookmarks.getTree();
        const bookmarks = extractBookmarks(bookmarkTree);

        // Create a test bookmark folder (optional)
        newTabState.testData.bookmarksTestRun = true;

        elements.testBookmarksBtn.textContent = `✅ ${bookmarks.length} found`;
        elements.testBookmarksBtn.setAttribute('data-test-result', 'success');
        elements.testBookmarksBtn.setAttribute('data-bookmark-count', bookmarks.length.toString());

        setTimeout(() => {
            elements.testBookmarksBtn.textContent = '📚 Test Bookmarks';
            elements.testBookmarksBtn.disabled = false;
        }, 3000);
    } catch (error) {
        console.error('❌ Bookmarks test failed:', error);
        elements.testBookmarksBtn.textContent = '❌ Failed';
        elements.testBookmarksBtn.setAttribute('data-test-result', 'error');

        setTimeout(() => {
            elements.testBookmarksBtn.textContent = '📚 Test Bookmarks';
            elements.testBookmarksBtn.disabled = false;
        }, 3000);
    }
}

async function testStorageFunctionality() {
    console.log('💾 Testing storage functionality');

    elements.testStorageBtn.textContent = '💾 Testing...';
    elements.testStorageBtn.disabled = true;

    try {
        // Test data
        const testData = {
            testTime: Date.now(),
            testString: 'New Tab Test Extension',
            testNumber: Math.random(),
        };

        // Save test data
        await chrome.storage.sync.set({ newTabTest: testData });

        // Retrieve test data
        const result = await chrome.storage.sync.get(['newTabTest']);

        // Verify data integrity
        const retrieved = result.newTabTest;
        const isValid =
            retrieved &&
            retrieved.testTime === testData.testTime &&
            retrieved.testString === testData.testString &&
            retrieved.testNumber === testData.testNumber;

        if (isValid) {
            newTabState.testData.storageTestRun = true;
            elements.testStorageBtn.textContent = '✅ Success';
            elements.testStorageBtn.setAttribute('data-test-result', 'success');
        } else {
            elements.testStorageBtn.textContent = '❌ Data Mismatch';
            elements.testStorageBtn.setAttribute('data-test-result', 'error');
        }

        setTimeout(() => {
            elements.testStorageBtn.textContent = '💾 Test Storage';
            elements.testStorageBtn.disabled = false;
        }, 3000);
    } catch (error) {
        console.error('❌ Storage test failed:', error);
        elements.testStorageBtn.textContent = '❌ Failed';
        elements.testStorageBtn.setAttribute('data-test-result', 'error');

        setTimeout(() => {
            elements.testStorageBtn.textContent = '💾 Test Storage';
            elements.testStorageBtn.disabled = false;
        }, 3000);
    }
}

function testErrorHandling() {
    console.log('❌ Testing error handling');

    elements.testErrorBtn.textContent = '❌ Testing...';
    elements.testErrorBtn.disabled = true;

    try {
        // Intentionally cause an error for testing
        throw new Error('Intentional test error for Puppeteer testing');
    } catch (error) {
        console.error('🧪 Test error caught (expected):', error);

        newTabState.testData.errorTestRun = true;
        elements.testErrorBtn.textContent = '✅ Error Caught';
        elements.testErrorBtn.setAttribute('data-test-result', 'success');
        elements.testErrorBtn.setAttribute('data-error-message', error.message);

        setTimeout(() => {
            elements.testErrorBtn.textContent = '❌ Test Error';
            elements.testErrorBtn.disabled = false;
        }, 3000);
    }
}

// Utility functions
function extractBookmarks(bookmarkTree, result = []) {
    bookmarkTree.forEach((node) => {
        if (node.url) {
            result.push({ title: node.title, url: node.url });
        } else if (node.children) {
            extractBookmarks(node.children, result);
        }
    });
    return result;
}

async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get(['newTabSettings']);
        if (result.newTabSettings) {
            newTabState.settings = {
                ...newTabState.settings,
                ...result.newTabSettings,
            };
        }

        // Apply loaded settings to UI
        elements.weatherToggle.classList.toggle('active', newTabState.settings.showWeather);
        elements.bookmarksToggle.classList.toggle('active', newTabState.settings.showBookmarks);
        elements.topsitesToggle.classList.toggle('active', newTabState.settings.showTopSites);
        elements.timeFormatToggle.classList.toggle('active', newTabState.settings.use24HourFormat);

        console.log('📁 Settings loaded:', newTabState.settings);
    } catch (error) {
        console.error('❌ Failed to load settings:', error);
    }
}

async function saveSettings() {
    try {
        await chrome.storage.sync.set({ newTabSettings: newTabState.settings });
        console.log('💾 Settings saved');
    } catch (error) {
        console.error('❌ Failed to save settings:', error);
    }
}

// Export for testing
window.newTabTestExtension = {
    state: () => newTabState,
    settings: () => newTabState.settings,
    widgets: () => newTabState.widgetsLoaded,
    testData: () => newTabState.testData,
    refreshData: refreshAllData,
    toggleSetting: toggleSetting,
    extractBookmarks: extractBookmarks,
};

console.log('✅ New Tab script setup complete');
