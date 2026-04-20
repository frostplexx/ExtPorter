<p align="center">
    <!-- <img src="https://nixos.wiki/images/thumb/2/20/Home-nixos-logo.png/414px-Home-nixos-logo.png" width=200/> -->
    <h1 align="center">
        <img align="center" width="250" height="250" alt="ExtPorter" src="https://github.com/user-attachments/assets/fcef26a0-379f-49b8-87ba-4163aea3ffb0" /></br>
        <code>ExtPorter</code>
    </h1>
    <div style="display: grid;" align="center">
        <img src="https://github.com/frostplexx/ExtPorter/actions/workflows/test.yml/badge.svg" height=20/>
    </div>
</p>

<!-- prettier-ignore -->
> :red_circle: **IMPORTANT**:
> This is an experimental research project! Breakages and instabilities are to be expected.

ExtPorter is a framework for automatically migrating
Google Chrome extensions from Manifest V2 to Manifest V3.
This project was developed as part of a bachelor thesis to address the challenges
of Chrome extension migration in the face of Google's deprecation of Manifest V2.

## Features

- **Automated MV2 to MV3 Migration**: Converts extension manifests, API calls, and code structure
- **webRequest to declarativeNetRequest**: Automatically converts blocking webRequest API to the new declarativeNetRequest API
- **Service Worker Conversion**: Migrates background scripts to service workers with proper event handling
- **Database Integration**: Tracks migration results and statistics with MongoDB
- **Chrome Web Store Metadata**: Automatically extracts and stores extension metadata (description, ratings, developer info, etc.) from CWS HTML files for better searchability and filtering
- **Docker Support**: Full containerized development and deployment
- **TUI Client**: Interactive terminal UI for managing migrations, exploring extensions, and manual analysis
- **LLM Integration**: AI-powered extension description generation and migration error fixing
- **Resume Support**: Migration can be stopped and resumed, tracking progress in the database
- **Manual Analysis**: Side-by-side browser comparison for testing MV2 vs MV3 versions

## Architecture

ExtPorter consists of two main components:

| Component            | Technology         | Description                                                               |
| -------------------- | ------------------ | ------------------------------------------------------------------------- |
| **Migration Server** | TypeScript/Node.js | Core migration logic, WebSocket server, database management               |
| **TUI Client**       | Rust (ratatui)     | Terminal UI for extension analysis, migration control, and manual testing |

Communication between components is done via WebSocket, allowing the client and server to run on different machines.

# Usage

## Requirements

### Server Requirements

- Docker & Docker Compose

### Client Requirements

- Rust toolchain (cargo, rustc)
- Cargo (comes with Rust)
- yarn
- nodejs

## Installation

### Quick Start with Docker (Recommended)

The easiest way to run ExtPorter is using Docker for the server and a native client.

1. **Clone the repository**

    ```bash
    git clone https://github.com/frostplexx/ExtPorter.git
    cd ExtPorter
    ```

2. **Set up environment**

    ```bash
    cp .env.example .env
    # Edit .env with your configuration
    ```

3. **Create required directories**

    ```bash
    mkdir -p extensions output logs
    ```

    Place your unpacked Chrome extensions in the `extensions/` directory.

4. **Start the server and database**

    ```bash
    # Use the provided script to ensure proper file ownership
    docker-compose up -d
    ```

    This will start:
    - Migration server on `ws://localhost:8080` (WebSocket)
    - MongoDB on `localhost:27017`
    - Mongo Express admin UI on `http://localhost:8081`

    **Note:** On its first start the server will ask you to authenticate with GitHub to get access to LLM features.
    You have to complete this step otherwise the server won't fully start. Instructions, including the authentication code will
    be **printed to stdout**.

5. Set up the SSH bridge.
   If the server runs on a remote machine, you need to create an SSH tunnel so the client can connect.
   To do that run `./scripts/ssh_bridge.sh <user@remote-host> [local-port] [remote-port] [ssh-port] [ssh-options]`
   Remote and local port, if left default are `8080` e.g. `./scripts/ssh_bridge.sh ubuntu@192.168.0.123 8080 8080 22`
   bridges remote port `8080` to local port `8080`.
6. **Run the Rust client**

    ```bash
    yarn run client
    ```

The Client should successfully connect to the server.

# Development

For active development, you may want to run the server locally instead of in Docker.

## Server Setup

1. **Clone the repository**

    ```bash
    git clone https://github.com/frostplexx/ExtPorter.git
    cd ExtPorter
    ```

2. **Install dependencies**
   If you are using nix run either `direnv allow` if you have that installed, else run `nix develop`.
   In any case install the yarn dependencies by running:

    ```bash
    yarn install
    ```

3. **Set up environment**

    ```bash
    cp .env.example .env
    # Edit .env with your configuration
    ```

    Additionally make sure that the following environment variables are set if you are not using nix:

    ```bash
    export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512 --expose-gc"
    export CHROME_OLD="/path/to/chrome/138/" # the code will build the path as follows: `${process.env.CHROME_138}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
    export CHROME_LATESTS="/path/to/chrome/latest/" # the code will build the path as follows: `${process.env.CHROME_LATESTS}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
    ```

4. **Initialize Environment**
    ```bash
    yarn env:init
    ```
    (This should run automatically if you are using direnv)

## Client Setup

**Rust Client (Recommended):**

1. **Install Rust** (if not already installed)

    ```bash
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    ```

2. **Build the client**

    ```bash
    yarn run client
    ```

**⚠️ Limitations**:

- View Source needs you to use the [kitty](https://sw.kovidgoyal.net/kitty/) terminal as it opens new tabs and panes
- Displaying images needs a terminal that supports that feature such as kitty, WezTerm or Ghostty
- If you want to use "Generate Description" You must first configure an LLM endpoint in `.env`. See [LLM Integration](#llm-integration) for more info.

### Modules

ExtPorter is made up of modules that can be added/removed to the migration pipeline. They are defined inside `migrator/index.ts`:

```ts
const migrationModules = [
    WebRequestMigrator.migrate,
    MigrateManifest.migrate,
    MigrateCSP.migrate,
    RenameAPIS.migrate,
    BridgeInjector.migrate,
    OffscreenDocumentMigrator.migrate,
    ListenerAnalyzer.migrate,
    InterestingnessScorer.migrate,
    WriteMigrated.migrate,
];
```

| Module                      | Purpose                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `WebRequestMigrator`        | Converts blocking `webRequest` API to `declarativeNetRequest`                 |
| `MigrateManifest`           | Converts MV2 manifest to MV3 format (permissions, actions, service workers)   |
| `MigrateCSP`                | Migrates Content Security Policy to MV3 requirements                          |
| `RenameAPIS`                | Renames deprecated Chrome API calls to MV3 equivalents                        |
| `BridgeInjector`            | Injects compatibility bridges for background-to-content communication         |
| `OffscreenDocumentMigrator` | Handles offscreen document requirements for DOM operations in service workers |
| `ListenerAnalyzer`          | Extracts event listeners for analysis                                         |
| `InterestingnessScorer`     | Calculates "interestingness" scores for prioritization                        |
| `WriteMigrated`             | Writes migrated extensions to disk                                            |

Modules are stored in `migrator/modules/` and get applied one after the other to the extension in the same order as they are defined in the array.

Each module **must** implement the abstract class of `MigrationModule` found in `migrator/types/migration_module.ts`. This class provides a migrate function that takes an extension as a parameter and returns either the modified extension or a migration error.
In addition to this mandatory function a module can include any arbitrary amount of code, however keep in mind that `migrate` is always the main entry point.

### Project Structure

```
ExtPorter/
├── migrator/                    # TypeScript migration server
│   ├── index.ts                 # Entry point
│   ├── modules/                 # Migration modules
│   │   ├── manifest/            # Manifest migration
│   │   ├── web_request_migrator/# webRequest to declarativeNetRequest
│   │   ├── api_renames/         # API renaming
│   │   ├── bridge_injector/     # Compatibility bridges
│   │   ├── offscreen_documents/ # Offscreen document handling
│   │   ├── csp/                 # Content Security Policy migration
│   │   ├── listener_analyzer/   # Event listener extraction
│   │   ├── interestingness_scorer/ # Extension scoring
│   │   └── write_extension/     # Write migrated extensions
│   ├── features/                # Core features
│   │   ├── server/              # WebSocket server
│   │   ├── database/            # MongoDB integration
│   │   └── llm/                 # LLM integration
│   ├── types/                   # TypeScript type definitions
│   └── utils/                   # Utility functions
├── ext_analyzer/                # Rust TUI client
│   ├── src/
│   │   ├── main.rs              # Entry point
│   │   ├── app.rs               # Application state
│   │   └── tabs/                # UI tabs (migrator, explorer, analyzer, reports)
│   └── Cargo.toml               # Rust dependencies
├── tests/                       # Test suites
│   ├── unit/                    # Unit tests
│   └── integration/             # Integration tests
├── scripts/                     # Utility scripts
├── docker-compose.yml           # Docker configuration
└── package.json                 # Node.js dependencies
```

### Chrome Web Store Metadata Extraction

ExtPorter automatically extracts and stores Chrome Web Store metadata when loading extensions. This feature allows for better filtering, searching, and analysis of extensions.

**How it works:**

- When `find_extensions()` discovers extensions, it looks for CWS HTML files (e.g., `store.html`, `cws.html`)
- The HTML parser (`migrator/utils/cws_parser.ts`) extracts metadata using CSS selectors
- Extracted information is stored in the `cws_info` field of the Extension object
- This data is persisted to MongoDB when extensions are saved

**Extracted metadata includes:**

- Extension description and short description
- Rating and rating count
- User count
- Last update date
- Version and size
- Supported languages
- Developer name, website, and contact info
- Privacy policy URL

**Supported HTML file names:**

- `store.html` - Primary CWS HTML filename
- `cws.html` - Chrome Web Store HTML
- `metadata.html` - Metadata HTML
- `info.html` - Info HTML
- `extension.html` - Extension info HTML
- Any other large HTML file (>10KB) that contains CWS data

To include CWS metadata with your extensions, place a Chrome Web Store HTML file in each extension directory before running the migrator.

### Most Important Scripts

#### Docker Scripts

- `./scripts/docker-compose.sh up -d` - Start all services with proper file ownership
- `./scripts/docker-compose.sh down` - Stop all services
- `./scripts/docker-compose.sh logs -f migrator-server` - View server logs
- `yarn docker:up` - Start all services (server, MongoDB, Mongo Express)
- `yarn docker:down` - Stop all services
- `yarn docker:logs` - View server logs
- `yarn docker:logs:all` - View all container logs
- `yarn docker:rebuild` - Rebuild and restart containers

**Note**: The `./scripts/docker-compose.sh` wrapper script automatically sets the correct user ownership for generated files. Always prefer this over direct `docker-compose` commands.

#### Development Scripts

- `yarn dev` - Start server and client together (development mode)
- `yarn server` - Run migration server
- `yarn server:watch` - Run server with auto-reload
- `yarn client` - Run Rust client
- `yarn client:watch` - Run Rust client with auto-reload
- `yarn ext` - Run TypeScript client
- `yarn test:full` - Build, Lint and Test. Do this before pushing
- `yarn debug` - Run the migrator with debugger support
- `yarn build` - Build TypeScript to JavaScript
- `yarn test` - Run test suite
- `yarn lint` - Run ESLint
- `yarn clean` - Clean output directory and database

For more scripts look in `package.json`.

### Database Management

- **Start database:** `yarn db:up`
- **Stop database:** `yarn db:down`
- **View logs:** `yarn db:logs`
- **Admin interface:** `yarn db:admin` (opens http://localhost:8081)
- **Shell access:** `yarn db:shell`

### Testing

- `yarn test:full` - Run all tests
- `yarn test:unit` - Run unit tests only
- `yarn test:integration` - Run integration tests

### LLM Integration

ExtPorter supports AI-powered features for enhanced migration and analysis:

**Features:**

- **Description Generation**: Automatically generate extension descriptions using LLM
- **Extension Fixing**: AI-assisted fixing of migration errors

**Setup:**

1. The server uses GitHub Copilot authentication via the OpenCode SDK
2. On first start, the server will prompt you to authenticate with GitHub
3. Follow the instructions printed to stdout to complete authentication

**Configuration:**

Add the following to your `.env` file:

```bash
LLM_MODEL=gpt-4o  # or your preferred model
```

For local LLM support with Ollama, configure:

```bash
OLLAMA_ENDPOINT=http://localhost:11434
```
