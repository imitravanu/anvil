#!/usr/bin/env bash
# Capture real Anvil UI frames in a tmux pane against the mock provider.
set -u
cd "$(dirname "$0")/../../.."   # repo root

OUT=/tmp/anvil-frames
rm -rf "$OUT" && mkdir -p "$OUT"

# Scratch ANVIL_HOME: ollama placeholder key + settings
export ANVIL_HOME=/tmp/anvil-scratch
rm -rf "$ANVIL_HOME" && mkdir -p "$ANVIL_HOME"
cat > "$ANVIL_HOME/credentials.json" <<'EOF'
{ "ollamaApiKey": "ollama" }
EOF
cat > "$ANVIL_HOME/settings.json" <<'EOF'
{ "defaultProviderId": "ollama", "defaultModel": "qwen2.5-coder:latest", "theme": "dark" }
EOF
chmod 600 "$ANVIL_HOME/credentials.json"

export OLLAMA_HOST=http://127.0.0.1:8117
export FORCE_COLOR=1
SHELL=/bin/bash

node packages/tui/scripts/mock-openai-server.mjs &
MOCK_PID=$!
sleep 0.6

SESSION=anvil-cap
tmux kill-session -t "$SESSION" 2>/dev/null
tmux new-session -d -s "$SESSION" -x 100 -y 30 "env ANVIL_HOME=$ANVIL_HOME OLLAMA_HOST=$OLLAMA_HOST FORCE_COLOR=1 npm run dev --workspace=packages/cli 2>/tmp/anvil-boot-err.log"

sleep 6   # boot: install-check + tsx startup
tmux capture-pane -t "$SESSION" -p > "$OUT/01-empty.txt"

# Turn 1: rich markdown answer
tmux send-keys -t "$SESSION" -l "what does the module export?"
sleep 0.5
tmux send-keys -t "$SESSION" Enter
sleep 4
tmux capture-pane -t "$SESSION" -p > "$OUT/02-markdown.txt"

# Turn 2: tool calls
tmux send-keys -t "$SESSION" -l "check the files"
sleep 0.5
tmux send-keys -t "$SESSION" Enter
sleep 4
tmux capture-pane -t "$SESSION" -p > "$OUT/03-tools.txt"

# Turn 3: final answer after tools
sleep 3
tmux capture-pane -t "$SESSION" -p > "$OUT/04-final.txt"

# Slash menu
tmux send-keys -t "$SESSION" -l "/"
sleep 1
tmux capture-pane -t "$SESSION" -p > "$OUT/05-slash-menu.txt"
tmux send-keys -t "$SESSION" -l "model"
sleep 0.4
tmux capture-pane -t "$SESSION" -p > "$OUT/06-slash-filter.txt"
tmux send-keys -t "$SESSION" Escape
sleep 0.4

# Model picker
tmux send-keys -t "$SESSION" -l "/model"
sleep 0.4
tmux send-keys -t "$SESSION" Enter
sleep 1.5
tmux capture-pane -t "$SESSION" -p > "$OUT/07-model-picker.txt"
tmux send-keys -t "$SESSION" Escape

# Help
tmux send-keys -t "$SESSION" -l "/help"
sleep 0.4
tmux send-keys -t "$SESSION" Enter
sleep 1.5
tmux capture-pane -t "$SESSION" -p > "$OUT/08-help.txt"

tmux kill-session -t "$SESSION" 2>/dev/null
kill "$MOCK_PID" 2>/dev/null
echo "frames saved to $OUT"
