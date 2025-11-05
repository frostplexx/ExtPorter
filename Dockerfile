# Use Node.js with Chrome pre-installed for Puppeteer
FROM ghcr.io/puppeteer/puppeteer:24.29.0

# Set working directory
WORKDIR /app

# Install system dependencies
USER root
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json yarn.lock ./

# Install dependencies
RUN npm install --production=false

# Copy TypeScript configuration
COPY tsconfig.json ./

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Create directories that the application expects
RUN mkdir -p logs output

# Switch to non-root user for security
USER pptruser

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Expose any ports if needed (this app doesn't seem to have a web server)
# EXPOSE 3000

# Default command
CMD ["npm", "start"]