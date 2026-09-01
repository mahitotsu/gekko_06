#!/usr/bin/env bash
set -u
cd /home/akring/gekko_0/tsclient
PID_FILE=/home/akring/gekko_0/run/server-i2.pid
rm -f "$PID_FILE"
LOG=/home/akring/gekko_0/run/pattern-i2-uvtrack.log
: > "$LOG"
ts() { date +%s.%N; }

cp pattern-i.ts pattern-i2.ts
sed -i 's/server-i\.pid/server-i2.pid/; s/server-shutdown-cause-i\.log/server-shutdown-cause-i2.log/' pattern-i2.ts

npx tsx pattern-i2.ts > /home/akring/gekko_0/run/pattern-i2-stdout.log 2>&1 &

while [ ! -f "$PID_FILE" ]; do sleep 0.2; done
SERVER_PID=$(cat "$PID_FILE")
UV_PID=$(ps -o ppid= -p "$SERVER_PID" | tr -d ' ')
CLI_PID=$(ps -o ppid= -p "$UV_PID" | tr -d ' ')
echo "$(ts) server=$SERVER_PID uv=$UV_PID cli=$CLI_PID" >> "$LOG"
sleep 3
echo "$(ts) PRECHECK server=$(kill -0 $SERVER_PID 2>/dev/null && echo alive || echo dead) uv=$(kill -0 $UV_PID 2>/dev/null && echo alive || echo dead) cli=$(kill -0 $CLI_PID 2>/dev/null && echo alive || echo dead)" >> "$LOG"
echo "$(ts) KILL_CLI" >> "$LOG"
kill -9 "$CLI_PID" 2>/dev/null

START=$(ts)
while true; do
  NOW=$(ts)
  EL=$(python3 -c "print(f'{$NOW-$START:.2f}')")
  U=$(kill -0 $UV_PID 2>/dev/null && echo alive || echo dead)
  S=$(kill -0 $SERVER_PID 2>/dev/null && echo alive || echo dead)
  echo "$(ts) POLL uv=$U server=$S elapsed=${EL}s" >> "$LOG"
  DONE=$(python3 -c "print(1 if $EL|float >= 15 else 0)" 2>/dev/null || python3 -c "print(1 if float('$EL') >= 15 else 0)")
  [ "$DONE" = "1" ] && break
  sleep 0.2
done
kill -9 "$SERVER_PID" 2>/dev/null
kill -9 "$UV_PID" 2>/dev/null
echo done
