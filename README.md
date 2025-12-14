<p align="center">
    <!-- <img src="https://nixos.wiki/images/thumb/2/20/Home-nixos-logo.png/414px-Home-nixos-logo.png" width=200/> -->
    <h1 align="center">
        <img align="center" width="250" height="1024" alt="ExtPorter" src="https://github.com/user-attachments/assets/fcef26a0-379f-49b8-87ba-4163aea3ffb0" /></br>
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

- **Automated MV2 → MV3 Migration**: Converts extension manifests, API calls, and code structure
- **Database Integration**: Tracks migration results and statistics with MongoDB
- **Chrome Web Store Metadata**: Automatically extracts and stores extension metadata (description, ratings, developer info, etc.) from CWS HTML files for better searchability and filtering
- **Docker Support**: Full containerized development and deployment
- **Manual Analysis**: Provides tools for manually analysing if the migration succeeded

## Prerequisites

### Using Docker (Recommended for Production)

- Docker & Docker Compose
- Rust toolchain (for the client only)
    - `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### Development Setup

#### Server Requirements (Bare Metal)

**When using nix:**

- [Nix](https://nixos.org/)
- [Flakes enabled](https://nixos.wiki/wiki/flakes)
- Docker & Docker Compose
- (optional) [direnv](https://direnv.net/)

**If you are not using nix:**

- Node.js (v18+)
- yarn
- Docker & Docker Compose
- Git
- Chrome 138 AND Chrome 141 (for testing)
- (optional) [sshpass](https://linux.die.net/man/1/sshpass)
- (optional) [ollama](https://ollama.com/)

#### Client Requirements

**Rust Client (Recommended):**

- Rust toolchain (cargo, rustc)
- Cargo (comes with Rust)

**TypeScript Client (Advanced Features):**

- Node.js (v18+)
- yarn (installed with server dependencies)
- (optional) [kitty terminal](https://sw.kovidgoyal.net/kitty/) - required for code viewing features

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
    docker-compose up -d
    ```

    This will start:
    - Migration server on `ws://localhost:8080` (WebSocket)
    - MongoDB on `localhost:27017`
    - Mongo Express admin UI on `http://localhost:8081`

5. **Install and run the Rust client**

    ```bash
    # Install Rust if not already installed
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

    # Run the client (it will connect to localhost:8080)
    cargo run --manifest-path ext_analyzer/Cargo.toml
    ```

6. **Stop the server**

    ```bash
    docker-compose down
    ```

### Development Setup (Bare Metal)

For active development, you may want to run the server locally instead of in Docker.

#### Server Setup

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

#### Client Setup

**Rust Client (Recommended):**

1. **Install Rust** (if not already installed)

    ```bash
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    ```

2. **Build the client**

    ```bash
    cargo build --manifest-path ext_analyzer/Cargo.toml
    ```

    Or use yarn to build:

    ```bash
    yarn client:build
    ```

The Rust client will be compiled and ready to use with `yarn client` or `cargo run --manifest-path ext_analyzer/Cargo.toml`.

**TypeScript Client (Advanced Features):**

The TypeScript client is already available after completing the server setup. No additional compilation needed.

**Note**: For code viewing features, install [kitty terminal](https://sw.kovidgoyal.net/kitty/).

## Usage

### Starting the Server and Client

#### Using Docker (Production)

If you're using Docker, the server is already running after `docker-compose up -d`. Simply connect with a client:

```bash
# Run the Rust client
cargo run --manifest-path ext_analyzer/Cargo.toml

# Or if you have yarn installed locally
yarn client
```

The client will automatically connect to the WebSocket server at `ws://localhost:8080`.

To view server logs:

```bash
docker-compose logs -f migrator-server
```

#### Development (Bare Metal)

Make sure that the environment is initialized before running any commands by doing `yarn env:init`!

**Quick Start:**

Start both server and client together with automatic cleanup:

```bash
# Using the bash script
./scripts/dev.sh

# Or using the Python launcher
./start.py
```

Both methods will:

- Start the migration server in the background
- Launch the Rust client in the foreground
- Automatically terminate the server when the client exits

**Manual Start:**

Start components separately:

```bash
# Terminal 1 - Start the server
yarn server

# Terminal 2 - Start the Rust client
yarn client

# Or start the TypeScript client
yarn ext
```

### Migration

Before running the command configure the input and output directories in the `.env` file:

```env
INPUT_DIR=/path/to/unpacked/extensions
OUTPUT_DIR=/path/to/output/folder
```

Then run the following command to migrate:

```bash
yarn migrate
```

### Manual Analysis

This project provides two clients for manual analysis:

#### Rust Client (Recommended)

Run `yarn client` to open the high-performance Rust/Ratatui client. This client provides:

- Real-time migration monitoring and log viewing
- Extension browsing and search
- Extension analysis with statistics
- Database status viewing
- Lightweight and fast with no Node.js runtime required

The Rust client is ideal for monitoring migrations and browsing results.

See [ext_analyzer/README.md](ext_analyzer/README.md) for more details.

#### TypeScript Client (Advanced Features)

Run `yarn ext` to open the TypeScript/Ink client with full database querying capabilities. The client will display a list of all extensions in the dataset with the following options:

```
View Source          [v]
Compare Versions     [c]
Run Extension        [r]
Info                 [i]
Logs                 [l]
Grep                 [g]
Manifest             [m]
Open Directory       [o]
Generate Description [d]
Search Again         [s]
Quit                 [q]
```

**⚠️ Limitations**:

- View Source needs you to use the [kitty](https://sw.kovidgoyal.net/kitty/) terminal as it opens new tabs and panes
- If you want to use "Generate Description" You must first configure an ollama endpoint in `.env`. See [LLM Integration](https://github.com/frostplexx/ExtPorter/blob/dev/README.md#llm-integration) for more info.

The TypeScript client offers advanced features like code viewing and LLM integration.

### LLM Integration

ExtPorter offers integration with LLMs using ollama. To use this feature you need to configure an endpoint inside the .env file:

```env
# LLM API Endpoint
# Supports three formats:
# 1. Local: http://localhost:11434
# 2. Remote (direct): http://remote-server.com:11434
# 3. Remote (SSH tunnel): ssh://user@host:sshport/ollamaport
#    Example: ssh://user@server.example.org:12345/11434
#    This will automatically create an SSH tunnel and forward to the remote Ollama instance
# LLM_ENDPOINT=http://localhost:11434
LLM_ENDPOINT=ssh://username@server.example.org:12345/11434

# List of ollama models: https://ollama.com/search
LLM_MODEL=codellama:latest

# SSH Authentication (required when using ssh:// URLs)
# Use either password or private key:
SSH_PASSWORD=<password>
# SSH_PRIVATE_KEY_PATH=/path/to/private/key

# SSH Local Port (optional, default: 11434)
# The local port to forward to when using SSH tunneling
SSH_LOCAL_PORT=11434
```

### Scripts

```
Default (uses INPUT_DIR from .env):
npx ts-node scripts/find_blocking_webrequest.ts

With custom path:
npx ts-node scripts/find_blocking_webrequest.ts /path/to/extensions

Save results to JSON file:
npx ts-node scripts/find_blocking_webrequest.ts --output=/tmp/results.json

JSON output to console:
npx ts-node scripts/find_blocking_webrequest.ts --json
```

## Development

File structure:

```bash
.
├── ext_analyzer # Files for manual analysis
│   ├── prompts
│   ├── display-utils.ts
│   ├── ext.ts
│   ├── extension-actions.ts
│   ├── extension-explorer.ts
│   ├── file-operations.ts
│   ├── input-handler.ts
│   ├── llm-manager.ts
│   ├── llm-service.ts
│   └── types.ts
├── ext_tester # Automated extension tester using puppeteer
│   ├── chrome_tester.ts
│   ├── ex_test_result.ts
│   ├── test_ext.ts
│   └── test_result_comparator.ts
├── migrator # Main migrator
│   ├── features # Database, llm integration etc
│   ├── modules # Migraiton modules
│   ├── templates # Files that are used by the migrator / get injected into each extension
│   ├── types
│   ├── utils
│   └── index.ts
├── scripts # Various scripts that help you set up and manage the migrator
│   └── init_env.sh
├── tests # Tests for migrator and ext_tester
│   ├── fixtures
│   ├── integration
│   ├── puppeteer
│   ├── unit
│   ├── setup.ts
│   └── test-runner.ts
└── yarn.lock
```

### Modules

ExtPorter is made up of modules that can be added/removed to the migration pipeline. They are defined inside `migrator/index.ts`:

```ts
const migrationModules = [
    MigrateManifest.migrate,
    MigrateCSP.migrate,
    ResourceDownloader.migrate,
    RenameAPIS.migrate,
    BridgeInjector.migrate,
    InterestingnessScorer.migrate,
    WriteMigrated.migrate,
];
```

Modules are stored in `migrator/modules/` and get applied one after the other to the extension in the same order as they are defined in the array.

Each module **must** implement the abstract class of `MigrationModule` found in `migrator/types/migration_module.ts`. This class provides a migrate function that takes an extension as a parameter and returns either the modified extension or a migration error.
In addition to this mandatory function a module can include any arbitrary amount of code, however keep in mind that `migrate` is always the main entry point.

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

- `yarn docker:up` - Start all services (server, MongoDB, Mongo Express)
- `yarn docker:down` - Stop all services
- `yarn docker:logs` - View server logs
- `yarn docker:logs:all` - View all container logs
- `yarn docker:rebuild` - Rebuild and restart containers

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

- `yarn test` - Run all tests
- `yarn test:unit` - Run unit tests only
- `yarn test:integration` - Run integration tests
- `yarn test:puppeteer` - Run browser tests
