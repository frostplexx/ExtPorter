# ExtPorter

ExtPorter is a framework for automatically migrating
google chrome extensions from Manifest V2 to Manifest V3.
This project was developed as part of a bachelor thesis to address the challenges
of Chrome extension migration in the face of Google's deprecation of Manifest V2.

## Features

- **Automated MV2 → MV3 Migration**: Converts extension manifests, API calls, and code structure
- **Database Integration**: Tracks migration results and statistics with MongoDB
- **Docker Support**: Full containerized development and deployment

## Prerequisites

- Node.js (v18+)
- Docker & Docker Compose
- MongoDB (via Docker)
- Git
- (optional) Nix
- (optional) kitty terminal

## Installation

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

## Usage

### Basic Migration

Migrate extensions from a source directory (set inside the .env file):

```bash
yarn dev 
```

Or pass source and destination explicitly:
```bash
yarn dev <input_directory> <output_directory>
```

## Development

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
