#!/usr/bin/env bash
# Pattern F: 最強に強情なサーバーの生死を観察する。
# 安全のため、観察終了後(または異常終了時)は必ずプロセスをkillしてクリーンアップする。
set -u
cd "$(dirname "$0")"

PID_FILE=/home/akring/gekko_0/run/server-f.pid
rm -f "$PID_FILE"
LOG=/home/akring/gekko_0/run/pattern-f-timeline.log
: > "$LOG"

ts() { date +%s.%N; }

cleanup() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      echo "$(ts) MANUAL_CLEANUP_SIGKILL pid=$PID" >> "$LOG"
      kill -9 "$PID" 2>/dev/null
    fi
  fi
  [ -n "${WATCHER_PID:-}" ] && kill "$WATCHER_PID" 2>/dev/null
}
trap cleanup EXIT

(
  while [ ! -f "$PID_FILE" ]; do sleep 0.1; done
  PID=$(cat "$PID_FILE")
  echo "$(ts) WATCH_START pid=$PID" >> "$LOG"
  ALIVE_LAST=1
  while true; do
    if kill -0 "$PID" 2>/dev/null; then STATE="ALIVE"; else STATE="DEAD"; fi
    echo "$(ts) POLL pid=$PID state=$STATE" >> "$LOG"
    if [ "$STATE" = "DEAD" ] && [ "$ALIVE_LAST" = "1" ]; then
      echo "$(ts) DEATH_DETECTED pid=$PID" >> "$LOG"
    fi
    [ "$STATE" = "DEAD" ] && ALIVE_LAST=0 || ALIVE_LAST=1
    sleep 0.5
  done
) &
WATCHER_PID=$!

echo "$(ts) NODE_SCRIPT_START" >> "$LOG"
npx tsx pattern-f.ts > /home/akring/gekko_0/run/pattern-f-stdout.log 2>&1
NODE_EXIT=$?
echo "$(ts) NODE_SCRIPT_EXIT code=$NODE_EXIT" >> "$LOG"

# 120秒間、生死とCPU使用状況を観察する(SIGKILLされるか、放置されるか)
PREV=0
for s in 5 10 20 30 45 60 90 120; do
  sleep $((s - PREV))
  PREV=$s
  PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    CPU=$(ps -o %cpu= -p "$PID" 2>/dev/null | tr -d ' ')
    echo "$(ts) POSTCHECK +${s}s pid=$PID state=ALIVE cpu=${CPU}%" >> "$LOG"
  else
    echo "$(ts) POSTCHECK +${s}s pid=$PID state=DEAD" >> "$LOG"
  fi
done

echo "done. see $LOG, pattern-f-stdout.log, server-shutdown-cause-f.log"
