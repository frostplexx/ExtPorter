<p align="center">
    <!-- <img src="https://nixos.wiki/images/thumb/2/20/Home-nixos-logo.png/414px-Home-nixos-logo.png" width=200/> -->
    <h1 align="center"><code>ExtPorter</code></h1>
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
- **Docker Support**: Full containerized development and deployment
- **Manual Analysis**: Provides tools for manually analysing if the migration succeeded

## Prerequisites


### When using nix

- [Nix](https://nixos.org/)
- [Flakes enabled](https://nixos.wiki/wiki/flakes)
- (optional) [kitty terminal](https://sw.kovidgoyal.net/kitty/)
- (optional) [direnv](https://direnv.net/)

### If you are not using nix

- Node.js (v18+)
- Docker & Docker Compose
- Git
- Chrome 138 AND Chrome 141
- (optional) [sshpass](https://linux.die.net/man/1/sshpass)
- (optional) [kitty terminal](https://sw.kovidgoyal.net/kitty/)
- (optional) [ollama](https://ollama.com/)

## Installation

### Bare metal

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
    export CHROME_138="/path/to/chrome/138/" # the code will build the path as follows: `${process.env.CHROME_138}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
    export CHROME_LATESTS="/path/to/chrome/138/" # the code will build the path as follows: `${process.env.CHROME_LATESTS}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
    ```

4. **Initialize Environment**
    ```bash
    yarn env:init
    ```
    (This should run automatically if you are using direnv)

## Usage


Make sure that the environment is Initialized before running any commands by doing `yarn env:init`!

### Migration

Before running the command configure the input and output directories in the `.env` file:
```conf
INPUT_DIR=/path/to/unpacked/extensions
OUTPUT_DIR=/path/to/output/folder
```
Then run the following command to migrate:
```bash
yarn dev
```


### Manual Analysis

This project also provides a tool that helps you analyse if extensions got migrated successfully.
To start, run `yarn ext` which will open a list of all extensions in the dataset. You can then press enter on an extension to get the following options (with
keyboard shortcut in square brackets):

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
- If you want to use "Generate Description" You must first configure an ollama endpoint in `.env`


## Development

### Most important Scripts

- `yarn dev` - Run migrator in development mode
- `yarn check_full` - Build, Lint and Test. Do this before pushing
- `yarn debug` - Run the migrator with debugger support
- `yarn build` - Build TypeScript to JavaScript
- `yarn test` - Run test suite
- `yarn lint` - Run ESLint
- `yarn clean` - Clean output directory and database
- `yarn db:shell` - Connect to MongoDB shell
- `yarn db:admin` - Open MongoDB admin interface

For more scripts look in `package.json`.

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
