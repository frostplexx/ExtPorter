# Auto-generated Makefile mirroring package.json scripts
# Targets use `yarn <script>` when `yarn` is available, otherwise they run equivalent commands.

.SILENT:
.PHONY: help _build server server-watch client client-watch dev clean debug test env-init test-full test-watch test-coverage test-unit test-integration test-puppeteer test-fakeium test-fakeium-unit test-fakeium-extension docker-up docker-down docker-logs docker-logs-all docker-rebuild db-up db-down db-logs db-shell db-admin db-setup ext lint lint-fix format

help:
	@echo "Available targets:"
	@echo "  _build               - TypeScript compile (tsc)"
	@echo "  server               - Run migrator server"
	@echo "  server-watch         - Run migrator server in watch mode"
	@echo "  client               - Run Rust client (cargo run)"
	@echo "  client-watch         - Run Rust client in watch mode (cargo-watch)"
	@echo "  dev                  - Run development script ./scripts/dev.sh"
	@echo "  clean                - Clean output and DB (as package.json)"
	@echo "  debug                - Build and run node with --inspect-brk"
	@echo "  test                 - Run Jest tests"
	@echo "  test-unit            - Run unit tests only"
	@echo "  test-integration     - Run integration tests"
	@echo "  test-puppeteer       - Run puppeteer tests"
	@echo "  test-fakeium         - Run fakeium demos/tests"
	@echo "  docker-up            - docker-compose up -d"
	@echo "  docker-down          - docker-compose down"
	@echo "  db-up                - Start mongodb via docker-compose"
	@echo "  db-shell             - Open mongosh in docker"
	@echo "  ext                  - Run ext_analyzer ext script (ts-node)"
	@echo "  lint                 - Run ESLint"
	@echo "  lint-fix             - Run ESLint --fix"
	@echo "  format               - Run prettier via nix (as in package.json)"

# Helper: run yarn if available, otherwise run the command specified after '||'
# Usage: sh -c "$(call maybe_yarn,script-name, fallback command)"


# Build
_build:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn _build; \
	else \
		echo "yarn not found, running tsc directly"; \
		tsc; \
	fi

# Server
server:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn server; \
	else \
		# Try to run local tsx if available
		if [ -x ./node_modules/.bin/tsx ]; then \
			export NODE_OPTIONS="$${NODE_OPTIONS}"; ./node_modules/.bin/tsx migrator/index.ts; \
		elif command -v tsx >/dev/null 2>&1; then \
			export NODE_OPTIONS="$${NODE_OPTIONS}"; tsx migrator/index.ts; \
		else \
			echo "tsx not found in node_modules or PATH. Please install tsx or use yarn."; exit 1; \
		fi; \
	fi

server-watch:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn server:watch; \
	else \
		if [ -x ./node_modules/.bin/tsx ]; then \
			export NODE_OPTIONS="$${NODE_OPTIONS}"; ./node_modules/.bin/tsx watch migrator/index.ts; \
		elif command -v tsx >/dev/null 2>&1; then \
			export NODE_OPTIONS="$${NODE_OPTIONS}"; tsx watch migrator/index.ts; \
		else \
			echo "tsx watch not available. Install tsx or use yarn."; exit 1; \
		fi; \
	fi

# Client
client:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn client; \
	else \
		cargo run --manifest-path ext_analyzer/Cargo.toml; \
	fi

client-watch:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn client:watch; \
	else \
		if command -v cargo-watch >/dev/null 2>&1; then \
			cargo watch -x 'run --manifest-path ext_analyzer/Cargo.toml'; \
		else \
			echo "cargo-watch not installed. Install cargo-watch or use yarn."; exit 1; \
		fi; \
	fi

# Dev script
dev:
	@./scripts/dev.sh

# Clean
clean:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn run clean; \
	else \
		echo "Running clean steps"; \
		# Try to drop DB in docker if running
		docker exec migrator-mongodb mongosh -u admin -p password --authenticationDatabase admin migrator --eval 'db.dropDatabase()' 2>/dev/null || true; \
	fi

# Debug
debug:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn debug; \
	else \
		$(MAKE) _build; node --inspect-brk dist/index.js; \
	fi

# Tests
test:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn test; \
	else \
		if [ -x ./node_modules/.bin/jest ]; then \
			./node_modules/.bin/jest; \
		elif command -v jest >/dev/null 2>&1; then \
			jest; \
		else \
			echo "jest not found. Install jest or use yarn."; exit 1; \
		fi; \
	fi

env-init:
	@./scripts/init_env.sh

# Test variants
test-full:
	@bash -c "set -e -o pipefail; $(if [ `command -v yarn >/dev/null 2>&1 && echo 1 || echo 0` -eq 1 ]; then echo 'yarn _build; yarn lint; yarn test'; else echo '$(MAKE) _build; $(MAKE) lint; $(MAKE) test'; fi )"

test-watch:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn test:watch; \
	else \
		if command -v jest >/dev/null 2>&1; then \
			jest --watch; \
		else \
			echo "jest not available"; exit 1; \
		fi; \
	fi

test-coverage:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn test:coverage; \
	else \
		if command -v jest >/dev/null 2>&1; then \
			jest --coverage; \
		else \
			echo "jest not available"; exit 1; \
		fi; \
	fi

test-unit:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn test:unit; \
	else \
		if command -v jest >/dev/null 2>&1; then \
			jest --testPathPatterns=unit; \
		else \
			echo "jest not available"; exit 1; \
		fi; \
	fi

test-integration:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn test:integration; \
	else \
		if command -v jest >/dev/null 2>&1; then \
			jest --testPathPatterns=integration; \
		else \
			echo "jest not available"; exit 1; \
		fi; \
	fi

test-puppeteer:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn test:puppeteer; \
	else \
		if command -v jest >/dev/null 2>&1; then \
			jest --testPathPatterns=puppeteer; \
		else \
			echo "jest not available"; exit 1; \
		fi; \
	fi

# Fakeium targets
test-fakeium:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn test:fakeium; \
	else \
		node -e "require('./migrator/features/fakeium/demo.js')" || echo "Run with yarn to use ts-node"; \
	fi

test-fakeium-unit:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn test:fakeium:unit; \
	else \
		if command -v jest >/dev/null 2>&1; then \
			jest --testPathPatterns=fakeium; \
		else \
			echo "jest not available"; exit 1; \
		fi; \
	fi

test-fakeium-extension:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn test:fakeium:extension; \
	else \
		node -e "require('./migrator/features/fakeium/test-single-extension.js')" || echo "Run with yarn to use ts-node"; \
	fi

# Docker
docker-up:
	@docker-compose up -d

docker-down:
	@docker-compose down

docker-logs:
	@docker-compose logs -f migrator-server

docker-logs-all:
	@docker-compose logs -f

docker-rebuild:
	@docker-compose up -d --build

# DB helpers
db-up:
	@docker-compose up -d mongodb

db-down:
	@docker-compose down

db-logs:
	@docker-compose logs -f mongodb

db-shell:
	@docker-compose exec mongodb mongosh migrator -u admin -p password

db-admin:
	@open http://localhost:8081 || true

db-setup:
	@docker-compose up -d

# Misc
ext:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn ext; \
	else \
		node -e "require('ts-node/register'); require('./ext_analyzer/ext.ts');"; \
	fi

lint:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn lint; \
	else \
		if [ -x ./node_modules/.bin/eslint ]; then \
			./node_modules/.bin/eslint migrator --ext .ts; \
		elif command -v eslint >/dev/null 2>&1; then \
			eslint migrator --ext .ts; \
		else \
			echo "eslint not found"; exit 1; \
		fi; \
	fi

lint-fix:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn lint:fix; \
	else \
		if [ -x ./node_modules/.bin/eslint ]; then \
			./node_modules/.bin/eslint migrator --ext .ts --fix; \
		elif command -v eslint >/dev/null 2>&1; then \
			eslint migrator --ext .ts --fix; \
		else \
			echo "eslint not found"; exit 1; \
		fi; \
	fi

format:
	@if command -v yarn >/dev/null 2>&1; then \
		yarn format; \
	else \
		# Try to run prettier if available; otherwise try nix as in package.json
		if command -v prettier >/dev/null 2>&1; then \
			prettier --write "**/*.{ts,tsx,js,jsx,json,css,md}"; \
		elif command -v nix >/dev/null 2>&1; then \
			nix run nixpkgs#prettier -- --write "**/*.{ts,tsx,js,jsx,json,css,md}"; \
		else \
			echo "prettier or nix not found; install one or use yarn format"; exit 1; \
		fi; \
	fi
