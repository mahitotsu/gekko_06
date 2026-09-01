#!/usr/bin/env bash
set -u
cd /home/akring/gekko_0/tsclient
PID_FILE=/home/akring/gekko_0/run/server-k.pid
rm -f "$PID_FILE"
LOG=/home/akring/gekko_0/run/pattern-k-timeline.log
: > "$LOG"
ts() { date +%s.%N; }

npx tsx pattern-k.ts > /home/akring/gekko_0/run/pattern-k-stdout.log 2>&1 &

while [ ! -f "$PID_FILE" ]; do sleep 0.1; done
SERVER_PID=$(cat "$PID_FILE")
REAL_NODE_PID=""
for i in $(seq 1 30); do
  REAL_NODE_PID=$(grep -oE "main Node\.js process pid = [0-9]+" /home/akring/gekko_0/run/pattern-k-stdout.log 2>/dev/null | grep -oE "[0-9]+" | head -1)
  [ -n "$REAL_NODE_PID" ] && break
  sleep 0.1
done
CLI_PID=$(pgrep -f "claude-agent-sdk-linux-x64/claude" | head -1)
echo "$(ts) server=$SERVER_PID node=$REAL_NODE_PID cli=$CLI_PID" >> "$LOG"

sleep 2
echo "$(ts) KILLING_NODE pid=$REAL_NODE_PID" >> "$LOG"
kill -9 "$REAL_NODE_PID" 2>/dev/null

START=$(ts)
while true; do
  NOW=$(ts)
  EL=$(python3 -c "print(f'{$NOW-$START:.2f}')")
  C=$(kill -0 "$CLI_PID" 2>/dev/null && echo alive || echo dead)
  S=$(kill -0 "$SERVER_PID" 2>/dev/null && echo alive || echo dead)
  echo "$(ts) POLL cli=$C server=$S elapsed=${EL}s" >> "$LOG"
  DONE=$(python3 -c "print(1 if float('$EL') >= 60 else 0)")
  [ "$DONE" = "1" ] && break
  sleep 1
done
kill -9 "$CLI_PID" "$SERVER_PID" 2>/dev/null
echo "FINAL cli=$(kill -0 $CLI_PID 2>/dev/null && echo was_alive || echo was_dead) server=$(kill -0 $SERVER_PID 2>/dev/null && echo was_alive || echo was_dead)" >> "$LOG"
echo done
