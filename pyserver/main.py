"""検証用MCPサーバー(最小構成)。

ツールは `work(seconds)` の1つだけ。呼ばれた瞬間と完了した瞬間を
構造化イベントログに記録するので、外部のハーネスは「ツール呼び出しが
今まさに実行中か」を sleep による当てずっぽうではなくイベント監視で
正確に同期できる。

サーバーの「行儀」は MCPVERIFY_BEHAVIOR 環境変数の1つだけで切り替える
(検証対象の軸を単一の入力に閉じ込め、他のコードパスを分岐させない):

  normal                行儀の良いサーバー。SIGTERM/SIGINT/SIGHUPに素直に応答して終了する。
  ignore-signals        シグナルは全て無視する。stdin EOFには応答する(mcp.run()の自然returnに任せる)。
  ignore-signals-and-eof  シグナルもstdin EOFも無視し、mcp.run()が返っても再突入し続けて居座ろうとする。
"""

import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from mcp.server.fastmcp import FastMCP

Behavior = Literal["normal", "ignore-signals", "ignore-signals-and-eof"]

PID_FILE = Path(os.environ.get("MCPVERIFY_PID_FILE", "/home/akring/gekko_0/run/server.pid"))
EVENTS_LOG = Path(os.environ.get("MCPVERIFY_EVENTS_LOG", "/home/akring/gekko_0/run/server-events.jsonl"))
BEHAVIOR: Behavior = os.environ.get("MCPVERIFY_BEHAVIOR", "normal")  # type: ignore[assignment]

pid = os.getpid()


def log(msg: str) -> None:
    # stdoutはJSON-RPC専用に空けておく。人間向けの生ログはstderrへ。
    print(f"[mcpverify-server pid={pid}] {msg}", file=sys.stderr, flush=True)


def emit(event: str, **fields: object) -> None:
    """外部ハーネスが監視する、構造化(JSONL)の唯一の記録経路。"""
    import json

    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "pid": pid,
        "event": event,
        **fields,
    }
    with EVENTS_LOG.open("a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    log(f"event={event} {fields}")


def make_signal_handler(sig_name: str):
    def handler(signum, frame):
        if BEHAVIOR in ("ignore-signals", "ignore-signals-and-eof"):
            emit("signal_ignored", signal=sig_name, signum=signum)
            return
        emit("signal_received", signal=sig_name, signum=signum)
        sys.exit(128 + signum)

    return handler


PID_FILE.parent.mkdir(parents=True, exist_ok=True)
EVENTS_LOG.parent.mkdir(parents=True, exist_ok=True)
PID_FILE.write_text(str(pid))
emit("started", behavior=BEHAVIOR, pid_file=str(PID_FILE))

for _sig, _name in [(signal.SIGTERM, "SIGTERM"), (signal.SIGINT, "SIGINT"), (signal.SIGHUP, "SIGHUP")]:
    signal.signal(_sig, make_signal_handler(_name))

mcp = FastMCP("mcpverify-server")


@mcp.tool()
def work(seconds: float = 0.0, label: str = "") -> str:
    """指定秒数だけ処理する(sleepで模擬する)唯一の検証用ツール。

    全シナリオがこの1つのツールだけを呼ぶ。呼ばれた瞬間に work_started を、
    完了した瞬間に work_finished を記録するので、外部から「今まさに実行中か」
    を正確に検知できる。
    """
    emit("work_started", seconds=seconds, label=label)
    if seconds > 0:
        time.sleep(seconds)
    emit("work_finished", seconds=seconds, label=label)
    return f"work done: seconds={seconds} label={label!r}"


def _run_normal() -> None:
    try:
        mcp.run(transport="stdio")
        emit("run_returned_naturally")
    except SystemExit as e:
        emit("system_exit", code=e.code)
        raise
    except BaseException as e:
        emit("exception", type=type(e).__name__, message=str(e))
        raise
    finally:
        emit("process_exiting")


def _run_never_exit() -> None:
    """stdin EOFすら無視し、mcp.run()が返ってもひたすら再突入し続ける。"""
    loop = 0
    while True:
        loop += 1
        try:
            mcp.run(transport="stdio")
            emit("run_returned_but_staying_alive", loop=loop)
        except SystemExit as e:
            emit("system_exit_suppressed", code=e.code, loop=loop)
        except BaseException as e:
            emit("exception_suppressed", type=type(e).__name__, loop=loop)
        time.sleep(1)


if __name__ == "__main__":
    if BEHAVIOR == "ignore-signals-and-eof":
        _run_never_exit()
    else:
        _run_normal()
