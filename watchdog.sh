#!/bin/bash
# watchdog.sh — restart the DAVIL Cod LLM proxy if it's down or unresponsive.
# Runs every minute via launchd. Kills hung processes, then starts the proxy.

set -u

PROXY_DIR="$HOME/.config/opencode/llm-proxy"
PORT="${PROXY_PORT:-4000}"
LOG="$PROXY_DIR/watchdog.log"
NODE="${NODE_BIN:-$HOME/.local/nodejs/current/bin/node}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

notify() {
  # macOS system notification via osascript
  osascript -e "display notification \"$2\" with title \"DAVIL Cod — $1\"" 2>/dev/null || true
}

is_alive() {
  # Exit 0 if /health returns 200 quickly
  curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '200'
}

find_pid() {
  lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
}

log "watchdog run (pid=$$)"

if is_alive; then
  # Healthy — check nothing else
  PID="$(find_pid)"
  log "proxy healthy (pid=${PID:-unknown})"
  exit 0
fi

# Not healthy. Kill whatever holds the port (even a hung process).
log "proxy NOT responding on :$PORT"
notify "Прокси упал" "Прокси не отвечает на :$PORT — перезапускаю"

PID="$(find_pid)"
if [ -n "$PID" ]; then
  log "killing stale pid $PID (SIGTERM)"
  kill "$PID" 2>/dev/null
  sleep 3
  if is_alive; then log "recovered after SIGTERM"; notify "Прокси восстановлен" "Перезапущен после зависания"; exit 0; fi
  log "killing stale pid $PID (SIGKILL)"
  kill -9 "$PID" 2>/dev/null
  sleep 1
fi

# Kill any orphaned server.js processes from previous runs (avoid port clash)
pkill -f "node.*$PROXY_DIR/server.js" 2>/dev/null
sleep 1

# Start fresh
log "starting proxy"
cd "$PROXY_DIR"
nohup "$NODE" server.js >> "$PROXY_DIR/proxy.log" 2>&1 &
sleep 4

if is_alive; then
  log "proxy started OK"
  notify "Прокси перезапущен" "DAVIL Cod снова работает"
  exit 0
else
  log "proxy FAILED to start"
  notify "Прокси НЕ запустился" "Перезапуск не удался — нужна помощь"
  exit 1
fi
