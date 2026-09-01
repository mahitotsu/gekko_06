import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP

PID_FILE = Path(os.environ.get("MCPVERIFY_PID_FILE", "/home/akring/gekko_0/run/server.pid"))
# 親(SDK/CLI)から見えない、サーバー自身が独立に書く終了要因ログ。
# 「何によって終了させられたか」を外部から推測せず実測するためのもの。
SHUTDOWN_LOG = Path(os.environ.get("MCPVERIFY_SHUTDOWN_LOG", "/home/akring/gekko_0/run/server-shutdown-cause.log"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ログはすべてstderrへ(stdoutはJSON-RPC用に空けておく)
def log(msg: str) -> None:
    print(f"[mcpverify-server] {msg}", file=sys.stderr, flush=True)


def record_cause(cause: str) -> None:
    with SHUTDOWN_LOG.open("a") as f:
        f.write(f"{_now()} pid={pid} {cause}\n")


# テスト用: 環境変数 MCPVERIFY_IGNORE_SIGNALS=1 のとき、SIGTERM/SIGINT/SIGHUPを
# 「行儀の悪いMCPサーバー」として無視する(SIGKILLへのエスカレーションを観察するため)。
IGNORE_SIGNALS = os.environ.get("MCPVERIFY_IGNORE_SIGNALS") == "1"


def make_signal_handler(sig_name: str):
    def handler(signum, frame):
        if IGNORE_SIGNALS:
            record_cause(f"SIGNAL_RECEIVED_BUT_IGNORED signal={sig_name}({signum})")
            log(f"received signal {sig_name}({signum}) but IGNORING it (stubborn test mode)")
            return
        record_cause(f"SIGNAL_RECEIVED signal={sig_name}({signum})")
        log(f"received signal {sig_name}({signum}), exiting")
        # デフォルトの終了動作を模して、シグナル起因の終了コードでプロセスを終了する
        sys.exit(128 + signum)

    return handler


pid = os.getpid()
PID_FILE.write_text(str(pid))
log(f"starting up, pid={pid}, pid file written to {PID_FILE}")
record_cause("STARTED")

for _sig, _name in [(signal.SIGTERM, "SIGTERM"), (signal.SIGINT, "SIGINT"), (signal.SIGHUP, "SIGHUP")]:
    signal.signal(_sig, make_signal_handler(_name))

mcp = FastMCP("mcpverify-server")


@mcp.tool()
def echo(text: str) -> str:
    """Echo back the given text (for verification purposes)."""
    log(f"echo tool called with text={text!r}")
    return f"echo: {text}"


@mcp.tool()
def slow_echo(text: str, delay_seconds: float = 20.0) -> str:
    """Echo back the given text, but sleep first (for interrupt/abort verification)."""
    log(f"slow_echo tool called with text={text!r}, sleeping {delay_seconds}s")
    for i in range(int(delay_seconds)):
        time.sleep(1)
        log(f"slow_echo still sleeping... {i + 1}/{int(delay_seconds)}s")
    log("slow_echo done sleeping, returning result")
    return f"echo(slow): {text}"


# テスト用: 環境変数 MCPVERIFY_NEVER_EXIT=1 のとき、シグナルだけでなくstdinのEOF
# (mcp.run()の自然なリターン)も無視し、居座り続ける「最強に強情なサーバー」を再現する。
# SIGKILL以外で終了できるかどうかを確認するためのモード。
NEVER_EXIT = os.environ.get("MCPVERIFY_NEVER_EXIT") == "1"

if __name__ == "__main__":
    if NEVER_EXIT:
        loop_count = 0
        while True:
            loop_count += 1
            try:
                mcp.run(transport="stdio")
                record_cause(f"RUN_RETURNED_NATURALLY_BUT_NEVER_EXIT loop={loop_count}")
            except SystemExit as e:
                record_cause(f"SYSTEM_EXIT_SUPPRESSED code={e.code} loop={loop_count}")
            except BaseException as e:
                record_cause(f"EXCEPTION_SUPPRESSED type={type(e).__name__} loop={loop_count}")
            log(f"mcp.run() returned/raised but NEVER_EXIT mode: staying alive (loop={loop_count})")
            time.sleep(1)  # stdinが閉じた後の高速ループでCPUを使い切らないようにする
    else:
        try:
            mcp.run(transport="stdio")
            # ここに到達したのは mcp.run() が例外なく"自然に"リターンした場合。
            # シグナルハンドラは sys.exit() で抜けるためここには来ない。
            record_cause("MCP_RUN_RETURNED_NATURALLY (likely stdin EOF/close detected internally)")
        except SystemExit as e:
            record_cause(f"SYSTEM_EXIT code={e.code}")
            raise
        except BaseException as e:
            record_cause(f"EXCEPTION type={type(e).__name__} msg={e!r}")
            raise
        finally:
            log(f"shutting down, pid={pid}")
            record_cause("PROCESS_EXITING")
