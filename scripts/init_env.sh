#!/usr/bin/env bash

set -e

# Function to check if Docker is running
check_docker_running() {
    docker info >/dev/null 2>&1
}

# Function to start Docker on macOS using OrbStack
start_docker_macos() {
    echo "Starting OrbStack..."
    
    if command -v orb >/dev/null 2>&1; then
        orb start
    elif [ -d "/Applications/OrbStack.app" ]; then
        open -a "/Applications/OrbStack.app"
    else
        echo "Error: OrbStack not found. Install from: https://orbstack.dev/"
        exit 1
    fi
    
    # Wait for Docker to start
    local timeout=30
    local count=0
    
    while ! check_docker_running && [ $count -lt $timeout ]; do
        sleep 1
        count=$((count + 1))
    done
    
    if ! check_docker_running; then
        echo "Error: OrbStack failed to start"
        exit 1
    fi
}

# Function to start Docker on Linux
start_docker_linux() {
    echo "Starting Docker..."
    
    if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl start docker >/dev/null 2>&1
        sudo systemctl enable docker >/dev/null 2>&1
    elif command -v service >/dev/null 2>&1; then
        sudo service docker start >/dev/null 2>&1
    else
        echo "Error: Unable to start Docker service"
        exit 1
    fi
    
    sleep 3
    
    if ! check_docker_running; then
        echo "Error: Docker failed to start"
        exit 1
    fi
}

# Main function to ensure Docker is running
ensure_docker() {
    # Check if we're in a Nix shell
    if [[ -n "$IN_NIX_SHELL" ]]; then
    # Check if docker command is available from Nix
    if command -v docker >/dev/null 2>&1; then
        if check_docker_running; then
                return 0
        else            
                # On macOS in Nix shell, we might still need to start Docker
            if [[ "$OSTYPE" == "darwin"* ]]; then
                start_docker_macos
            elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
                start_docker_linux
            fi
        fi
    fi
    fi

    # If not in Nix shell or Nix Docker setup failed, use system Docker
    if [[ -z "$IN_NIX_SHELL" ]] || ! command -v docker >/dev/null 2>&1; then
    if check_docker_running; then
            return 0
    else
        # Detect OS and start Docker accordingly
        if [[ "$OSTYPE" == "darwin"* ]]; then
            start_docker_macos
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            start_docker_linux
        else
            echo "Error: Unsupported OS: $OSTYPE"
            exit 1
        fi
    fi
    fi
}


start_db(){
    # Check if mongodb container is already running
    if docker-compose ps mongodb | grep -q "Up"; then
        return 0
    fi
    
    echo "Starting MongoDB..."
    docker-compose up -d mongodb
}

# Main execution
main() {
    ensure_docker
    start_db
}

# Run main if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
