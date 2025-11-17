# ExtPorter Rust Client

A Terminal User Interface (TUI) client for the ExtPorter migration framework, written in Rust using [Ratatui](https://ratatui.rs/).

## Features

- **Real-time Migration Monitoring**: View migration logs and control the migration process
- **Extension Explorer**: Browse and search through migrated extensions
- **Extension Analyzer**: View detailed statistics and information about extensions
- **Database Browser**: View database collections and status
- **Settings**: View configuration and system information

## Prerequisites

- Rust 1.70 or later
- Cargo

## Building

```bash
cd ext_analyzer_rust
cargo build --release
```

## Running

From the repository root:

```bash
# Using yarn (recommended)
yarn client:rust

# Or directly with cargo
cargo run --manifest-path ext_analyzer_rust/Cargo.toml

# Or run the release build
./ext_analyzer_rust/target/release/ext_analyzer
```

## Usage

### Navigation

- **1-5**: Switch between tabs
- **←/→**: Navigate between tabs
- **ESC** or **Ctrl+C**: Quit

### Tab-Specific Controls

#### Migrator Tab
- **s**: Start migration
- **S**: Stop migration

#### Explorer/Analyzer Tabs
- **↑/↓**: Navigate list
- **Type**: Search extensions
- **Backspace**: Delete search character

#### Analyzer Tab
- **s**: Toggle sort order (interestingness/name/version)

#### Database Tab
- **m**: Toggle view mode

## Configuration

The client connects to the migration server at `ws://localhost:8080` by default. 

## Architecture

The client is structured as follows:

- `src/main.rs`: Entry point and event loop
- `src/app.rs`: Main application state and rendering
- `src/websocket.rs`: WebSocket client for server communication
- `src/tabs/`: Individual tab implementations
  - `migrator.rs`: Migration control and log viewing
  - `explorer.rs`: Extension browsing
  - `analyzer.rs`: Extension analysis and statistics
  - `database.rs`: Database browser
  - `settings.rs`: Settings and about information

## Comparison with TypeScript Client

The Rust client provides the same core functionality as the TypeScript/Ink client, with:

- **Better Performance**: Lower memory usage and faster rendering
- **Simpler Dependencies**: Fewer runtime dependencies
- **Native Compilation**: Single binary with no Node.js required
- **Streamlined Interface**: Focused on essential migration monitoring features

Note: Advanced database querying features are available in the TypeScript version and can be accessed by running `yarn client`.

## License

Same as the main ExtPorter project.
