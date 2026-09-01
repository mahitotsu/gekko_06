// Pattern I: シグナル+stdin EOFの両方を無視する「最強に強情な」MCPサーバーを使いつつ、
// 外部から claude CLIプロセスを kill -9 で強制終了させる。
// Pattern Fでは最終的にSIGKILLしていたのはCLI自身だった。そのCLIが先に死んだら、
// 後始末役が誰もいなくなり、MCPサーバーは孤児として残り続けるはず、という仮説を検証する。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, rmSync } from "node:fs";

const PID_FILE = "/home/akring/gekko_0/run/server-i2.pid";
if (existsSync(PID_FILE)) rmSync(PID_FILE);
const SHUTDOWN_LOG = "/home/akring/gekko_0/run/server-shutdown-cause-i2.log";
if (existsSync(SHUTDOWN_LOG)) rmSync(SHUTDOWN_LOG);

const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

async function main() {
  console.log(`main Node.js process pid = ${process.pid}`);
  try {
    const q = query({
      prompt: "slow_echoツール(mcp__mcpverify__slow_echo)を使って text='pattern-i', delay_seconds=40 で呼び出してください。",
      options: {
        mcpServers: {
          mcpverify: {
            type: "stdio",
            command: "uv",
            args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
            env: {
              ...process.env,
              MCPVERIFY_PID_FILE: PID_FILE,
              MCPVERIFY_IGNORE_SIGNALS: "1",
              MCPVERIFY_NEVER_EXIT: "1",
              MCPVERIFY_SHUTDOWN_LOG: SHUTDOWN_LOG,
            } as Record<string, string>,
          },
        },
        allowedTools: ["mcp__mcpverify__slow_echo"],
        disallowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"],
        permissionMode: "bypassPermissions",
        maxTurns: 5,
      },
    });

    for await (const msg of q) {
      console.log(`[msg] type=${msg.type} t=${Date.now()}`);
    }
    console.log(`=== for-await loop finished normally at t=${Date.now()} ===`);
  } catch (err) {
    console.log(`=== query() threw (expected once CLI is killed) at t=${Date.now()}: ${err} ===`);
  }
}

main().then(() => console.log(`=== main() resolved at t=${Date.now()} ===`));
