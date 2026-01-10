# Use Node.js LTS
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create user with matching host UID/GID
ARG USER_ID=1000
ARG GROUP_ID=1000
RUN groupadd -g $GROUP_ID migrator_group && \
    useradd -u $USER_ID -g $GROUP_ID -m -s /bin/bash migrator_user

# Set working directory
WORKDIR /app

# Change ownership of app directory to migrator_user
RUN chown -R migrator_user:migrator_group /app

# Switch to migrator_user for remaining operations
USER migrator_user

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
RUN mkdir -p logs output cws

# Set Node.js memory options
ENV NODE_OPTIONS="--max-old-space-size=128000 --max-semi-space-size=512 --expose-gc"

# Expose WebSocket server port
EXPOSE 8080

# Default command - start the migration server
CMD ["yarn", "server"]
