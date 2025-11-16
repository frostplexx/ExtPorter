# Extension Analyzer & Migrator

A modern, tabbed terminal UI built with Ink and TypeScript for managing Chrome extension migration and analysis.

## Features

### Tabbed Interface

- **Tab 1: Migrator** - WebSocket client for migration server communication
- **Tab 2: Extension Analyzer** - Browse and analyze extensions from database
- **Tab 3: Settings** - Configuration and application information

### Migrator Tab

- Real-time WebSocket connection to migration server (ws://localhost:8080)
- Color-coded connection status (green=connected, yellow=connecting, red=disconnected)
- Message history with visual indicators:
    - `→` Sent messages (green)
    - `←` Received messages (blue)
    - `•` System messages (yellow)
- Interactive command input

### Extension Analyzer Tab

- Browse extensions from MongoDB database
- Search/filter functionality
- Sort by interestingness score
- Visual indicators for MV3 compatibility
- Keyboard navigation (↑/↓ to navigate, type to search)

### Settings Tab

- Application configuration display
- Feature status overview
- Version information

## Usage

```bash
# Start the application
yarn client

# Or run directly
tsx ext_analyzer/index.tsx
```

## Controls

### Tab Navigation

- Press `1`, `2`, or `3` to switch tabs
- Use `←`/`→` arrow keys to navigate tabs

### Migrator Tab

- Type commands and press `ENTER` to send to migration server
- `ESC` or `CTRL+C` to quit

### Extension Analyzer Tab

- `↑`/`↓` to navigate extension list
- Type to search/filter extensions
- `R` to reload from database
- `ENTER` to view extension details (coming soon)

### Global

- `ESC` or `CTRL+C` to quit application

## Architecture

### File Structure

```
ext_analyzer/
├── index.tsx              # Main application with tab navigation
├── websocket.ts           # WebSocket client implementation
├── tabs/
│   ├── migrator-tab.tsx   # Migration server client tab
│   ├── analyzer-tab.tsx    # Extension analysis tab
│   └── settings-tab.tsx   # Settings and configuration tab
├── tsconfig.json          # TypeScript configuration for ext_analyzer
└── package.json           # ESM module configuration
```

### Technology Stack

- **Ink 6.x** - React for CLIs
- **TypeScript** - Type-safe development
- **React Hooks** - useState, useEffect, useInput
- **ES Modules** - Modern module system
- **tsx** - TypeScript execution

### Dependencies

- `ink` - React for terminal interfaces
- `react` - UI library
- `@types/react` - TypeScript definitions
- `tsx` - TypeScript execution

## Development

### Building

```bash
# Build TypeScript files
yarn _build

# Run in development mode
yarn client
```

### Database Integration

The Extension Analyzer tab connects to MongoDB to browse extensions. Currently uses mock data for demonstration, but includes infrastructure for real database integration.

### WebSocket Communication

The Migrator tab connects to the migration WebSocket server for real-time communication during extension migration processes.

## Future Enhancements

- [ ] Real database integration in Extension Analyzer
- [ ] Extension detail view and actions
- [ ] Editable settings configuration
- [ ] Extension testing interface
- [ ] Bulk migration operations
- [ ] Progress indicators for long operations
