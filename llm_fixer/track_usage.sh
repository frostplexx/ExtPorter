#!/usr/bin/env bash
#
# Launch AgentsView scoped to ONLY this project's Claude Code usage
# (the llm_fixing migrations), ignoring every other project and agent.
#
#   ./track_usage.sh            # serve the UI at http://127.0.0.1:8080
#   ./track_usage.sh sync       # one-off sync (no server) — handy for checking
#   ./track_usage.sh projects   # list tracked projects
#
# Re-run it to pick up newly-created migration sessions.
#
# It uses a dedicated data dir, so your full `agentsview serve` (all projects,
# all agents) is left completely untouched.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_PROJECTS="${CLAUDE_PROJECTS_SRC:-$HOME/.claude/projects}"
DATA_DIR="$HOME/.agentsview-llm-fixing"
FARM="$DATA_DIR/claude_projects"
EMPTY="$DATA_DIR/_disabled"

# Claude slugifies the cwd by replacing every non-alphanumeric char with '-'.
# All of this project's session dirs (the root + each <id>/mv3) share that prefix.
PREFIX="$(printf '%s' "$PROJECT_DIR" | sed 's/[^A-Za-z0-9]/-/g')"

mkdir -p "$FARM" "$EMPTY"

# Rebuild the farm: symlink only this project's existing Claude session dirs.
find "$FARM" -maxdepth 1 -type l -exec rm {} + 2>/dev/null || true
n=0
for d in "$CLAUDE_PROJECTS/$PREFIX"*; do
  [ -d "$d" ] || continue
  ln -sfn "$d" "$FARM/$(basename "$d")"
  n=$((n + 1))
done

# Disable every other agent by pointing its dir at an empty directory.
for v in CODEX_SESSIONS_DIR COPILOT_DIR GEMINI_DIR OPENCODE_DIR CURSOR_PROJECTS_DIR \
         IFLOW_DIR AMP_DIR ZED_DIR QWEN_PROJECTS_DIR QCLAW_DIR WORKBUDDY_PROJECTS_DIR \
         PIEBALD_DIR VSCODE_COPILOT_DIR OPENCLAW_DIR PI_DIR ZENCODER_DIR KIMI_DIR \
         COMMANDCODE_PROJECTS_DIR WARP_DIR HERMES_SESSIONS_DIR CORTEX_DIR \
         KIRO_SESSIONS_DIR KIRO_IDE_DIR FORGE_DIR ANTIGRAVITY_DIR ANTIGRAVITY_CLI_DIR; do
  export "$v=$EMPTY"
done

export AGENTSVIEW_DATA_DIR="$DATA_DIR"
export CLAUDE_PROJECTS_DIR="$FARM"

echo "AgentsView (llm_fixing only): $n Claude session dir(s) from $PROJECT_DIR"
echo "Data dir: $DATA_DIR"

# Default to `serve`; also prepend it when only flags (e.g. --no-browser) are given.
if [ $# -eq 0 ] || [ "${1#-}" != "$1" ]; then
  set -- serve "$@"
fi
exec agentsview "$@"
