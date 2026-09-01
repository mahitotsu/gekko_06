#!/usr/bin/env bash
# 汎用: <pattern>.ts を起動し、MCPサーバーが立ち上がった後、
# claude CLIプロセスを外部から kill -9 で強制終了させ、
# MCPサーバー子プロセスの生死を長めに追跡する。
# usage: ./run-kill-cli-experiment.sh <pattern-name> <pid-file> <postcheck-max-seconds>
set -u
cd "$(dirname "$0")"

PATTERN="$1"           # e.g. pattern-h
PID_FILE="$2"          # e.g. /home/akring/gekko_0/run/server-h.pid
MAXWAIT="${3:-120}"

rm -f "$PID_FILE"
LOG="/home/akring/gekko_0/run/${PATTERN}-kill-timeline.log"
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
}
trap cleanup EXIT

echo "$(ts) NODE_SCRIPT_START" >> "$LOG"
npx tsx "${PATTERN}.ts" > "/home/akring/gekko_0/run/${PATTERN}-kill-stdout.log" 2>&1 &
NODE_PID=$!
echo "$(ts) NODE_PID=$NODE_PID" >> "$LOG"

# MCPサーバーが起動するまで待つ
while [ ! -f "$PID_FILE" ]; do sleep 0.2; done
SERVER_PID=$(cat "$PID_FILE")
echo "$(ts) SERVER_STARTED pid=$SERVER_PID" >> "$LOG"

# ツール呼び出しが実際にサーバーへ飛ぶ猶予を少し取る
sleep 3

# claude CLIプロセス(このNodeプロセスの子孫)を特定する
CLI_PID=""
for i in $(seq 1 20); do
  CLI_PID=$(pgrep -f "claude-agent-sdk-linux-x64/claude" | head -1)
  [ -n "$CLI_PID" ] && break
  sleep 0.3
done

if [ -z "$CLI_PID" ]; then
  echo "$(ts) ERROR_CLI_PID_NOT_FOUND" >> "$LOG"
  wait "$NODE_PID" 2>/dev/null
  exit 1
fi
echo "$(ts) CLI_PID_FOUND pid=$CLI_PID" >> "$LOG"
echo "$(ts) PRECHECK server_alive=$(kill -0 "$SERVER_PID" 2>/dev/null && echo yes || echo no) cli_alive=$(kill -0 "$CLI_PID" 2>/dev/null && echo yes || echo no)" >> "$LOG"

# 本番: CLIプロセスを問答無用でSIGKILL
echo "$(ts) KILLING_CLI pid=$CLI_PID" >> "$LOG"
kill -9 "$CLI_PID" 2>/dev/null
echo "$(ts) CLI_KILL_SENT" >> "$LOG"

# 以降、MCPサーバーの生死を高頻度でポーリング
ALIVE_LAST=1
START=$(ts)
while true; do
  NOW=$(ts)
  ELAPSED=$(python3 -c "print(f'{$NOW - $START:.1f}')")
  if kill -0 "$SERVER_PID" 2>/dev/null; then STATE="ALIVE"; else STATE="DEAD"; fi
  echo "$(ts) POLL server_pid=$SERVER_PID state=$STATE elapsed=${ELAPSED}s" >> "$LOG"
  if [ "$STATE" = "DEAD" ] && [ "$ALIVE_LAST" = "1" ]; then
    echo "$(ts) SERVER_DEATH_DETECTED pid=$SERVER_PID elapsed=${ELAPSED}s" >> "$LOG"
  fi
  [ "$STATE" = "DEAD" ] && ALIVE_LAST=0 || ALIVE_LAST=1
  AWK_DONE=$(python3 -c "print(1 if $ELAPSED >= $MAXWAIT else 0)")
  [ "$AWK_DONE" = "1" ] && break
  sleep 1
done

FINAL_STATE=$(kill -0 "$SERVER_PID" 2>/dev/null && echo ALIVE || echo DEAD)
echo "$(ts) FINAL_STATE_AT_${MAXWAIT}s pid=$SERVER_PID state=$FINAL_STATE" >> "$LOG"

wait "$NODE_PID" 2>/dev/null
echo "done. see $LOG"
