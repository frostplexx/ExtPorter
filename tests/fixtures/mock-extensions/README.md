# Mock Browser Extensions for Testing

This directory contains mock browser extensions designed for testing the migration pipeline.

## Extensions

### New Tab Extension (`newtab-extension/`)

A dashboard replacement for the new tab page used for testing:

**Features:**

- Real-time clock with 12/24 hour format
- Weather widget with mock data
- Bookmarks and top sites integration
- Settings panel for widget visibility

**Files:**

- `manifest.json` - New tab override configuration (MV2)
- `newtab.html` - Dashboard interface
- `newtab.js` - Dashboard functionality with Chrome API integration
- `background.js` - Background script

### Theme Extension (`theme-extension/`)

A minimal theme extension for testing theme-related migration.

**Files:**

- `manifest.json` - Theme configuration

## Usage

These extensions are used by unit tests in `tests/unit/` to validate:

- Extension loading and parsing
- Manifest migration from MV2 to MV3
- Chrome API usage patterns
- Content Security Policy compliance
