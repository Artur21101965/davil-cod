#!/bin/bash
# watchdog.sh — restart the Freegate LLM proxy if it's down or unresponsive.
# Runs every minute via launchd. Kills hung processes, then starts the proxy.

set -u

PROXY_DIR="$HOME/.config/opencode/llm-proxy"
PORT="${PROXY_PORT:-4000}"
LOG="$PROXY_DIR/watchdog.log"
MAX_LOG_SIZE=5242880  # 5MB
MAX_ROTATIONS=2
NODE="${NODE_BIN:-$HOME/.local/nodejs/current/bin/node}"
STATE_FILE="$PROXY_DIR/.watchdog-state"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

# Rotate watchdog.log when it grows too big (it never grows fast, but every
# healthy-minute line adds up over months).
rotate_log() {
  [ -f "$LOG" ] || return
  local size
  size=$(stat -f%z "$LOG" 2>/dev/null || echo 0)
  [ "$size" -lt "$MAX_LOG_SIZE" ] && return
  [ -f "$LOG.$MAX_ROTATIONS" ] && rm -f "$LOG.$MAX_ROTATIONS"
  [ -f "$LOG.1" ] && mv "$LOG.1" "$LOG.2"
  mv "$LOG" "$LOG.1"
}

notify() {
  # macOS system notification via osascript
  osascript -e "display notification \"$2\" with title \"Freegate — $1\"" 2>/dev/null || true
}

is_alive() {
  # Exit 0 if /health returns 200 quickly
  curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '200'
}

find_pid() {
  lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
}

# Only log a status line when it CHANGES (healthy->down, down->healthy, or the
# first run after boot). Prevents the log from turning into "healthy" spam.
last_state() { cat "$STATE_FILE" 2>/dev/null || echo "none"; }
set_state() { printf '%s\n' "$1" > "$STATE_FILE"; }

rotate_log

if is_alive; then
  # Healthy — log only when the previous state wasn't healthy (recovery/boot).
  PID="$(find_pid)"
  if [ "$(last_state)" != "healthy" ]; then
    log "proxy healthy (pid=${PID:-unknown})"
    notify "Прокси работает" "Прокси доступен на :$PORT"
  fi
  set_state "healthy"
  exit 0
fi

# Not healthy. Kill whatever holds the port (even a hung process).
set_state "down"
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
  set_state "healthy"
  log "proxy started OK"
  notify "Прокси перезапущен" "Freegate снова работает"
  exit 0
else
  set_state "down"
  log "proxy FAILED to start"
  notify "Прокси НЕ запустился" "Перезапуск не удался — нужна помощь"
  exit 1
fi
