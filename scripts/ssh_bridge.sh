#!/bin/bash
# Creates an ssh bridge that mounts port 8080 to localhost 8080
main() {
    # Check if required arguments are provided
    if [ $# -lt 1 ]; then
        echo "Usage: $0 <user@remote-host> [local-port] [remote-port] [ssh-port] [ssh-options]"
        echo "Example: $0 user@example.com 8080 8080 22"
        echo "Example: $0 user@example.com 8080 8080 2222 '-i ~/.ssh/mykey'"
        exit 1
    fi
    
    # Parse arguments
    REMOTE_HOST="$1"
    LOCAL_PORT="${2:-8080}"
    REMOTE_PORT="${3:-8080}"
    SSH_PORT="${4:-22}"
    SSH_OPTIONS="${5:-}"
    
    echo "Creating SSH tunnel..."
    echo "Remote host: $REMOTE_HOST"
    echo "SSH port: $SSH_PORT"
    echo "Local port: $LOCAL_PORT"
    echo "Remote port: $REMOTE_PORT"
    [ -n "$SSH_OPTIONS" ] && echo "SSH options: $SSH_OPTIONS"
    echo ""
    echo "Access the remote service at: http://localhost:$LOCAL_PORT"
    echo "Press Ctrl+C to close the tunnel"
    echo ""
    
    # Build SSH command
    SSH_CMD="ssh -N -L ${LOCAL_PORT}:localhost:${REMOTE_PORT} -p ${SSH_PORT}"
    
    # Add additional SSH options if provided
    if [ -n "$SSH_OPTIONS" ]; then
        SSH_CMD="$SSH_CMD $SSH_OPTIONS"
    fi
    
    # Add remote host
    SSH_CMD="$SSH_CMD $REMOTE_HOST"
    
    # Execute SSH tunnel
    eval "$SSH_CMD"
}
main "$@"
