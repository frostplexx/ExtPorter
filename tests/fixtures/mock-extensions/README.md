# Mock Browser Extensions for Testing

This directory contains two comprehensive mock browser extensions designed specifically for testing the Puppeteer testing framework and validating extension migration functionality.

## Extensions Overview

### 1. Popup Extension (`popup-extension/`)

A full-featured browser extension with an interactive popup interface that demonstrates:

**Features:**
- **Interactive Popup UI**: Counter with increment/decrement functionality
- **Content Script Injection**: Floating indicator with real-time status updates
- **Page Interaction**: Element highlighting, background color changes
- **Settings Management**: Persistent settings with Chrome storage API
- **Message Passing**: Communication between popup, content script, and background
- **DOM Manipulation**: Dynamic element creation and styling

**Testing Capabilities:**
- Comprehensive `data-testid` attributes for automated testing
- State persistence testing with Chrome storage
- Content script injection validation
- Background script message handling tests
- UI interaction and feedback testing

**Files:**
- `manifest.json` - Manifest V2 extension configuration
- `popup.html` - Interactive popup interface
- `popup.js` - Popup logic with testing hooks
- `background.js` - Background script with message handling
- `content.js` - Content script with page interaction features
- `content.css` - Styles with animations and responsive design

### 2. New Tab Extension (`newtab-extension/`)

A complete dashboard replacement for the new tab page with multiple widgets:

**Features:**
- **Real-time Clock**: 12/24 hour format with live updates
- **Weather Widget**: Mock weather data with temperature and conditions
- **Bookmarks Integration**: Live Chrome bookmarks API integration
- **Top Sites Widget**: Most visited sites with fallback mock data
- **Quick Actions**: New tab, bookmarks, history navigation
- **Settings Panel**: Widget visibility controls and preferences
- **Recent Activity**: Browser history integration

**Testing Capabilities:**
- Chrome API integration testing (bookmarks, topSites, storage)
- Widget visibility and interaction testing
- Settings persistence validation
- Real-time data update testing
- Responsive design validation

**Files:**
- `manifest.json` - New tab override configuration
- `newtab.html` - Complete dashboard interface
- `newtab.js` - Dashboard functionality with Chrome API integration
- `background.js` - Background script for new tab extension

## Puppeteer Testing

### Running Tests

```bash
# Run all tests
npm run test

# Run only Puppeteer tests
npm run test:puppeteer

# Run with coverage
npm run test:coverage
```

### Test Scenarios

The included Puppeteer tests (`../../puppeteer/extension-testing.test.ts`) validate:

1. **Extension Loading**
   - Verify extensions load without errors
   - Check required permissions are available
   - Validate manifest parsing

2. **Popup Extension Tests**
   - Content script injection and floating indicator
   - Modal popup functionality
   - Element highlighting features
   - Extension API availability

3. **New Tab Extension Tests**
   - New tab override functionality
   - Widget presence and interaction
   - Settings panel operation
   - Chrome API integration (bookmarks, storage)

4. **Integration Tests**
   - Extension communication patterns
   - Data persistence across sessions
   - Error handling and recovery

### Test Data and IDs

Both extensions include comprehensive test identifiers:

**Popup Extension Test IDs:**
- `popup-test-indicator` - Floating content indicator
- `extension-info-modal` - Information modal
- `counter-display` - Counter value display
- `increment-btn`, `decrement-btn` - Counter controls
- Various action buttons with descriptive IDs

**New Tab Extension Test IDs:**
- `newtab-title`, `newtab-subtitle` - Page headers
- `clock-widget`, `weather-widget`, `bookmarks-widget` - Main widgets
- `time-display`, `date-display` - Clock components
- `settings-toggle`, `weather-toggle` - Settings controls
- `test-bookmarks-btn`, `refresh-data-btn` - Test controls

## Extension Architecture

### Communication Patterns

Both extensions demonstrate proper Chrome extension architecture:

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│   Popup     │◄──►│  Background  │◄──►│   Content    │
│   Script    │    │   Script     │    │   Script     │
└─────────────┘    └──────────────┘    └──────────────┘
      ▲                    ▲                    ▲
      │                    │                    │
      ▼                    ▼                    ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│  Storage    │    │   Tabs API   │    │   Page DOM   │
│    API      │    │   Messages   │    │ Manipulation │
└─────────────┘    └──────────────┘    └──────────────┘
```

### Permission Usage

**Popup Extension:**
- `storage` - Settings persistence
- `tabs` - Tab management and content injection
- `activeTab` - Current tab access

**New Tab Extension:**
- `storage` - Widget preferences
- `bookmarks` - Bookmark tree access
- `topSites` - Most visited sites
- `tabs` - Tab creation and management

## Development Notes

### Testing Best Practices

1. **Headless Mode**: Tests can run in headless mode for CI/CD
2. **Wait Strategies**: Proper waits for dynamic content loading
3. **Error Handling**: Comprehensive error catching and reporting
4. **Cleanup**: Proper browser instance cleanup after tests
5. **Isolation**: Each test runs in a fresh page context

### Extension Loading

Extensions are loaded using Puppeteer's `--load-extension` flag:

```javascript
const browser = await puppeteer.launch({
  args: [
    '--load-extension=path/to/extension',
    '--disable-extensions-except=path/to/extension'
  ]
});
```

### Mock Data

Extensions include realistic mock data for testing:
- Sample bookmarks with proper Chrome bookmark structure
- Mock weather data with realistic values
- Top sites with common website patterns
- Error scenarios for validation testing

## Migration Testing

These extensions serve as test cases for the migration pipeline:

1. **Manifest V2 → V3**: Both extensions use MV2 format for migration testing
2. **API Compatibility**: Test Chrome API usage patterns
3. **Content Security Policy**: Validate CSP compliance
4. **Permission Changes**: Test permission model differences
5. **Background Script Migration**: Service worker transition testing

The extensions provide comprehensive coverage for validating the migration tool's functionality across different extension types and usage patterns.