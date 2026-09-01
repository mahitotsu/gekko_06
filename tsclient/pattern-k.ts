// Pattern K: シグナル+stdin EOF両方無視の「最強に強情な」サーバーを使いつつ、
// Node.jsプロセス自体を外部からkill -9する。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, rmSync } from "node:fs";

const PID_FILE = "/home/akring/gekko_0/run/server-k.pid";
if (existsSync(PID_FILE)) rmSync(PID_FILE);
const SHUTDOWN_LOG = "/home/akring/gekko_0/run/server-shutdown-cause-k.log";
if (existsSync(SHUTDOWN_LOG)) rmSync(SHUTDOWN_LOG);

const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

async function main() {
  console.log(`main Node.js process pid = ${process.pid}`);
  try {
    const q = query({
      prompt: "slow_echoツール(mcp__mcpverify__slow_echo)を使って text='pattern-k', delay_seconds=40 で呼び出してください。",
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
  } catch (err) {
    console.log(`=== query() threw at t=${Date.now()}: ${err} ===`);
  }
}

main();
