import os
import sys
import time
from pathlib import Path

from mcp.server.fastmcp import FastMCP

PID_FILE = Path(os.environ.get("MCPVERIFY_PID_FILE", "/home/akring/gekko_0/run/server.pid"))

# ログはすべてstderrへ(stdoutはJSON-RPC用に空けておく)
def log(msg: str) -> None:
    print(f"[mcpverify-server] {msg}", file=sys.stderr, flush=True)


pid = os.getpid()
PID_FILE.write_text(str(pid))
log(f"starting up, pid={pid}, pid file written to {PID_FILE}")

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


if __name__ == "__main__":
    try:
        mcp.run(transport="stdio")
    finally:
        log(f"shutting down, pid={pid}")
