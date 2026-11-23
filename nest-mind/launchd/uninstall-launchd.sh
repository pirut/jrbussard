#!/bin/bash
# Stop and remove the nest-mind launchd agent. Keeps config, credentials,
# backups and logs.
set -euo pipefail

LABEL="com.jrbussard.nest-mind"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed $LABEL. Config, credentials and backups in ~/Library/Application Support/nest-mind/ are untouched."
echo "Logs stay in ~/Library/Logs/nest-mind/."
