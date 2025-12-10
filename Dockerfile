# Use Node.js LTS
FROM node:22-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json yarn.lock ./

# Install dependencies
RUN yarn install 

# Copy TypeScript configuration and eslint config
COPY tsconfig.json ./
COPY eslint.config.mjs ./
COPY prettier.config.js ./

# Copy all source code
COPY migrator/ ./migrator/
COPY scripts/ ./scripts/

# Create directories that the application expects
RUN mkdir -p logs output

# Create a non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Fix permissions
RUN chown -R appuser:appuser /app

# Set Node.js memory options
ENV NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512 --expose-gc"

# Switch to non-root user
USER appuser

# Expose WebSocket server port
EXPOSE 8080

# Default command - start the migration server
CMD ["yarn", "server"]
