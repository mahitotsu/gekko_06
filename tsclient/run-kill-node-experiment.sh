#!/usr/bin/env bash
# 汎用: <pattern>.ts を起動し、MCPサーバーが立ち上がった後、
# 「Node.jsプロセス自体」(claude CLIの親)を外部から kill -9 で強制終了させる。
# CLIプロセス(生きているか)とMCPサーバー(生きているか)の両方を追跡し、
# 「CLIを直接killする(#8/#9)」との違いを見る。
# usage: ./run-kill-node-experiment.sh <pattern-name> <pid-file> <postcheck-max-seconds>
set -u
cd "$(dirname "$0")"

PATTERN="$1"
PID_FILE="$2"
MAXWAIT="${3:-90}"

rm -f "$PID_FILE"
LOG="/home/akring/gekko_0/run/${PATTERN}-killnode-timeline.log"
STDOUT_LOG="/home/akring/gekko_0/run/${PATTERN}-killnode-stdout.log"
: > "$LOG"
: > "$STDOUT_LOG"

ts() { date +%s.%N; }

cleanup() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      echo "$(ts) MANUAL_CLEANUP_SIGKILL_server pid=$PID" >> "$LOG"
      kill -9 "$PID" 2>/dev/null
    fi
  fi
  if [ -n "${REAL_NODE_PID:-}" ] && kill -0 "$REAL_NODE_PID" 2>/dev/null; then
    kill -9 "$REAL_NODE_PID" 2>/dev/null
  fi
  if [ -n "${CLI_PID:-}" ] && kill -0 "$CLI_PID" 2>/dev/null; then
    echo "$(ts) MANUAL_CLEANUP_SIGKILL_cli pid=$CLI_PID" >> "$LOG"
    kill -9 "$CLI_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

echo "$(ts) LAUNCH" >> "$LOG"
npx tsx "${PATTERN}.ts" > "$STDOUT_LOG" 2>&1 &
BASH_CHILD_PID=$!

# MCPサーバーが起動するまで待つ
while [ ! -f "$PID_FILE" ]; do sleep 0.2; done
SERVER_PID=$(cat "$PID_FILE")
echo "$(ts) SERVER_STARTED pid=$SERVER_PID" >> "$LOG"

# スクリプル自身が出力する「main Node.js process pid = N」から実PIDを取得
REAL_NODE_PID=""
for i in $(seq 1 30); do
  REAL_NODE_PID=$(grep -oE "main Node\.js process pid = [0-9]+" "$STDOUT_LOG" 2>/dev/null | grep -oE "[0-9]+" | head -1)
  [ -n "$REAL_NODE_PID" ] && break
  sleep 0.2
done
if [ -z "$REAL_NODE_PID" ]; then
  echo "$(ts) ERROR_NODE_PID_NOT_FOUND" >> "$LOG"
  exit 1
fi
echo "$(ts) REAL_NODE_PID_FOUND pid=$REAL_NODE_PID" >> "$LOG"

# claude CLIプロセスを特定(記録目的。killはしない)
CLI_PID=""
for i in $(seq 1 20); do
  CLI_PID=$(pgrep -f "claude-agent-sdk-linux-x64/claude" | head -1)
  [ -n "$CLI_PID" ] && break
  sleep 0.3
done
echo "$(ts) CLI_PID_FOUND pid=${CLI_PID:-none}" >> "$LOG"

sleep 3
echo "$(ts) PRECHECK node_alive=$(kill -0 "$REAL_NODE_PID" 2>/dev/null && echo yes || echo no) cli_alive=$([ -n "$CLI_PID" ] && kill -0 "$CLI_PID" 2>/dev/null && echo yes || echo no) server_alive=$(kill -0 "$SERVER_PID" 2>/dev/null && echo yes || echo no)" >> "$LOG"

echo "$(ts) KILLING_NODE pid=$REAL_NODE_PID" >> "$LOG"
kill -9 "$REAL_NODE_PID" 2>/dev/null
echo "$(ts) NODE_KILL_SENT" >> "$LOG"

ALIVE_LAST_SRV=1
ALIVE_LAST_CLI=1
START=$(ts)
while true; do
  NOW=$(ts)
  ELAPSED=$(python3 -c "print(f'{$NOW - $START:.1f}')")
  CLI_STATE="n/a"
  [ -n "$CLI_PID" ] && { kill -0 "$CLI_PID" 2>/dev/null && CLI_STATE="ALIVE" || CLI_STATE="DEAD"; }
  if kill -0 "$SERVER_PID" 2>/dev/null; then SRV_STATE="ALIVE"; else SRV_STATE="DEAD"; fi
  echo "$(ts) POLL cli=$CLI_STATE server=$SRV_STATE elapsed=${ELAPSED}s" >> "$LOG"
  if [ "$CLI_STATE" = "DEAD" ] && [ "$ALIVE_LAST_CLI" = "1" ]; then
    echo "$(ts) CLI_DEATH_DETECTED elapsed=${ELAPSED}s" >> "$LOG"
  fi
  if [ "$SRV_STATE" = "DEAD" ] && [ "$ALIVE_LAST_SRV" = "1" ]; then
    echo "$(ts) SERVER_DEATH_DETECTED elapsed=${ELAPSED}s" >> "$LOG"
  fi
  [ "$CLI_STATE" = "DEAD" ] && ALIVE_LAST_CLI=0 || ALIVE_LAST_CLI=1
  [ "$SRV_STATE" = "DEAD" ] && ALIVE_LAST_SRV=0 || ALIVE_LAST_SRV=1
  DONE=$(python3 -c "print(1 if $ELAPSED >= $MAXWAIT else 0)")
  [ "$DONE" = "1" ] && break
  sleep 1
done

echo "$(ts) FINAL_AT_${MAXWAIT}s server=$(kill -0 "$SERVER_PID" 2>/dev/null && echo ALIVE || echo DEAD) cli=$([ -n "$CLI_PID" ] && kill -0 "$CLI_PID" 2>/dev/null && echo ALIVE || echo DEAD)" >> "$LOG"
echo "done. see $LOG"
