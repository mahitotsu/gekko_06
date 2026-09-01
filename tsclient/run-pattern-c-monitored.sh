#!/usr/bin/env bash
# Pattern A実行 + サーバープロセスの生死を高頻度でポーリングして記録する
set -u
cd "$(dirname "$0")"

PID_FILE=/home/akring/gekko_0/run/server.pid
rm -f "$PID_FILE"
LOG=/home/akring/gekko_0/run/pattern-c-timeline.log
: > "$LOG"

ts() { date +%s.%N; }

# バックグラウンドでpidファイル出現を待ち、生死をポーリングし続けるウォッチャー
(
  # pidファイルが出現するまで待つ
  while [ ! -f "$PID_FILE" ]; do sleep 0.1; done
  PID=$(cat "$PID_FILE")
  echo "$(ts) WATCH_START pid=$PID" >> "$LOG"
  ALIVE_LAST=1
  while true; do
    if kill -0 "$PID" 2>/dev/null; then
      STATE="ALIVE"
    else
      STATE="DEAD"
    fi
    echo "$(ts) POLL pid=$PID state=$STATE" >> "$LOG"
    if [ "$STATE" = "DEAD" ] && [ "$ALIVE_LAST" = "1" ]; then
      echo "$(ts) DEATH_DETECTED pid=$PID" >> "$LOG"
    fi
    if [ "$STATE" = "DEAD" ]; then
      ALIVE_LAST=0
    else
      ALIVE_LAST=1
    fi
    sleep 0.2
  done
) &
WATCHER_PID=$!

echo "$(ts) NODE_SCRIPT_START" >> "$LOG"
npx tsx pattern-c.ts > /home/akring/gekko_0/run/pattern-c-stdout.log 2>&1
NODE_EXIT=$?
echo "$(ts) NODE_SCRIPT_EXIT code=$NODE_EXIT" >> "$LOG"

# スクリプト終了後も30秒(5秒おき)生死を追い続ける
for i in 1 2 3 4 5 6; do
  sleep 5
  PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "$(ts) POSTCHECK +$((i*5))s pid=$PID state=ALIVE" >> "$LOG"
  else
    echo "$(ts) POSTCHECK +$((i*5))s pid=$PID state=DEAD" >> "$LOG"
  fi
done

kill "$WATCHER_PID" 2>/dev/null
wait "$WATCHER_PID" 2>/dev/null
echo "done. see $LOG and pattern-c-stdout.log"
