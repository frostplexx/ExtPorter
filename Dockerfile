# Use Node.js LTS
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Create user with matching host UID/GID
ARG USER_ID=424242
ARG GROUP_ID=424242
RUN groupadd -g $GROUP_ID migrator_group 2>/dev/null || groupmod -n migrator_group $(getent group $GROUP_ID | cut -d: -f1) && \
    useradd -u $USER_ID -g $GROUP_ID -m -s /bin/bash migrator_user 2>/dev/null || usermod -l migrator_user -d /home/migrator_user -m $(getent passwd $USER_ID | cut -d: -f1)

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json yarn.lock ./

# Change ownership of app directory to migrator_user
RUN chown -R migrator_user:migrator_group /app

# Switch to migrator_user for remaining operations
USER migrator_user

# Install dependencies
RUN yarn install

# Copy TypeScript configuration and eslint config
COPY tsconfig.json ./
COPY eslint.config.mjs ./
COPY prettier.config.js ./

# Copy all source code
COPY migrator/ ./migrator/

# Create directories that the application expects
RUN mkdir -p logs output cws

# Switch back to migrator_user
USER migrator_user

# Expose WebSocket server port
EXPOSE 8080

# Default command
CMD ["yarn", "server"]
