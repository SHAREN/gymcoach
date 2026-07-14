#!/usr/bin/env bash
set -u

ROOT="/mnt/d/RENAT/Documents/projects codex/GymCoach"
LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/homepc-watchdog.log"
LOCK_FILE="/tmp/gymcoach-homepc-watchdog.lock"
CHECK_INTERVAL_SECONDS=60
HEARTBEAT_INTERVAL_SECONDS=900

mkdir -p "$LOG_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

log() {
  printf '[%s] %s\n' "$(date -Is)" "$1" >> "$LOG_FILE"
}

health_codes() {
  local root_code
  local mcp_code
  root_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3030/ 2>/dev/null || true)"
  mcp_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3030/mcp/health 2>/dev/null || true)"
  printf '%s %s' "$root_code" "$mcp_code"
}

is_healthy() {
  local codes
  local root_code
  local mcp_code
  codes="$(health_codes)"
  read -r root_code mcp_code <<< "$codes"
  [[ "$root_code" =~ ^(200|307)$ && "$mcp_code" == "401" ]]
}

cd "$ROOT" || exit 1
compose=(docker compose -f docker-compose.prod.yml -f docker-compose.local.yml)
last_state="starting"
last_heartbeat=0

log "watchdog started"

while true; do
  now="$(date +%s)"

  if ! docker info >/dev/null 2>&1; then
    if [[ "$last_state" != "docker-unavailable" ]]; then
      log "Docker engine is unavailable; waiting for the WSL systemd service"
      last_state="docker-unavailable"
    fi
    sleep 5
    continue
  fi

  if is_healthy; then
    if [[ "$last_state" != "healthy" ]]; then
      log "GymCoach is healthy on http://127.0.0.1:3030"
      last_state="healthy"
    fi
    if (( now - last_heartbeat >= HEARTBEAT_INTERVAL_SECONDS )); then
      log "heartbeat: healthy"
      last_heartbeat="$now"
    fi
    sleep "$CHECK_INTERVAL_SECONDS"
    continue
  fi

  if [[ "$last_state" != "recovering" ]]; then
    codes="$(health_codes)"
    log "GymCoach is unhealthy (root/mcp: $codes); starting the canonical Compose stack"
    last_state="recovering"
  fi

  if "${compose[@]}" up -d --no-build >> "$LOG_FILE" 2>&1; then
    recovered=false
    for _ in $(seq 1 30); do
      if is_healthy; then
        recovered=true
        break
      fi
      sleep 2
    done

    if [[ "$recovered" == "true" ]]; then
      log "GymCoach recovery succeeded"
      last_state="healthy"
      last_heartbeat="$now"
    else
      codes="$(health_codes)"
      log "Compose started but health verification failed (root/mcp: $codes)"
      last_state="health-failed"
    fi
  else
    log "docker compose up failed; retrying"
    last_state="compose-failed"
  fi

  sleep "$CHECK_INTERVAL_SECONDS"
done
