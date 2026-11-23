#!/bin/bash
# Install (or reinstall) the nest-mind launchd agent for the current user.
# Runs `npm start` equivalent at login, restarts it if it exits, and logs to
# ~/Library/Logs/nest-mind/. Run from anywhere: ./launchd/install-launchd.sh
set -euo pipefail

LABEL="com.jrbussard.nest-mind"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$DIR/launchd/$LABEL.plist.template"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/nest-mind"
CONFIG="$HOME/Library/Application Support/nest-mind/config.json"

# Node 24: $NODE if set, else the pinned Mac mini install, else PATH.
NODE="${NODE:-}"
if [ -z "$NODE" ] && [ -x "$HOME/.local/share/node/node-v24.14.1-darwin-arm64/bin/node" ]; then
  NODE="$HOME/.local/share/node/node-v24.14.1-darwin-arm64/bin/node"
fi
NODE="${NODE:-$(command -v node || true)}"
[ -n "$NODE" ] && [ -x "$NODE" ] || { echo "node not found; set NODE=/path/to/node (v24)"; exit 1; }
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$MAJOR" = "24" ] || { echo "$NODE is Node $MAJOR; nest-mind needs Node 24 (set NODE=...)"; exit 1; }

[ -f "$DIR/node_modules/tsx/dist/cli.mjs" ] || { echo "Dependencies missing. Run: npm --prefix '$DIR' ci"; exit 1; }
[ -f "$CONFIG" ] || { echo "Not configured. Run: npm --prefix '$DIR' run setup -- --convex-url <url>"; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
chmod 700 "$LOG_DIR"

esc() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }
sed -e "s|__NODE__|$(esc "$NODE")|g" \
    -e "s|__NODE_BIN__|$(esc "$(dirname "$NODE")")|g" \
    -e "s|__DIR__|$(esc "$DIR")|g" \
    -e "s|__LOG_DIR__|$(esc "$LOG_DIR")|g" \
    "$TEMPLATE" > "$PLIST.tmp"
plutil -lint "$PLIST.tmp" >/dev/null
chmod 644 "$PLIST.tmp"
mv "$PLIST.tmp" "$PLIST"

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo "Installed $LABEL ($PLIST)."
echo "Logs: $LOG_DIR/nest-mind.log and nest-mind.err.log"
echo "Check: npm --prefix '$DIR' run status"
