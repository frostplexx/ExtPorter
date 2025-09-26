# ExtPorter

ExtPorter is a comprehensive framework for automatically migrating
browser extensions from Manifest V2 to Manifest V3.
This project was developed as part of a bachelor thesis to address the challenges
of Chrome extension migration in the face of Google's deprecation of Manifest V2.

## Features

- **Automated MV2 → MV3 Migration**: Converts extension manifests, API calls, and code structure
- **Extension Testing Framework**: Tests both original and migrated extensions for functionality
- **Database Integration**: Tracks migration results and statistics with MongoDB
- **Extension Analysis Tools**: Analyze extensions for security patterns and "interestingness"
- **Docker Support**: Full containerized development and deployment
- **Comprehensive Logging**: Detailed migration and testing logs with Winston

## 🏗️ Architecture

ExtPorter consists of several key components:

- **Migrator Core**: Handles the actual MV2 → MV3 transformation
- **Testing Framework**: Automated testing using Puppeteer
- **Database Layer**: MongoDB integration for result tracking
- **Analysis Tools**: Extension security and pattern analysis
- **Resource Management**: Handles remote resource downloads and file operations

## 📋 Prerequisites

- Node.js (v18+)
- Docker & Docker Compose
- MongoDB (via Docker)
- Git

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/frostplexx/ExtPorter.git
   cd ExtPorter
   ```

2. **Install dependencies**
   ```bash
   yarn install
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start services**
   ```bash
   docker-compose up -d
   ```

## 🚀 Usage

### Basic Migration

Migrate extensions from a source directory:

```bash
yarn dev <input_directory> <output_directory>
```

Example:
```bash
yarn dev ./extensions ./output
```

### Using Docker

**Start all services:**
```bash
docker-compose up --build
```

**Run in detached mode:**
```bash
docker-compose up -d
```

**View logs:**
```bash
docker-compose logs migrator-app
```

### Extension Analysis

Analyze extensions for security patterns and interestingness:

```bash
python scripts/extension_analyzer.py <extensions_folder> <output.csv>
```

Example:
```bash
python scripts/extension_analyzer.py ./unpacked_extensions analysis_results.csv
```

## 📊 Extension Analyzer

The extension analyzer script evaluates extensions based on configurable criteria:

- **webRequest API usage** (+25 points per occurrence)
- **HTML content** (+0.25 points per line)
- **Local storage usage** (+5 points per occurrence)
- **Background pages/service workers** (+10 points if present)
- **Content scripts** (+4 points if present)
- **Dangerous permissions** (+8 points per permission)
- **Host permissions** (+3 points per permission)
- **Crypto/obfuscation patterns** (+15 points per pattern)
- **Network requests** (+2 points per pattern)
- **Extension size** (+1 point per 100KB)

Customize scoring by editing the `WEIGHTS` configuration at the top of `scripts/extension_analyzer.py`.

## 🏃‍♂️ Development

### Available Scripts

- `yarn dev` - Run migrator in development mode
- `yarn build` - Build TypeScript to JavaScript
- `yarn test` - Run test suite
- `yarn lint` - Run ESLint
- `yarn clean` - Clean output directory and database
- `yarn db:shell` - Connect to MongoDB shell
- `yarn db:admin` - Open MongoDB admin interface

### Database Management

- **Start database:** `yarn db:up`
- **Stop database:** `yarn db:down`
- **View logs:** `yarn db:logs`
- **Admin interface:** `yarn db:admin` (opens http://localhost:8081)

### Testing

- `yarn test` - Run all tests
- `yarn test:unit` - Run unit tests only
- `yarn test:integration` - Run integration tests
- `yarn test:puppeteer` - Run browser tests

## 📁 Project Structure

```
ExtPorter/
├── migrator/           # Core migration logic
│   ├── modules/       # Migration modules (manifest, API renames, etc.)
│   ├── types/         # TypeScript type definitions
│   ├── utils/         # Utility functions
│   └── features/      # Database and other features
├── scripts/           # Analysis and utility scripts
├── tests/            # Test suites
├── docker-compose.yml # Docker configuration
└── README.md
```

## 🔧 Configuration

Key configuration files:

- `.env` - Environment variables
- `docker-compose.yml` - Docker services
- `migrator/templates/api_mappings.json` - API migration mappings
- `scripts/extension_analyzer.py` - Analysis weights and criteria

## 🧠 Memory Management

ExtPorter includes built-in memory management for processing large extension datasets:

- **Batch Processing**: Set `MIGRATION_BATCH_SIZE` (default: 50) to control memory usage
- **Memory Monitoring**: Automatic memory usage logging at key points
- **Garbage Collection**: Run with `--expose-gc` flag for optimal memory management
- **Resource Cleanup**: Automatic file descriptor cleanup and writer queue flushing

## 📝 Migration Process

ExtPorter performs the following migration steps:

1. **Extension Discovery**: Finds and unpacks extensions
2. **Manifest Migration**: Converts manifest.json from V2 to V3 format
3. **API Transformation**: Updates deprecated API calls
4. **Resource Downloading**: Fetches remote resources
5. **Code Generation**: Writes migrated extension files
6. **Testing**: Validates both original and migrated versions
7. **Database Storage**: Saves results and statistics

## 🐛 Known Issues & Limitations

- Parameter structure changes in API calls need manual review
- Some Content Security Policies may break after migration
- Memory usage can be high for large extension sets
- Popup tests occasionally fail due to timing issues

See the [TODO](#todo) section for detailed known issues and planned improvements.


# TODO 

- [X] dotenv should only be called once and not load for every extension
- [X] Dockerise everything
- [ ] Write a script that generates some fun statistics from the mongodb
- [ ] Make it use multiple cores?
- [X] Better normalize all the logs e.g. everything should have the extension id
- [X] Sort out new-tab wallpapers in output
- [X] Add tooling for quickly loading extensions as both mv2 and mv3
- [X] Return error instead of null in the migrate() function
- [X] Add downloading of remote resources
- [X] Preprocessing of manifest.json files so invalid characters and stuff get removed
- [ ] Handle multiple background scripts
- [ ] test if remote resources get downloaded correctly
- [X] Handle optional permissions
- [ ] compare the DOM
- [ ]   The migrator only transforms:
  - chrome.tabs.executeScript → chrome.scripting.executeScript

  But it ignores:
  - Parameter count change (2 params → 1 param)
  - Parameter structure change (separate tabId and details → combined injection object)

  Key Limitations

  1. No parameter analysis: The nodeMatchesSourcePattern() method at /Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/src/modules/api_renames.ts:237 only checks API paths, not parameter structure
  2. No argument transformation: The applyTargetTransformation() method at line 265 only updates member expressions, not function arguments
  3. Unused formal definitions: The formals arrays in the mapping JSON are loaded but never used in the transformation logic

  Result

  Code like:
  chrome.tabs.executeScript(tabId, { code: "..." });

  Becomes:
  chrome.scripting.executeScript(tabId, { code: "..." }); // Still broken!

  Instead of the correct MV3 format:
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    code: "..."
  });

  The migrator handles API namespace changes but doesn't address the more complex parameter restructuring needed for full MV2→MV3 migration.

- [ ] API migration is too aggressive and transforms comments (should preserve comments unchanged)
- [ ] Variable assignments are incorrectly transformed (e.g., `const action = chrome.browserAction` becomes `const action = chrome.onClicked` instead of `const action = chrome.action`)

# FIXME

- [X] Icons for extensions dont work anymore?
- [X] On the processing JS error add what the actual error is
- [x] Some content secuity policies are broken/invalid after migrating
- [x] puppeteer sometimes crashes
- [ ] sometimes the popup doesnt get copied? e.g. with ./output/oiibaihkmlkilofifhdfjlmbkaolchgp/
```fish
[ERROR] Popup test failed for Nano Adblocker: {
  error: 'net::ERR_BLOCKED_BY_CLIENT at chrome-extension://aplpkchgkfgpogbhajolpfnekodkpndn/popup.html'
}
[INFO] Extension tests completed for: Nano Adblocker { success: false, testsRun: 1, duration: 111.44066699998803 }
/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:101
      this._reject(callback, new TargetCloseError('Target closed'));
                             ^
TargetCloseError: Protocol error (Extensions.loadUnpacked): Target closed
    at CallbackRegistry.clear (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts
:101:30)
    at Connection.#onClose (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Connection.ts:224:21)
    at Socket.<anonymous> (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/node/PipeTransport.ts:42:22)
    at Socket.emit (node:events:530:35)
    at Socket.emit (node:domain:489:12)
    at Pipe.<anonymous> (node:net:346:12) {
  cause: ProtocolError
      at Callback.<instance_members_initializer> (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/
CallbackRegistry.ts:127:12)
      at new Callback (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:132:3)
      at CallbackRegistry.create (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry
.ts:30:22)
      at Connection._rawSend (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Connection.ts:136:22)
      at Connection.send (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Connection.ts:120:17)
      at CdpBrowser.installExtension (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Browser.ts:369:
41)
      at /Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/node/BrowserLauncher.ts:228:26
      at Array.map (<anonymous>)
      at ChromeLauncher.launch (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/node/BrowserLauncher.ts:2
27:26)
      at runNextTicks (node:internal/process/task_queues:65:5)
}
```
error Command failed with exit code 1.
- [ ] Sometimes it fails to load extensions
- [x] I think the extension id in the mv3 test results is still the mv2 one
- [x] The folder name of the mv3 extensions is still the mv2 id
- [ ] fix:"error": "ENOENT: no such file or directory, open '/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/dataset/abenoopklclfmphonmfbmamkcfpbenin/_metadata/verified_contents.json'"
- [ ] ./output/ponpakfnkmdgcabfiebpbppmheghigmh/: 
^[[O/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:127
  #error = new ProtocolError();
           ^
ProtocolError: Protocol error (Extensions.loadUnpacked): Could not load javascript 'pusher.min.js' for script.
    at Callback.<instance_members_initializer> (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:127:12)
    at new Callback (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:132:3)
    at CallbackRegistry.create (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:30:22)
    at Connection._rawSend (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Connection.ts:136:22)
    at Connection.send (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Connection.ts:120:17)
    at CdpBrowser.installExtension (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Browser.ts:369:41)
    at /Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/node/BrowserLauncher.ts:228:26
    at Array.map (<anonymous>)
    at ChromeLauncher.launch (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/node/BrowserLauncher.ts:227:26)
    at runNextTicks (node:internal/process/task_queues:65:5)
error Command failed with exit code 1.
info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.
- [x] fix content security policies
- [x] some files dont seem to copied correctly
- [x] FIX: JavaScript heap out of memory - Added batch processing and memory management

**Memory Management Features Added:**
- Batch processing (configurable via `MIGRATION_BATCH_SIZE` env var, default: 50)
- Memory usage monitoring and logging
- Automatic garbage collection after each batch
- Writer queue flushing between batches
- Improved file descriptor cleanup



# Docker

**Build and start all services**
docker-compose up --build

**Run in detached mode**
docker-compose up -d

**View logs**
docker-compose logs migrator-app

**Stop services**
docker-compose down
