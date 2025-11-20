# Use Node.js with Chrome pre-installed for Puppeteer
FROM ghcr.io/puppeteer/puppeteer:24.31.0

# Set working directory
WORKDIR /app

# Install system dependencies
USER root
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json yarn.lock ./

# Install dependencies (use yarn instead of npm)
RUN yarn install --frozen-lockfile

# Copy TypeScript configuration and eslint config
COPY tsconfig.json ./
COPY eslint.config.mjs ./
COPY prettier.config.js ./

# Copy all source code
COPY migrator/ ./migrator/
COPY scripts/ ./scripts/

# Create directories that the application expects
RUN mkdir -p logs output

# Switch to non-root user for security
USER pptruser

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Set Node.js memory options
ENV NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512 --expose-gc"

# Expose WebSocket server port
EXPOSE 8080

# Default command - start the migration server
CMD ["yarn", "server"]