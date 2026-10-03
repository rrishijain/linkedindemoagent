#!/bin/sh
# ARGUS runner watchdog installer (macOS launchd).
#
#   ./runner/install-watchdog.sh            install + start the watchdog
#   ./runner/install-watchdog.sh uninstall  stop + remove it
#
# Installs ~/Library/LaunchAgents/com.argus.runner.plist from the template
# next to this script, filling in the node binary and this repo's path.
# launchd then keeps the runner alive: it restarts on any non-zero exit
# (the hardened runner exits 1 on fatal scheduler death) and leaves a
# clean exit 0 alone (that's how a duplicate instance yields).
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ARGUS_DIR="$(dirname "$HERE")"
LABEL="com.argus.runner"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
GUI_DOMAIN="gui/$(id -u)"

if [ "$(uname)" != "Darwin" ]; then
  echo "This installer is macOS-only (launchd). On Linux use a systemd user unit;" >&2
  echo "on Windows use Task Scheduler with runner/start-runner.vbs." >&2
  exit 1
fi

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "$GUI_DOMAIN/$LABEL" 2>/dev/null || launchctl remove "$LABEL" 2>/dev/null || true
  rm -f "$DEST"
  echo "watchdog uninstalled ($DEST removed). The runner itself keeps running until it exits."
  exit 0
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "node not found on PATH" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__NODE__|$NODE_BIN|g" -e "s|__ARGUS_DIR__|$ARGUS_DIR|g" \
  "$HERE/$LABEL.plist" > "$DEST"

# Reload cleanly if a previous version is installed.
launchctl bootout "$GUI_DOMAIN/$LABEL" 2>/dev/null || true
if launchctl bootstrap "$GUI_DOMAIN" "$DEST" 2>/dev/null; then
  :
else
  # older macOS fallback
  launchctl load -w "$DEST"
fi

echo "watchdog installed: $DEST"
echo "  node:   $NODE_BIN"
echo "  runner: $ARGUS_DIR/runner/runner.js"
echo "  logs:   $ARGUS_DIR/runner/watchdog.log (launchd) + runner/runner.log (daemon)"
echo "launchd will start the runner at login and restart it after any crash."
