#!/usr/bin/env bash
# Pattern E実行 + サーバープロセスの生死を高頻度でポーリングして記録する。
# SIGTERM/SIGINTを無視する「行儀の悪い」サーバーが、最終的にSIGKILLされるか
# (されるなら何秒後か)、それとも放置され続けるかを長め(3分)に観察する。
set -u
cd "$(dirname "$0")"

PID_FILE=/home/akring/gekko_0/run/server.pid
rm -f "$PID_FILE"
LOG=/home/akring/gekko_0/run/pattern-e-timeline.log
: > "$LOG"

ts() { date +%s.%N; }

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
npx tsx pattern-e.ts > /home/akring/gekko_0/run/pattern-e-stdout.log 2>&1
NODE_EXIT=$?
echo "$(ts) NODE_SCRIPT_EXIT code=$NODE_EXIT" >> "$LOG"

# 行儀の悪いサーバーがいつまで生き残るか、3分間(かなり長めに)観察する
PREV=0
for s in 5 10 15 20 30 45 60 90 120 150 180; do
  sleep $((s - PREV))
  PREV=$s
  PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "$(ts) POSTCHECK +${s}s pid=$PID state=ALIVE" >> "$LOG"
  else
    echo "$(ts) POSTCHECK +${s}s pid=$PID state=DEAD" >> "$LOG"
  fi
done

kill "$WATCHER_PID" 2>/dev/null
wait "$WATCHER_PID" 2>/dev/null
echo "done. see $LOG, pattern-e-stdout.log, server-shutdown-cause.log"
