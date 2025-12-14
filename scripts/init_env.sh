#!/usr/bin/env bash

set -e

# Parse lightweight CLI args when the script is executed directly
PRINT_EXPORTS=0
EXPORT_SHELL=""
for arg in "$@"; do
	case "$arg" in
	--print-exports)
		PRINT_EXPORTS=1
		shift || true
		;;
	--shell=*)
		EXPORT_SHELL="${arg#--shell=}"
		shift || true
		;;
	*)
		# ignore
		;;
	esac
done

# If export shell not provided, try to detect from the user's SHELL
if [[ -z "$EXPORT_SHELL" ]]; then
	if [[ "${SHELL:-}" == *"fish"* ]]; then
		EXPORT_SHELL="fish"
	else
		EXPORT_SHELL="bash"
	fi
fi

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

list_puppeteer_browsers() {
	# List installed Puppeteer browsers via npx, with a fallback sample output
	if ! command -v npx >/dev/null 2>&1; then
		if [[ "${VERBOSE:-0}" -eq 1 ]]; then
			echo "Warning: npx not found; please install Node.js/npm to use this command."
		fi
		return 1
	fi

	if [[ "${VERBOSE:-0}" -eq 1 ]]; then
		echo "Running: npx @puppeteer/browsers list"
	fi
	if ! npx @puppeteer/browsers list; then
		if [[ "${VERBOSE:-0}" -eq 1 ]]; then
			echo "Failed to run 'npx @puppeteer/browsers list'"
		fi
		return 1
	fi
}

configure_puppeteer_chromes() {
	# Detect two configured Chrome versions, export their paths or install them
	if ! command -v npx >/dev/null 2>&1; then
		# Only warn if verbose
		if [[ "${VERBOSE:-0}" -eq 1 ]]; then
			echo "Warning: npx not found; please install Node.js/npm to manage Puppeteer browsers."
		fi
		return 1
	fi

	# Desired versions and corresponding env var names
	versions=("chrome@138.0.7204.183" "chrome@141.0.7390.123")
	vars=("CHROME_138" "CHROME_LATESTS")

	# Get current list once
	output=$(npx @puppeteer/browsers list 2>/dev/null || true)

	for i in "${!versions[@]}"; do
		ver="${versions[i]}"
		varname="${vars[i]}"
		# Extract path for the version. Format: <name> (<platform>) <path>
		path=$(echo "$output" | sed -nE "s#^(${ver}) \([^)]*\) (.+)#\2#p" | head -n1)

		if [[ -n "$path" ]]; then
			eval "export ${varname}='${path}'"
			if [[ "${VERBOSE:-0}" -eq 1 ]]; then
				echo "Found ${ver}: ${path} (exported ${varname})"
			fi
			continue
		fi

		# Not found -> install
		if [[ "${VERBOSE:-0}" -eq 1 ]]; then
			echo "${ver} not found, installing via npx @puppeteer/browsers install ${ver}..."
		fi
		if ! npx @puppeteer/browsers install "${ver}"; then
			if [[ "${VERBOSE:-0}" -eq 1 ]]; then
				echo "Failed to install ${ver}"
			fi
			continue
		fi

		# Refresh list and extract path again
		output=$(npx @puppeteer/browsers list 2>/dev/null || true)
		path=$(echo "$output" | sed -nE "s#^(${ver}) \([^)]*\) (.+)#\2#p" | head -n1)
		if [[ -n "$path" ]]; then
			eval "export ${varname}='${path}'"
			if [[ "${VERBOSE:-0}" -eq 1 ]]; then
				echo "Installed ${ver} and exported ${varname}=${path}"
			fi
		else
			if [[ "${VERBOSE:-0}" -eq 1 ]]; then
				echo "Installed ${ver} but could not determine path from browsers list"
			fi
		fi
	done
}

start_db() {
	# Check if mongodb container is already running
	if docker-compose ps mongodb | grep -q "Up"; then
		return 0
	fi

	echo "Starting MongoDB..."
	docker-compose up -d mongodb
}

# Helper to print exports for the current shell
print_exports() {
	# Run configuration quietly and capture exports
	VERBOSE=0 QUIET=1 configure_puppeteer_chromes >/dev/null 2>&1 || true
	# Now print the env vars if set (only the lines themselves)
	if [[ "${EXPORT_SHELL}" == "fish" ]]; then
		# fish uses 'set -x VAR value'
		[[ -n "${CHROME_138:-}" ]] && printf 'set -x CHROME_138 %s\n' "${CHROME_138}"
		[[ -n "${CHROME_LATESTS:-}" ]] && printf 'set -x CHROME_LATESTS %s\n' "${CHROME_LATESTS}"
	else
		# bash/zsh: print export lines
		[[ -n "${CHROME_138:-}" ]] && printf 'export CHROME_138="%s"\n' "${CHROME_138}"
		[[ -n "${CHROME_LATESTS:-}" ]] && printf 'export CHROME_LATESTS="%s"\n' "${CHROME_LATESTS}"
	fi
}

# Main execution
main() {
	ensure_docker
	# Configure Puppeteer-managed Chrome binaries (may require Node.js/npx)
	configure_puppeteer_chromes || true
	start_db
}

# Run either print mode or main when script executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	if [[ "${PRINT_EXPORTS}" -eq 1 ]]; then
		# Load functions into this shell context then print exports
		configure_puppeteer_chromes || true
		print_exports
		exit 0
	fi
	main "$@"
fi
