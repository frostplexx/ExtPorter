#!/bin/bash

function cleanup() {
	echo -e "\nShutting down server (PID: $SERVER_PID)..."
	kill $SERVER_PID 2>/dev/null
	wait $SERVER_PID 2>/dev/null
}

function main() {
	# Start server in background
    echo "Starting Server..."
	yarn server >/dev/null 2>&1 &
	SERVER_PID=$!
	echo "Server started (PID: $SERVER_PID)"

	# Setup trap to kill server when script exits
	trap cleanup EXIT INT TERM

	# Start client in foreground (blocks until client exits)
    echo "Starting Client..."
	cargo run --manifest-path ext_analyzer/Cargo.toml

	# Client exited, cleanup will be called automatically
}

main
